import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { transporter } from "../config/nodemailer.js";

const { functions, inngest } = await import("../inngest/index.js");
const { login, changePassword } = await import("../controllers/authController.js");
const { updateEmployee } = await import("../controllers/employeeController.js");
const { getProfile, updateProfile } = await import("../controllers/profileController.js");
const { createLeave, updateLeaveStatus } = await import("../controllers/leaveController.js");
const { protect } = await import("../middleware/auth.js");
const { default: connectDB } = await import("../config/db.js");
const { default: User } = await import("../models/User.js");
const { default: Employee } = await import("../models/Employee.js");
const { default: Attendance } = await import("../models/Attendance.js");
const { default: LeaveApplication } = await import("../models/LeaveApplication.js");
const { default: PendingEvent } = await import("../models/PendingEvent.js");
const { parseLeaveDate, todayInIndia } = await import("../utils/leaveDates.js");
const { tomorrowInIndia } = await import("../../client/src/utils/leaveDates.js");

const id = "507f1f77bcf86cd799439011";
const password = "temporary-test-password";
const passwordHash = await bcrypt.hash(password, 4);
const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "isolated-medium-regression-test";
after(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
});

function response() {
    return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

function user(overrides = {}) {
    return { _id: id, email: "admin@example.test", role: "ADMIN", password: passwordHash, ...overrides };
}

function mockLeaveTransaction(t, overlap = null) {
    const session = {};
    t.mock.method(mongoose.connection, "transaction", async (operation) => operation(session));
    t.mock.method(Employee, "findOne", async () => ({ _id: id, isDeleted: false }));
    t.mock.method(Employee, "findByIdAndUpdate", async (_id, _update, options) => {
        assert.equal(options.session, session);
        return { _id: id, isDeleted: false };
    });
    t.mock.method(LeaveApplication, "findOne", () => ({ session: async (value) => {
        assert.equal(value, session);
        return overlap;
    } }));
    t.mock.method(PendingEvent, "create", async ([fields]) => [{ _id: id, ...fields }]);
    t.mock.method(PendingEvent, "deleteOne", async () => {});
    return session;
}

test("India calendar boundaries agree in the browser and backend, including year rollover", () => {
    for (const [instant, today, tomorrow] of [
        ["2026-10-20T18:29:59Z", "2026-10-20", "2026-10-21"],
        ["2026-10-20T18:30:00Z", "2026-10-21", "2026-10-22"],
        ["2026-12-31T20:00:00Z", "2027-01-01", "2027-01-02"],
    ]) {
        assert.equal(todayInIndia(new Date(instant)), today);
        assert.equal(tomorrowInIndia(new Date(instant)), tomorrow);
    }
    assert.equal(parseLeaveDate("2026-02-30"), null);
    assert.equal(parseLeaveDate("not-a-date"), null);
    assert.equal(parseLeaveDate("2026-10-21T00:00:00Z"), null);
    assert.equal(parseLeaveDate("2028-02-29").toISOString(), "2028-02-29T00:00:00.000Z");
});

test("database connection failure propagates to the caller instead of allowing startup", async (t) => {
    t.mock.method(console, "error", () => {});
    t.mock.method(mongoose, "connect", async () => { throw new Error("database unavailable"); });
    await assert.rejects(connectDB(), /database unavailable/);
});

test("partial employee updates preserve omitted fields and save joinDate", async (t) => {
    const employee = new Employee({ userId: id, firstName: "Test", lastName: "User", email: "test@example.test",
        phone: "123", position: "Engineer", basicSalary: 500, allowances: 25, deductions: 10,
        department: "Engineering", employmentStatus: "INACTIVE", joinDate: "2021-01-01" });
    const account = new User(user());
    const session = {};
    t.mock.method(mongoose.connection, "transaction", async (operation) => operation(session));
    t.mock.method(Employee, "findById", () => ({ session: async () => employee }));
    t.mock.method(User, "findById", () => ({ session: async () => account }));
    t.mock.method(employee, "save", async (options) => assert.equal(options.session, session));
    const accountUpdate = t.mock.method(account, "save", async () => {});
    const res = response();
    await updateEmployee({ params: { id }, body: { joinDate: "2020-01-02", bio: "" } }, res);
    assert.equal(res.code, 200);
    assert.equal(employee.joinDate.toISOString(), "2020-01-02T00:00:00.000Z");
    assert.equal(employee.basicSalary, 500);
    assert.equal(employee.allowances, 25);
    assert.equal(employee.deductions, 10);
    assert.equal(employee.employmentStatus, "INACTIVE");
    assert.equal(employee.bio, "");
    assert.equal(accountUpdate.mock.callCount(), 0);
});

test("invalid employee update values return a validation response", async (t) => {
    t.mock.method(mongoose.connection, "transaction", async () => {
        throw Object.assign(new Error("bad date"), { name: "CastError" });
    });
    const res = response();
    await updateEmployee({ params: { id }, body: { joinDate: "bad-date" } }, res);
    assert.equal(res.code, 400);
});

test("portal checks accept frontend capitalization and reject cross-role or missing portals", async (t) => {
    t.mock.method(User, "findOne", async () => user());
    t.mock.method(Employee, "findOne", async () => null);
    const accepted = response();
    await login({ body: { email: "admin@example.test", password, role_type: "Admin" } }, accepted);
    assert.equal(accepted.code, 200);
    assert.equal(accepted.body.user.role, "ADMIN");
    const rejected = response();
    await login({ body: { email: "admin@example.test", password, role_type: "Employee" } }, rejected);
    assert.equal(rejected.code, 401);
    const missing = response();
    await login({ body: { email: "admin@example.test", password } }, missing);
    assert.equal(missing.code, 400);
});

test("temporary passwords require a different sufficiently long replacement", async (t) => {
    t.mock.method(User, "findById", async () => user({ mustChangePassword: true }));
    let update;
    t.mock.method(User, "findOneAndUpdate", async (_where, fields) => { update = fields; return user({ ...fields.$set, tokenVersion: 1 }); });
    for (const newPassword of [password, "short"]) {
        const res = response();
        await changePassword({ session: { userId: id }, body: { currentPassword: password, newPassword } }, res);
        assert.equal(res.code, 400);
        assert.equal(update, undefined);
    }
    const res = response();
    await changePassword({ session: { userId: id }, body: { currentPassword: password, newPassword: "new-secure-password" } }, res);
    assert.equal(res.code, 200);
    assert.equal(update.$set.mustChangePassword, false);
    assert.equal(update.$inc.tokenVersion, 1);
    assert.equal(await bcrypt.compare("new-secure-password", update.$set.password), true);
    assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET).tokenVersion, 1);
    assert.equal(res.body.user.mustChangePassword, false);
});

