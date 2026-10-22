import mongoose from "mongoose";
import { inngest } from "../inngest/index.js";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import { parseLeaveDate, todayInIndia } from "../utils/leaveDates.js";
import { assertNoOverlappingLeave, leaveError, withLeaveLock } from "../utils/leaveRequests.js";
import { queueEvent, deliverEvent } from "../utils/events.js";


// create leave
// Post /api/leaves


export const createLeave = async (req, res) => {
    try {
        const session = req.session;
        const employee = await Employee.findOne({ userId: session.userId });
        if (!employee) {
            return res.status(404).json({ error: "employee not found" })
        }
        if (employee.isDeleted || employee.employmentStatus === "INACTIVE") {
            return res.status(403).json({ error: "your account is deactivated.You cannot apply for a leave" })
        }
        const { type, startDate, endDate, reason } = req.body;

        if (!type || !startDate || !endDate || !reason) {
            return res.status(400).json({ error: "Missing fields" });
        }
        const start = parseLeaveDate(startDate);
        const end = parseLeaveDate(endDate);
        if (!start || !end || !["SICK", "CASUAL", "ANNUAL"].includes(type) || typeof reason !== "string" || !reason.trim()) {
            return res.status(400).json({ error: "Invalid leave details. Use dates in YYYY-MM-DD format." });
        }
        const today = todayInIndia();
        if (startDate <= today || endDate <= today) {
            return res.status(400).json({ error: "Leave dates must be in future" });
        }
        if (end < start) {
            return res.status(400).json({ error: "End date cannot be before start date" });
        }

        const { leave, event } = await withLeaveLock(employee._id, async (dbSession, currentEmployee) => {
            if (currentEmployee.isDeleted || currentEmployee.employmentStatus === "INACTIVE") throw leaveError(403, "Your account is deactivated. You cannot apply for leave");
            await assertNoOverlappingLeave(employee._id, start, end, dbSession);
            const [created] = await LeaveApplication.create([{
                employeeId: employee._id,
                type,
                startDate: start,
                endDate: end,
                reason: reason.trim(),
                status: "PENDING",
            }], { session: dbSession });
            const event = await queueEvent("leave/pending", { leaveApplicationId: created._id.toString() }, dbSession);
            return { leave: created, event };
        });
        await deliverEvent(inngest, event);

        return res.json({ success: true, data: leave })
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        console.error("Create Leave Error:", error);
        return res.status(500).json({
            error: error.message,
        });
    }
}


//get leaves
// GET /api/leaves

export const getLeaves = async (req, res) => {
    try {
        const session = req.session;
        const isAdmin = session.role === "ADMIN";
        if (isAdmin) {
            const status = req.query.status;
            const where = status ? { status } : {};
            const leaves = await LeaveApplication.find(where)
                .populate("employeeId")
                .sort({ createdAt: -1 });
            const data = leaves.map((l) => {
                const obj = l.toObject();
                return {
                    ...obj,
                    id: obj._id.toString(),
                    employee: obj.employeeId,
                    employeeId: obj.employeeId?._id?.toString(),
                }
            });
            return res.json({ data })
        }
        else {
            const employee = await Employee.findOne({
                userId: session.userId,
            }).lean();

            if (!employee) {
                return res.status(404).json({
                    error: "Not found"
                });
            }
            const leaves = await LeaveApplication.find({
                employeeId: employee._id
            }).sort({
                createdAt: -1
            });
            return res.json({
                data: leaves,
                employee: {
                    ...employee,
                    id: employee._id.toString()
                }
            });
        }

    } catch (error) {
        return res.status(500).json({ error: "Failed" })
    }
}


//update leave status
//Patch /api/leaves/:id


export const updateLeaveStatus = async (req, res) => {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ error: "Invalid leave ID" });
        }
        const { status } = req.body;

        if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
            return res.status(400).json({
                error: "Invalid status"
            });
        }
        const existing = await LeaveApplication.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: "Leave application not found" });
        }
        const leave = await withLeaveLock(existing.employeeId, async (dbSession) => {
            const current = await LeaveApplication.findById(req.params.id).session(dbSession);
            if (!current) throw leaveError(404, "Leave application not found");
            if (status !== "REJECTED") {
                await assertNoOverlappingLeave(current.employeeId, current.startDate, current.endDate, dbSession, current._id);
            }
            return LeaveApplication.findByIdAndUpdate(req.params.id, { status }, {
                session: dbSession, returnDocument: "after", runValidators: true,
            });
        });
        return res.json({
            success: true,
            data: leave
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: "Failed" })
    }
}
