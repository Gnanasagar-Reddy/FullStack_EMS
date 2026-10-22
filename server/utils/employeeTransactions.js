import mongoose from "mongoose";
import Employee from "../models/Employee.js";

export function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

// Serializes related attendance, payroll, and leave writes for one employee.
export function withEmployeeLock(employeeId, operation) {
    return mongoose.connection.transaction(async (session) => {
        const employee = await Employee.findByIdAndUpdate(
            employeeId, { $inc: { operationRevision: 1 } }, { session, returnDocument: "after" }
        );
        if (!employee) throw httpError(404, "Employee not found");
        return operation(session, employee);
    });
}
