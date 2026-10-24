import { Inngest, NonRetriableError } from "inngest";
import mongoose from "mongoose";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import sendEmail from "../config/nodemailer.js";
import PendingEvent from "../models/PendingEvent.js";
import { deliverEvent } from "../utils/events.js";
import { indiaDay } from "../utils/attendanceDates.js";

function recordId(value, field) {
    if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value)) {
        throw new NonRetriableError(`Invalid or missing ${field}`);
    }
    return value;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
}

// Create a client to send and receive events
export const inngest = new Inngest({ id: "fullstack-ems" });

// Checkout and email reminders run independently, so SMTP failures cannot block checkout.
const autoCheckOut = inngest.createFunction(
    { id: "auto-check-out", triggers: [{ event: "employee/check-out" }] },
    async ({ event, step }) => {
        const attendanceId = recordId(event?.data?.attendanceId, "attendanceId");
        const checkIn = await step.run("get-check-in", async () => {
            const attendance = await Attendance.findById(attendanceId);
            return attendance?.checkIn?.toISOString() || null;
        });
        if (!checkIn) return;
        await step.sleepUntil("wait-for-the-10-hours", new Date(new Date(checkIn).getTime() + 10 * 60 * 60 * 1000));
        await step.run("mark-auto-checkout", () => Attendance.findOneAndUpdate(
            { _id: attendanceId, checkOut: null },
            { $set: {
                checkOut: new Date(new Date(checkIn).getTime() + 4 * 60 * 60 * 1000),
                workingHours: 4,
                dayType: "Half Day",
                status: "LATE",
            } }
        ));
    }
);

const checkOutReminder = inngest.createFunction(
    { id: "check-out-reminder", triggers: [{ event: "employee/check-out" }] },
    async ({ event, step }) => {
        const attendanceId = recordId(event?.data?.attendanceId, "attendanceId");
        const checkIn = await step.run("get-reminder-check-in", async () => {
            const attendance = await Attendance.findById(attendanceId);
            return attendance?.checkIn?.toISOString() || null;
        });
        if (!checkIn) return;
        await step.sleepUntil("wait-for-the-9-hours", new Date(new Date(checkIn).getTime() + 9 * 60 * 60 * 1000));
        await step.run("send-checkout-reminder", async () => {
            const attendance = await Attendance.findById(attendanceId);
            if (!attendance || attendance.checkOut) return;
            const employee = await Employee.findById(attendance.employeeId);
            if (!employee || employee.isDeleted || employee.employmentStatus === "INACTIVE") return;
            await sendEmail({
                to: employee.email,
                subject: "Attendance Check-Out Reminder",
                body: `<div style="max-width: 600px;">
                    <h2>Hi ${escapeHtml(employee.firstName)},</h2>
                    <p>Please check out within one hour to complete your attendance for today.</p>
                    <p>Best Regards,<br />EMS</p>
                </div>`,
            });
        });
    }
);

// Anchor the reminder to the application, including when an outbox event arrives late.
const leaveApplicationReminder = inngest.createFunction(
    { id: "leave-application-reminder", triggers: [{ event: "leave/pending" }] },
    async ({ event, step }) => {
        const leaveApplicationId = recordId(event?.data?.leaveApplicationId, "leaveApplicationId");
        const createdAt = await step.run("get-leave-created-at", async () => {
            const application = await LeaveApplication.findById(leaveApplicationId);
            if (!application || application.status !== "PENDING") return null;
            const timestamp = new Date(application.createdAt);
            if (!Number.isFinite(timestamp.getTime())) throw new NonRetriableError("Leave application has no valid creation time");
            return timestamp.toISOString();
        });
        if (!createdAt) return;
        await step.sleepUntil("wait-for-the-24-hours", new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000));
        return step.run("send-leave-reminder", async () => {
            const application = await LeaveApplication.findById(leaveApplicationId);
            if (!application || application.status !== "PENDING") return { skipped: true };
            const employee = await Employee.findById(application.employeeId);
            if (!employee || employee.isDeleted || employee.employmentStatus === "INACTIVE") return { skipped: true };
            await sendEmail({
                to: process.env.ADMIN_EMAIL,
                subject: "Leave Application Reminder",
                body: `<div style="max-width: 600px;">
                    <h2>Hi Admin,</h2>
                    <p>A leave application from ${escapeHtml(employee.firstName)} in ${escapeHtml(employee.department)} is still pending after 24 hours.</p>
                    <p>Please review the application in EMS.</p>
                    <p>Best Regards,<br />EMS</p>
                </div>`,
            });
            return { sent: true };
        });
    }
);

// Cron: Check attendance at 11:30 AM IST (06:00 UTC) and email
// absent employees

