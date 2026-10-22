import LeaveApplication from "../models/LeaveApplication.js";
import { httpError } from "./employeeTransactions.js";

export { httpError as leaveError, withEmployeeLock as withLeaveLock } from "./employeeTransactions.js";

export async function assertNoOverlappingLeave(employeeId, startDate, endDate, session, excludeId) {
    const where = {
        employeeId,
        status: { $in: ["PENDING", "APPROVED"] },
        startDate: { $lte: endDate },
        endDate: { $gte: startDate },
    };
    if (excludeId) where._id = { $ne: excludeId };
    const overlap = await LeaveApplication.findOne(where).session(session);
    if (overlap) throw httpError(409, "These dates overlap an existing pending or approved leave application");
}
