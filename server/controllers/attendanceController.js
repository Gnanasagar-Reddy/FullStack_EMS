import { inngest } from "../inngest/index.js";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import { httpError, withEmployeeLock } from "../utils/employeeTransactions.js";
import { indiaDay } from "../utils/attendanceDates.js";
import { queueEvent, deliverEvent } from "../utils/events.js";

// Clock in/out for employees
// GET api/attendance


export const clockInOut = async (req, res) => {
    try {
        const action = req.body?.action;
        if (!["CHECK_IN", "CHECK_OUT"].includes(action)) return res.status(400).json({ error: "Choose clock in or clock out" });
        const employee = await Employee.findOne({ userId: req.session.userId });
        if (!employee) return res.status(404).json({ error: "Employee not found" });
        const result = await withEmployeeLock(employee._id, async (dbSession, currentEmployee) => {
            if (currentEmployee.isDeleted || currentEmployee.employmentStatus === "INACTIVE") {
                throw httpError(403, "Your account is deactivated. You cannot clock in/out.");
            }
            const now = new Date();
            const { start, end, isLate } = indiaDay(now);
            const existing = await Attendance.findOne({
                employeeId: employee._id, date: { $gte: start, $lt: end },
            }).session(dbSession);
            if (action === "CHECK_IN") {
                // Repeated clock-in requests are safe and never act as clock-out.
                if (existing) return { attendance: existing, type: existing.checkOut ? "CHECK_OUT" : "CHECK_IN" };
                const [attendance] = await Attendance.create([{
                    employeeId: employee._id, date: start, checkIn: now, status: isLate ? "LATE" : "PRESENT",
                }], { session: dbSession });
                const event = await queueEvent("employee/check-out", {
                    employeeId: employee._id.toString(), attendanceId: attendance._id.toString(),
                }, dbSession);
                return { attendance, type: "CHECK_IN", event };
            }
            if (!existing?.checkIn) throw httpError(409, "Clock in before clocking out");
            if (existing.checkOut) return { attendance: existing, type: "CHECK_OUT" };
            const workingHours = Number(((now.getTime() - new Date(existing.checkIn).getTime()) / 3600000).toFixed(2));
            const dayType = workingHours >= 8 ? "Full Day" : workingHours >= 6 ? "Three Quarter Day" : workingHours >= 4 ? "Half Day" : "Short Day";
            const attendance = await Attendance.findOneAndUpdate(
                { _id: existing._id, checkOut: null },
                { $set: { checkOut: now, workingHours, dayType } },
                { session: dbSession, returnDocument: "after", runValidators: true }
            );
            return { attendance: attendance || existing, type: "CHECK_OUT" };
        });
        if (result.event) await deliverEvent(inngest, result.event);
        return res.json({ success: true, type: result.type, data: result.attendance });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        console.error("Attendance error:", error.message);
        return res.status(500).json({ error: "Operation failed" });
    }
};


// get attendance for employee
// GET /api/attendance 

export const getAttendance = async (req, res) => {
    try {
        const session = req.session;
        if (!req.session?.userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const employee = await Employee.findOne({ userId: session.userId })
        if (!employee) return res.status(404).json({ error: "Employee not found" });
        const limit = parseInt(req.query.limit || 30);
        const history = await Attendance.find({ employeeId: employee._id }).sort({ date: -1 }).limit(limit)

        return res.json({
            data: history,
            employee: { isDeleted: employee.isDeleted }
        })
    } catch (error) {
        return res.status(500).json({ error: "Failed to fetch attendance" })
    }
}