const attendanceReminderCron = inngest.createFunction(
    { id: "attendance-reminder-cron", triggers: [{ cron: "TZ=Asia/Kolkata 30 11 * * *" }] }, // 06:00 UTC = 11:30 AM IST
    async ({ event, step }) => {
        // Step 1: Get today's date range (IST)
        const today = await step.run("get-today-date", () => {
            const { day, start, end } = indiaDay(event?.ts ? new Date(event.ts) : new Date());
            return { day, startUTC: start.toISOString(), endUTC: end.toISOString() };
        })
        // step 2:get all active , non - deleted employees
        const activeEmployees = await step.run
            ("get-active-employees", async () => {
                const employees = await Employee.find({
                    isDeleted: { $ne: true },
                    employmentStatus: "ACTIVE",
                }).lean();
                return employees.map((e) => ({
                    _id: e._id.toString(),
                    firstName: e.firstName, lastName: e.lastName, email: e.email, department: e.department
                }))
            }
            )
        // step 3 : get employee ids on appraved leave today
        const onLeaveIds = await step.run("get-on-leave-ids", async () => {
            const leaves = await LeaveApplication.find({
                status: "APPROVED",
                startDate: { $lte: new Date(`${today.day}T00:00:00Z`) },
                endDate: { $gte: new Date(`${today.day}T00:00:00Z`) },
            }).lean();

            return [...new Set(leaves.map((l) => l.employeeId.toString()))]
        })

        // step 4 : Get Employee IDs who already checked in today
        const checkedInIds = await step.run("get-checked-in-ids",
            async () => {
                const attendances = await Attendance.find({
                    date: { $gte: new Date(today.startUTC), $lt: new Date(today.endUTC) },
                }).lean();
                return [...new Set(attendances.map((a) => a.employeeId.toString()))]
            })

        // step 5 : Filter absent employees(not on leave & not check IN)
        const absentEmployees = activeEmployees.filter((emp) => !onLeaveIds.includes(emp._id) && !checkedInIds.includes(emp._id))

        // Successful recipients are cached independently when another email needs a retry.
        let emailsSent = 0;
        for (const candidate of absentEmployees) {
            const result = await step.run(`send-reminder-${candidate._id}`, async () => {
                if (indiaDay().day !== today.day) return { skipped: true };
                const employee = await Employee.findById(candidate._id);
                if (!employee || employee.isDeleted || employee.employmentStatus === "INACTIVE") return { skipped: true };
                const [checkedIn, onLeave] = await Promise.all([
                    Attendance.exists({ employeeId: candidate._id, date: { $gte: new Date(today.startUTC), $lt: new Date(today.endUTC) } }),
                    LeaveApplication.exists({ employeeId: candidate._id, status: "APPROVED",
                        startDate: { $lte: new Date(`${today.day}T00:00:00Z`) }, endDate: { $gte: new Date(`${today.day}T00:00:00Z`) } }),
                ]);
                if (checkedIn || onLeave) return { skipped: true };
                await sendEmail({
                    to: employee.email,
                    subject: "Attendance Reminder - Please Mark Your Attendance",
                    body: `<div style="max-width: 600px; font-family: Arial, sans-serif;">
                        <h2>Hi ${escapeHtml(employee.firstName)},</h2>
                        <p>You haven't marked attendance for today. Please check in or contact your admin if you are facing an issue.</p>
                        <p>Department: ${escapeHtml(employee.department)}</p>
                        <p>Best Regards,<br />EMS</p>
                    </div>`,
                });
                return { sent: true };
            });
            if (result.sent) emailsSent++;
        }
        return { totalActive: activeEmployees.length, onLeave: onLeaveIds.length, checkedIn: checkedInIds.length, absent: absentEmployees.length, emailsSent }
    }
);

// Retry saved events independently of the original API request.
const pendingEventRetry = inngest.createFunction(
    { id: "pending-event-retry", triggers: [{ cron: "*/5 * * * *" }], concurrency: { limit: 1 } },
    async ({ step }) => {
        const events = await step.run("get-pending-events", () => PendingEvent.find().sort({ lastAttemptAt: 1, createdAt: 1 }).limit(100).lean());
        let delivered = 0;
        const failedIds = [];
        for (const event of events) {
            const success = await step.run(`deliver-${event._id}`, () => deliverEvent(inngest, event));
            if (success) delivered++;
            else failedIds.push(event._id);
        }
        if (failedIds.length) await step.run("defer-failed-events", () => PendingEvent.updateMany(
            { _id: { $in: failedIds } }, { $set: { lastAttemptAt: new Date() } }
        ));
        return { delivered, pending: events.length - delivered };
    }
);

export const functions = [autoCheckOut, checkOutReminder, leaveApplicationReminder, attendanceReminderCron, pendingEventRetry];
