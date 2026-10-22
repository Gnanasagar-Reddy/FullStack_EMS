import { Inngest } from "inngest";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import sendEmail from "../config/nodemailer.js";
import PendingEvent from "../models/PendingEvent.js";
import { deliverEvent } from "../utils/events.js";
import { indiaDay } from "../utils/attendanceDates.js";

// Create a client to send and receive events
export const inngest = new Inngest({ id: "fullstack-ems" });

// Checkout and email reminders run independently, so SMTP failures cannot block checkout.
const autoCheckOut = inngest.createFunction(
    { id: "auto-check-out", triggers: [{ event: "employee/check-out" }] },
    async ({ event, step }) => {
        const { attendanceId } = event.data;
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
        const { employeeId, attendanceId } = event.data;
        const checkIn = await step.run("get-reminder-check-in", async () => {
            const attendance = await Attendance.findById(attendanceId);
            return attendance?.checkIn?.toISOString() || null;
        });
        if (!checkIn) return;
        await step.sleepUntil("wait-for-the-9-hours", new Date(new Date(checkIn).getTime() + 9 * 60 * 60 * 1000));
        await step.run("send-checkout-reminder", async () => {
            const attendance = await Attendance.findById(attendanceId);
            if (!attendance || attendance.checkOut) return;
            const employee = await Employee.findById(employeeId);
            if (!employee) return;
            await sendEmail({
                to: employee.email,
                subject: "Attendance Check-Out Reminder",
                body: `<div style="max-width: 600px;">
                    <h2>Hi ${employee.firstName},</h2>
                    <p>Please check out within one hour to complete your attendance for today.</p>
                    <p>Best Regards,<br />EMS</p>
                </div>`,
            });
        });
    }
);

//Send Email to admin,if admin doesn't take action on leave application with in 24 hrs
const leaveApplicationReminder = inngest.createFunction(
    { id: "leave-application-reminder", triggers: [{ event: "leave/pending" }] },
    async ({ event, step }) => {
        const { leaveApplicationId } = event.data;
        // Wait for 24 hours
        await step.sleepUntil(
            "wait-for-the-24-hours",
            new Date(new Date().getTime() + 24 * 60 * 60 * 1000)
        )
        const leaveApplication = await LeaveApplication.findById(leaveApplicationId)
        if (leaveApplication?.status === "PENDING") {
            const employee = await Employee.findById(
                leaveApplication.employeeId
            )
            if (!employee) return;
            // Send reminder email to admin to take action on leave application
            await sendEmail({
                to: process.env.ADMIN_EMAIL,
                subject: `Leave Application Reminder`,
                body: `<div style="max-width: 600px;">
                    <h2>Hi Admin, 👋</h2>
                    <p style="font-size: 16px;">You have a leave application in ${employee.department} today:</p>
                    <p style="font-size: 18px; font-weight: bold; color: #007bff; margin: 8px 0;">${leaveApplication?.startDate?.toLocaleDateString()}</p>
                    <p style="font-size: 16px;">Please make sure to take action on this leave application.</p>
                    <br />
                    <p style="font-size: 16px;">Best Regards,</p>
                    <p style="font-size: 16px;">EMS</p>
                    </div>`
            })
        }

    }
)

// Cron: Check attendance at 11:30 AM IST (06:00 UTC) and email
// absent employees

const attendanceReminderCron = inngest.createFunction(
    { id: "attendance-reminder-cron", triggers: [{ cron: "TZ=Asia/Kolkata 30 11 * * *" }] }, // 06:00 UTC = 11:30 AM IST
    async ({ step }) => {
        // Step 1: Get today's date range (IST)
        const today = await step.run("get-today-date", () => {
            const { day, start, end } = indiaDay();
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

        // step 6 : send reminder emails
        // Step 6: Send reminder emails
        if (absentEmployees.length > 0) {
            await step.run("send-reminder-emails", async () => {
                const emailPromises = absentEmployees.map((emp) => {
                    // send email
                    return sendEmail({
                        to: emp.email,
                        subject:`Attendance Remainder - Please Mark Your Attendance`,
                        body:`
                            <div style="max-width: 600px; font-family: Arial, sans-serif;">
                                <h2>Hi ${emp.firstName}, 👋</h2>
                                <p style="font-size: 16px;">We noticed you haven't marked your attendance yet today.</p>
                                <p style="font-size: 16px;">The deadline was <strong>11:30 AM</strong> and your attendance is still missing.</p>
                                <p style="font-size: 16px;">Please check in as soon as possible or contact your admin if you're facing any issues.</p>
                                <br />
                                <p style="font-size: 14px; color: #666;">Department: ${emp.department}</p>
                                <br />
                                <p style="font-size: 16px;">Best Regards,</p>
                                <p style="font-size: 16px;"><strong>QuickEMS</strong></p>
                            </div>
                        `
                    })
                })
                await Promise.all(emailPromises)
                return {emailsSent : absentEmployees.length}
            })
        }
        return { totalActive: activeEmployees.length, onLeave: onLeaveIds.length, checkedIn: checkedInIds.length, absent: absentEmployees.length }
    }
);

// Create an empty array where we'll export future Inngest functions
const pendingEventRetry = inngest.createFunction(
    { id: "pending-event-retry", triggers: [{ cron: "*/5 * * * *" }] },
    async ({ step }) => {
        const events = await step.run("get-pending-events", () => PendingEvent.find().sort({ createdAt: 1 }).limit(100).lean());
        let delivered = 0;
        for (const event of events) {
            const success = await step.run(`deliver-${event._id}`, () => deliverEvent(inngest, event));
            if (success) delivered++;
        }
        return { delivered, pending: events.length - delivered };
    }
);

export const functions = [autoCheckOut, checkOutReminder, leaveApplicationReminder, attendanceReminderCron, pendingEventRetry];
