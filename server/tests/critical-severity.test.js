import test, { after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import Attendance from "../models/Attendance.js";
import Payslip from "../models/Payslip.js";
import LeaveApplication from "../models/LeaveApplication.js";
import PendingEvent from "../models/PendingEvent.js";
import { transporter } from "../config/nodemailer.js";
import { createPayslip, getPayslipById } from "../controllers/payslipController.js";
import { createEmployee, updateEmployee } from "../controllers/employeeController.js";
import { clockInOut } from "../controllers/attendanceController.js";
import { createLeave } from "../controllers/leaveController.js";
import { login } from "../controllers/authController.js";
import { protect, protectAdmin } from "../middleware/auth.js";
import { functions, inngest } from "../inngest/index.js";
import { deliverEvent } from "../utils/events.js";
import { indiaDay, indiaMonth } from "../utils/attendanceDates.js";
import { moneyInCents } from "../utils/payroll.js";

const id = "507f1f77bcf86cd799439011";
const otherId = "507f1f77bcf86cd799439012";
const secret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "critical-isolated-tests";
after(() => { if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret; });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const employeeFields = { userId: id, firstName: "Test", lastName: "Employee", email: "test@example.test",
    phone: "123", position: "Engineer", joinDate: "2026-01-01", department: "Engineering" };

function transaction(t, employee = { _id: id, employmentStatus: "ACTIVE", isDeleted: false }) {
    const session = {};
    t.mock.method(mongoose.connection, "transaction", async (operation) => operation(session));
    t.mock.method(Employee, "findByIdAndUpdate", async (_id, _update, options) => {
        assert.equal(options.session, session);
        return employee;
    });
    return session;
}

function outbox(t) {
    t.mock.method(PendingEvent, "create", async ([fields]) => [{ _id: otherId, ...fields }]);
    t.mock.method(PendingEvent, "deleteOne", async () => {});
}

test("payslip access is scoped to the signed-in employee; another employee's slip is hidden", async (t) => {
    t.mock.method(Employee, "findOne", async () => ({ _id: id }));
    t.mock.method(Payslip, "findOne", (where) => ({ populate: () => ({ lean: async () => {
        assert.equal(where.employeeId, id);
        return where._id === otherId ? null : { _id: id, employeeId: { _id: id }, netSalary: 500 };
    } }) }));
    for (const [slipId, status] of [[id, 200], [otherId, 404]]) {
        const res = response();
        await getPayslipById({ params: { id: slipId }, session: { userId: id, role: "EMPLOYEE" } }, res);
        assert.equal(res.code, status);
    }
});

test("admins can retrieve payslips and malformed IDs never reach the database", async (t) => {
    const lookup = t.mock.method(Payslip, "findOne", (where) => ({ populate: () => ({ lean: async () => {
        assert.equal(where.employeeId, undefined);
        return { _id: id, employeeId: { _id: otherId } };
    } }) }));
    const res = response();
    await getPayslipById({ params: { id }, session: { role: "ADMIN" } }, res);
    assert.equal(res.code, 200);
    const invalid = response();
    await getPayslipById({ params: { id: "invalid" }, session: { role: "ADMIN" } }, invalid);
    assert.equal(invalid.code, 400);
    assert.equal(lookup.mock.callCount(), 1);
});

test("an old admin token cannot retain admin rights after a role change", async (t) => {
    t.mock.method(User, "findById", () => ({ select: async () => ({ role: "EMPLOYEE", email: "new@example.test", tokenVersion: 0 }) }));
    t.mock.method(Employee, "findOne", async () => null);
    const token = jwt.sign({ userId: id, role: "ADMIN" }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/employees" };
    const res = response();
    await protect(req, res, () => protectAdmin(req, res, () => assert.fail("must not grant admin access")));
    assert.equal(res.code, 403);
    assert.equal(req.session.email, "new@example.test");
});

test("password-reset token versions reject old tokens", async (t) => {
    t.mock.method(User, "findById", () => ({ select: async () => ({ role: "ADMIN", tokenVersion: 2 }) }));
    const token = jwt.sign({ userId: id, role: "ADMIN", tokenVersion: 1 }, process.env.JWT_SECRET);
    const res = response();
    await protect({ headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/auth/session" }, res, () => assert.fail("must reject revoked token"));
    assert.equal(res.code, 401);
});

test("deleted and inactive employees cannot use existing tokens or sign in", async (t) => {
    const hash = await bcrypt.hash("test-password", 4);
    const account = { _id: id, role: "EMPLOYEE", email: "test@example.test", password: hash };
    t.mock.method(User, "findById", () => ({ select: async () => account }));
    t.mock.method(User, "findOne", async () => account);
    let employee;
    t.mock.method(Employee, "findOne", async () => employee);
    for (employee of [{ isDeleted: true, employmentStatus: "ACTIVE" }, { isDeleted: false, employmentStatus: "INACTIVE" }]) {
        const token = jwt.sign({ userId: id, role: "EMPLOYEE" }, process.env.JWT_SECRET);
        const res = response();
        await protect({ headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/attendance" }, res, () => assert.fail("must block inactive account"));
        assert.equal(res.code, 401);
        const signIn = response();
        await login({ body: { email: account.email, password: "test-password", role_type: "Employee" } }, signIn);
        assert.equal(signIn.code, 403);
    }
});

test("employee creation validates the entire profile before writing either document", async (t) => {
    const saveUser = t.mock.method(User.prototype, "save", async () => assert.fail("must not save an orphan user"));
    const saveEmployee = t.mock.method(Employee.prototype, "save", async () => assert.fail("must not save invalid profile"));
    const res = response();
    await createEmployee({ body: { firstName: "Test", lastName: "User", email: "test@example.test", password: "test-password" } }, res);
    assert.equal(res.code, 400);
    assert.equal(saveUser.mock.callCount(), 0);
    assert.equal(saveEmployee.mock.callCount(), 0);
});

test("employee creation uses one transaction and propagates a failed second write", async (t) => {
    const session = {};
    let aborted = false;
    t.mock.method(console, "log", () => {});
    t.mock.method(mongoose.connection, "transaction", async (operation) => {
        try { return await operation(session); } catch (error) { aborted = true; throw error; }
    });
    t.mock.method(User.prototype, "save", async function (options) { assert.equal(options.session, session); return this; });
    t.mock.method(Employee.prototype, "save", async (options) => {
        assert.equal(options.session, session);
        throw new Error("profile write failed");
    });
    const res = response();
    await createEmployee({ body: { ...employeeFields, password: "test-password" } }, res);
    assert.equal(res.code, 500);
    assert.equal(aborted, true);
});

test("valid employee creation saves the linked account and profile in the same transaction", async (t) => {
    const session = {};
    let account;
    t.mock.method(mongoose.connection, "transaction", async (operation) => operation(session));
    t.mock.method(User.prototype, "save", async function (options) {
        assert.equal(options.session, session);
        account = this;
        return this;
    });
    t.mock.method(Employee.prototype, "save", async function (options) {
        assert.equal(options.session, session);
        assert.equal(this.userId.toString(), account._id.toString());
        assert.equal(this.isDeleted, false);
        return this;
    });
    const res = response();
    await createEmployee({ body: { ...employeeFields, password: "test-password" } }, res);
    assert.equal(res.code, 201);
    assert.equal(await bcrypt.compare("test-password", account.password), true);
});

test("duplicate email failure aborts the combined employee/account update", async (t) => {
    const session = {};
    const employee = new Employee(employeeFields);
    const user = new User({ _id: id, email: employeeFields.email, role: "EMPLOYEE", password: "hash" });
    let aborted = false;
    t.mock.method(mongoose.connection, "transaction", async (operation) => {
        try { return await operation(session); } catch (error) { aborted = true; throw error; }
    });
    t.mock.method(Employee, "findById", () => ({ session: async () => employee }));
    t.mock.method(User, "findById", () => ({ session: async () => user }));
    t.mock.method(employee, "save", async (options) => assert.equal(options.session, session));
    t.mock.method(user, "save", async (options) => {
        assert.equal(options.session, session);
        throw Object.assign(new Error("duplicate email"), { code: 11000 });
    });
    const res = response();
    await updateEmployee({ params: { id }, body: { email: "already-used@example.test" } }, res);
    assert.equal(res.code, 400);
    assert.equal(aborted, true);
});

test("invalid department and role values are rejected before either update is saved", async (t) => {
    const employee = new Employee(employeeFields);
    const user = new User({ _id: id, email: employeeFields.email, role: "EMPLOYEE", password: "hash" });
    t.mock.method(mongoose.connection, "transaction", async (operation) => operation({}));
    t.mock.method(Employee, "findById", () => ({ session: async () => employee }));
    t.mock.method(User, "findById", () => ({ session: async () => user }));
    t.mock.method(employee, "save", async () => assert.fail("must not save invalid fields"));
    const res = response();
    await updateEmployee({ params: { id }, body: { department: "invalid", role: "invalid" } }, res);
    assert.equal(res.code, 400);
});

test("admin role/password changes increment the account token version", async (t) => {
    const employee = new Employee(employeeFields);
    const user = new User({ _id: id, email: employeeFields.email, role: "EMPLOYEE", password: "old-hash", tokenVersion: 3 });
    t.mock.method(mongoose.connection, "transaction", async (operation) => operation({}));
    t.mock.method(Employee, "findById", () => ({ session: async () => employee }));
    t.mock.method(User, "findById", () => ({ session: async () => user }));
    t.mock.method(employee, "save", async () => {});
    t.mock.method(user, "save", async () => {});
    const res = response();
    await updateEmployee({ params: { id }, body: { role: "ADMIN", password: "new-password" } }, res);
    assert.equal(res.code, 200);
    assert.equal(user.tokenVersion, 4);
    assert.equal(await bcrypt.compare("new-password", user.password), true);
});

test("payroll rejects invalid periods, nonexistent IDs, negative and non-finite amounts", async () => {
    const valid = { employeeId: id, month: 10, year: 2026, basicSalary: 100 };
    for (const invalid of [
        { month: 13 }, { month: 1.5 }, { year: 99 }, { year: {} }, { employeeId: "invalid" },
        { basicSalary: -1 }, { basicSalary: Infinity }, { basicSalary: "" }, { basicSalary: 1.005 },
        { allowances: -1 }, { deductions: 101 }, { basicSalary: true },
    ]) {
        const res = response();
        await createPayslip({ body: { ...valid, ...invalid } }, res);
        assert.equal(res.code, 400, JSON.stringify(invalid));
    }
    assert.equal(moneyInCents(0.29), 29);
});

test("payroll permits zero salary and calculates decimal amounts in cents", async (t) => {
    const session = transaction(t);
    t.mock.method(Payslip, "findOne", () => ({ session: async () => null }));
    t.mock.method(Payslip, "create", async ([fields], options) => {
        assert.equal(options.session, session);
        return [{ _id: id, ...fields }];
    });
    const res = response();
    await createPayslip({ body: { employeeId: id, month: "10", year: "2026", basicSalary: "0", allowances: "0.30", deductions: "0.10" } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.data.netSalary, 0.2);
});

test("payroll duplicates are rejected inside the employee transaction", async (t) => {
    transaction(t);
    t.mock.method(Payslip, "findOne", () => ({ session: async () => ({ _id: otherId }) }));
    t.mock.method(Payslip, "create", async () => assert.fail("must not create duplicate"));
    const res = response();
    await createPayslip({ body: { employeeId: id, month: 10, year: 2026, basicSalary: 100 } }, res);
    assert.equal(res.code, 409);
});

test("payroll cannot be created for missing employees", async (t) => {
    transaction(t, null);
    const res = response();
    await createPayslip({ body: { employeeId: id, month: 10, year: 2026, basicSalary: 100 } }, res);
    assert.equal(res.code, 404);
});

test("attendance cutoff and day/month boundaries use India time regardless of host timezone", () => {
    assert.equal(indiaDay(new Date("2026-10-21T03:30:00Z")).isLate, false);
    assert.equal(indiaDay(new Date("2026-10-21T03:31:00Z")).isLate, true);
    const early = indiaDay(new Date("2026-10-20T19:00:00Z"));
    assert.equal(early.day, "2026-10-21");
    assert.equal(early.start.toISOString(), "2026-10-20T18:30:00.000Z");
    assert.equal(indiaMonth(new Date("2026-12-31T20:00:00Z")).start.toISOString(), "2026-12-31T18:30:00.000Z");
});

test("event failure leaves a durable retry record and reuses the same event ID", async (t) => {
    t.mock.method(console, "error", () => {});
    const deleted = t.mock.method(PendingEvent, "deleteOne", async () => {});
    const event = { _id: id, name: "leave/pending", data: { leaveApplicationId: otherId } };
    const ids = [];
    let fail = true;
    const client = { send: async (value) => { ids.push(value.id); if (fail) throw new Error("event service offline"); } };
    assert.equal(await deliverEvent(client, event), false);
    assert.equal(deleted.mock.callCount(), 0);
    fail = false;
    assert.equal(await deliverEvent(client, event), true);
    assert.deepEqual(ids, [id, id]);
    assert.equal(deleted.mock.callCount(), 1);
});

test("event delivery failure does not fail clock-in, and retrying clock-in never clocks out", async (t) => {
    transaction(t);
    outbox(t);
    t.mock.method(console, "error", () => {});
    t.mock.method(Employee, "findOne", async () => ({ _id: id }));
    let record = null;
    t.mock.method(Attendance, "findOne", () => ({ session: async () => record }));
    const create = t.mock.method(Attendance, "create", async ([fields]) => {
        record = { _id: id, ...fields, checkOut: null };
        return [record];
    });
    t.mock.method(inngest, "send", async () => { throw new Error("events offline"); });
    t.mock.method(Attendance, "findOneAndUpdate", async () => assert.fail("must not clock out on a clock-in retry"));
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = response();
        await clockInOut({ session: { userId: id }, body: { action: "CHECK_IN" } }, res);
        assert.equal(res.code, 200);
        assert.equal(res.body.type, "CHECK_IN");
        assert.equal(res.body.data.checkOut, null);
    }
    assert.equal(create.mock.callCount(), 1);
});

test("inactive employees cannot clock in or submit leave even through direct handler calls", async (t) => {
    transaction(t, { _id: id, employmentStatus: "INACTIVE" });
    t.mock.method(Employee, "findOne", async () => ({ _id: id, employmentStatus: "INACTIVE" }));
    const attendance = response();
    await clockInOut({ session: { userId: id }, body: { action: "CHECK_IN" } }, attendance);
    assert.equal(attendance.code, 403);
    const leave = response();
    await createLeave({ session: { userId: id }, body: {} }, leave);
    assert.equal(leave.code, 403);
});

test("leave creation still succeeds when event delivery fails after commit", async (t) => {
    transaction(t);
    outbox(t);
    t.mock.method(console, "error", () => {});
    t.mock.method(Employee, "findOne", async () => ({ _id: id }));
    t.mock.method(LeaveApplication, "findOne", () => ({ session: async () => null }));
    t.mock.method(LeaveApplication, "create", async ([fields]) => [{ _id: id, ...fields }]);
    t.mock.method(inngest, "send", async () => { throw new Error("events offline"); });
    const res = response();
    await createLeave({ session: { userId: id }, body: { type: "SICK", startDate: "2090-01-01", endDate: "2090-01-02", reason: "test" } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.success, true);
});

test("new employees default to non-deleted and reminder query includes legacy missing flags", async (t) => {
    assert.equal(new Employee(employeeFields).isDeleted, false);
    t.mock.method(Employee, "find", (where) => {
        assert.deepEqual(where.isDeleted, { $ne: true });
        return { lean: async () => [] };
    });
    t.mock.method(LeaveApplication, "find", () => ({ lean: async () => [] }));
    t.mock.method(Attendance, "find", () => ({ lean: async () => [] }));
    const cron = functions.find((fn) => fn.opts.id === "attendance-reminder-cron");
    await cron.fn({ step: { run: async (_name, operation) => operation() } });
});

test("attendance reminder waits for email delivery and propagates SMTP failures", async (t) => {
    t.mock.method(Employee, "find", () => ({ lean: async () => [{ _id: id, firstName: "Test", email: "test@example.test" }] }));
    t.mock.method(LeaveApplication, "find", () => ({ lean: async () => [] }));
    t.mock.method(Attendance, "find", () => ({ lean: async () => [] }));
    let rejectMail;
    t.mock.method(transporter, "sendMail", () => new Promise((_resolve, reject) => { rejectMail = reject; }));
    const cron = functions.find((fn) => fn.opts.id === "attendance-reminder-cron");
    let finished = false;
    const job = cron.fn({ step: { run: async (_name, operation) => operation() } });
    const expectedFailure = assert.rejects(job, /SMTP offline/);
    job.then(() => { finished = true; }, () => { finished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    rejectMail(new Error("SMTP offline"));
    await expectedFailure;
});

test("the retry job retries retained events while continuing past an unavailable delivery", async (t) => {
    t.mock.method(console, "error", () => {});
    const events = [{ _id: id, name: "leave/pending", data: {} }, { _id: otherId, name: "employee/check-out", data: {} }];
    t.mock.method(PendingEvent, "find", () => ({ sort: () => ({ limit: () => ({ lean: async () => events }) }) }));
    t.mock.method(inngest, "send", async (event) => { if (event.id === id) throw new Error("delivery unavailable"); });
    const removed = [];
    t.mock.method(PendingEvent, "deleteOne", async (where) => { removed.push(where._id); });
    const retry = functions.find((fn) => fn.opts.id === "pending-event-retry");
    const result = await retry.fn({ step: { run: async (_name, operation) => operation() } });
    assert.deepEqual(result, { delivered: 1, pending: 1 });
    assert.deepEqual(removed, [otherId]);
});