test("first-login restriction is enforced by the API and cleared using current database state", async (t) => {
    t.mock.method(Employee, "findOne", async () => null);
    let mustChangePassword = true;
    t.mock.method(User, "findById", () => ({ select: async () => ({ mustChangePassword }) }));
    const token = jwt.sign({ userId: id, role: "ADMIN", mustChangePassword: true }, process.env.JWT_SECRET);
    const request = (url) => ({ headers: { authorization: `Bearer ${token}` }, originalUrl: url });
    let continued = 0;
    const res = response();
    await protect(request("/api/employees"), res, () => continued++);
    assert.equal(res.code, 403);
    assert.equal(continued, 0);
    for (const url of ["/api/auth/session", "/api/auth/change-password"]) {
        await protect(request(url), response(), () => continued++);
    }
    assert.equal(continued, 2);
    mustChangePassword = false;
    const req = request("/api/employees");
    await protect(req, response(), () => continued++);
    assert.equal(continued, 3);
    assert.equal(req.session.mustChangePassword, false);
});

test("database outages during session lookup return 503 rather than invalidating the token", async (t) => {
    t.mock.method(console, "error", () => {});
    t.mock.method(User, "findById", () => ({ select: async () => { throw new Error("offline"); } }));
    const token = jwt.sign({ userId: id }, process.env.JWT_SECRET);
    const res = response();
    await protect({ headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/auth/session" }, res, () => assert.fail("must not continue"));
    assert.equal(res.code, 503);
});

test("seeded admin profile bio can be read and saved without an employee record", async (t) => {
    t.mock.method(Employee, "findOne", async () => null);
    t.mock.method(User, "findById", () => ({ select: async () => user({ bio: "Admin bio" }) }));
    const get = response();
    await getProfile({ session: { userId: id, role: "ADMIN" } }, get);
    assert.equal(get.body.bio, "Admin bio");
    assert.equal(get.body.position, "Administrator");
    let saved;
    t.mock.method(User, "findByIdAndUpdate", async (_id, fields) => { saved = fields; return user(); });
    const put = response();
    await updateProfile({ session: { userId: id, role: "ADMIN" }, body: { bio: "Updated" } }, put);
    assert.equal(put.code, 200);
    assert.deepEqual(saved, { bio: "Updated" });
});

test("overlapping leave submission returns conflict without creating or sending an event", async (t) => {
    mockLeaveTransaction(t, { _id: "existing" });
    const create = t.mock.method(LeaveApplication, "create", async () => assert.fail("must not create"));
    const send = t.mock.method(inngest, "send", async () => assert.fail("must not send"));
    const res = response();
    await createLeave({ session: { userId: id }, body: {
        type: "SICK", startDate: "2090-01-01", endDate: "2090-01-03", reason: "test",
    } }, res);
    assert.equal(res.code, 409);
    assert.equal(create.mock.callCount(), 0);
    assert.equal(send.mock.callCount(), 0);
});

test("valid leave submissions use one transaction and preserve date-only values", async (t) => {
    const session = mockLeaveTransaction(t);
    t.mock.method(LeaveApplication, "create", async ([fields], options) => {
        assert.equal(options.session, session);
        assert.equal(fields.startDate.toISOString(), "2090-01-01T00:00:00.000Z");
        return [{ _id: id, ...fields }];
    });
    t.mock.method(inngest, "send", async () => {});
    const res = response();
    await createLeave({ session: { userId: id }, body: {
        type: "CASUAL", startDate: "2090-01-01", endDate: "2090-01-02", reason: " test ",
    } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.data.reason, "test");
});

test("today, impossible dates, and reversed dates are rejected before any write", async (t) => {
    t.mock.method(Employee, "findOne", async () => ({ _id: id }));
    const transaction = t.mock.method(mongoose.connection, "transaction", async () => assert.fail("must not write"));
    for (const [startDate, endDate] of [
        [todayInIndia(), todayInIndia()], ["2090-02-30", "2090-03-01"], ["2090-01-03", "2090-01-02"],
    ]) {
        const res = response();
        await createLeave({ session: { userId: id }, body: { type: "SICK", startDate, endDate, reason: "test" } }, res);
        assert.equal(res.code, 400);
    }
    assert.equal(transaction.mock.callCount(), 0);
});

test("reactivating a rejected overlapping leave is blocked, but rejection is allowed", async (t) => {
    mockLeaveTransaction(t, { _id: "other-leave" });
    const leave = { _id: id, employeeId: id, startDate: new Date("2090-01-01"), endDate: new Date("2090-01-03") };
    t.mock.method(LeaveApplication, "findById", () => ({ then: (resolve) => Promise.resolve(leave).then(resolve), session: async () => leave }));
    const update = t.mock.method(LeaveApplication, "findByIdAndUpdate", async () => leave);
    const blocked = response();
    await updateLeaveStatus({ params: { id }, body: { status: "APPROVED" } }, blocked);
    assert.equal(blocked.code, 409);
    assert.equal(update.mock.callCount(), 0);
    const rejected = response();
    await updateLeaveStatus({ params: { id }, body: { status: "REJECTED" } }, rejected);
    assert.equal(rejected.code, 200);
    assert.equal(update.mock.callCount(), 1);
});

test("SMTP failure in the reminder cannot prevent the independent automatic checkout", async (t) => {
    const checkIn = new Date("2026-10-21T03:30:00Z");
    t.mock.method(Attendance, "findById", async () => ({ checkIn, checkOut: null }));
    t.mock.method(Employee, "findById", async () => ({ firstName: "Test", email: "test@example.test" }));
    t.mock.method(transporter, "sendMail", async () => { throw new Error("SMTP unavailable"); });
    let checkout;
    t.mock.method(Attendance, "findOneAndUpdate", async (where, update) => {
        assert.equal(where.checkOut, null);
        checkout = update.$set;
    });
    const sleeps = [];
    const step = { run: async (_name, operation) => operation(), sleepUntil: async (_name, date) => sleeps.push(date.toISOString()) };
    const event = { data: { employeeId: id, attendanceId: id } };
    const reminder = functions.find((fn) => fn.opts.id === "check-out-reminder");
    const auto = functions.find((fn) => fn.opts.id === "auto-check-out");
    await assert.rejects(reminder.fn({ event, step }), /SMTP unavailable/);
    await auto.fn({ event, step });
    assert.deepEqual(sleeps, ["2026-10-21T12:30:00.000Z", "2026-10-21T13:30:00.000Z"]);
    assert.equal(checkout.workingHours, 4);
});

test("Vercel configuration is available under the recognized filename", async () => {
    const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
    assert.equal(config.routes[0].dest, "server.js");
});
