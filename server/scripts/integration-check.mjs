import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

const uri = process.env.EMS_VALIDATION_MONGODB_URI;
if (!uri) throw new Error("Set EMS_VALIDATION_MONGODB_URI to an isolated local replica-set database named ems_validation_...");
const target = new URL(uri);
if (!["127.0.0.1", "localhost"].includes(target.hostname) || !/^\/ems_validation_[a-z0-9_]+$/.test(target.pathname)) {
    throw new Error("Integration checks only run against a separate local ems_validation_ database");
}

mongoose.set("autoCreate", false);
mongoose.set("autoIndex", false);
process.env.JWT_SECRET = randomBytes(32).toString("hex");
const { default: app } = await import("../app.js");
const { inngest } = await import("../inngest/index.js");
const { default: User } = await import("../models/User.js");
const { default: Employee } = await import("../models/Employee.js");
const { default: Attendance } = await import("../models/Attendance.js");
const { default: LeaveApplication } = await import("../models/LeaveApplication.js");
const { default: Payslip } = await import("../models/Payslip.js");
const { default: PendingEvent } = await import("../models/PendingEvent.js");
const { deliverEvent } = await import("../utils/events.js");
const { todayInIndia } = await import("../utils/leaveDates.js");
const models = [User, Employee, Attendance, LeaveApplication, Payslip, PendingEvent];

const sentEvents = [];
let failDelivery = false;
const originalSend = inngest.send;
inngest.send = async (event) => {
    if (failDelivery) throw new Error("Intentional isolated-test event delivery failure");
    sentEvents.push(event);
    return { ids: [event.id] };
};
let server;
let createdDatabase = false;
let checks = 0;
function checked(message) { checks++; console.log(`PASS: ${message}`); }

try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.ok(hello.setName || hello.msg === "isdbgrid", "A transaction-capable local replica set is required");
    const existing = await mongoose.connection.db.listCollections().toArray();
    assert.equal(existing.length, 0, "Use an empty validation database; existing data will not be changed");
    createdDatabase = true;
    for (const model of models) { await model.createCollection(); await model.createIndexes(); }
    server = await new Promise((resolve) => { const http = app.listen(0, "127.0.0.1", () => resolve(http)); });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function api(path, { method = "GET", token, body } = {}) {
        const response = await fetch(base + path, {
            method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: response.status, body: await response.json() };
    }
    const temporaryPassword = randomBytes(24).toString("base64url");
    const newPassword = randomBytes(24).toString("base64url");
    const admin = await User.create({ email: "integration.admin@example.test", password: await bcrypt.hash(temporaryPassword, 10), role: "ADMIN", mustChangePassword: true });
    let result = await api("/auth/login", { method: "POST", body: { email: admin.email, password: temporaryPassword, role_type: "Admin" } });
    assert.equal(result.status, 200);
    const temporaryToken = result.body.token;
    assert.equal((await api("/employees", { token: temporaryToken })).status, 403);
    result = await api("/auth/change-password", { method: "POST", token: temporaryToken, body: { currentPassword: temporaryPassword, newPassword } });
    assert.equal(result.status, 200);
    const adminToken = result.body.token;
    assert.equal((await api("/auth/session", { token: temporaryToken })).status, 401);
    assert.equal((await api("/auth/session", { token: adminToken })).status, 200);
    checked("first-login password replacement, token renewal, and old-token rejection through HTTP");

    assert.equal((await api("/profile", { method: "POST", token: adminToken, body: { bio: "Integration admin bio" } })).status, 200);
    assert.equal((await api("/profile", { token: adminToken })).body.bio, "Integration admin bio");
    checked("admin profile persistence without an employee record");

    const employeePassword = randomBytes(24).toString("base64url");
    const employeeBody = { firstName: "Integration", lastName: "Employee", email: "integration.employee@example.test", password: employeePassword,
        phone: "1234567890", position: "Engineer", department: "Engineering", joinDate: "2026-01-01", basicSalary: 5000, allowances: 100, deductions: 50 };
    const [first, duplicate] = await Promise.all([
        api("/employees", { method: "POST", token: adminToken, body: employeeBody }),
        api("/employees", { method: "POST", token: adminToken, body: employeeBody }),
    ]);
    assert.deepEqual([first.status, duplicate.status].sort(), [201, 400]);
    assert.equal(await User.countDocuments({ email: employeeBody.email }), 1);
    assert.equal(await Employee.countDocuments({ email: employeeBody.email }), 1);
    const employee = await Employee.findOne({ email: employeeBody.email });
    checked("concurrent employee creation leaves exactly one linked account and profile");

    result = await api(`/employees/${employee._id}`, { method: "PUT", token: adminToken, body: { email: admin.email } });
    assert.equal(result.status, 400);
    assert.equal((await Employee.findById(employee._id)).email, employeeBody.email);
    result = await api(`/employees/${employee._id}`, { method: "PUT", token: adminToken, body: { joinDate: "2025-12-01" } });
    assert.equal(result.status, 200);
    const updated = await Employee.findById(employee._id);
    assert.equal(updated.joinDate.toISOString(), "2025-12-01T00:00:00.000Z");
    assert.equal(updated.basicSalary, 5000);
    checked("duplicate-email rollback and partial employee updates use real transactions");

    result = await api("/auth/login", { method: "POST", body: { email: employeeBody.email, password: employeePassword, role_type: "Employee" } });
    assert.equal(result.status, 200);
    const employeeToken = result.body.token;
    assert.equal((await api("/employees", { token: employeeToken })).status, 403);
    failDelivery = true;
    const clockIn = () => api("/attendance", { method: "POST", token: employeeToken, body: { action: "CHECK_IN" } });
    const checkIns = await Promise.all([clockIn(), clockIn()]);
    assert.ok(checkIns.every((res) => res.status === 200 && res.body.type === "CHECK_IN"));
    assert.equal(await Attendance.countDocuments({ employeeId: employee._id }), 1);
    assert.equal(await PendingEvent.countDocuments({ name: "employee/check-out" }), 1);
    failDelivery = false;
    for (const event of await PendingEvent.find()) assert.equal(await deliverEvent(inngest, event), true);
    assert.equal(await PendingEvent.countDocuments(), 0);
    const checkOuts = await Promise.all([1, 2].map(() => api("/attendance", { method: "POST", token: employeeToken, body: { action: "CHECK_OUT" } })));
    assert.ok(checkOuts.every((res) => res.status === 200 && res.body.type === "CHECK_OUT"));
    assert.ok((await Attendance.findOne({ employeeId: employee._id })).checkOut);
    checked("concurrent clock-in/out, failed-event retention, and recovery without contacting Inngest");

    const tomorrow = new Date(`${todayInIndia()}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const leaveBody = { type: "CASUAL", startDate: tomorrow.toISOString().slice(0, 10), endDate: tomorrow.toISOString().slice(0, 10), reason: "Integration validation" };
    const leaves = await Promise.all([1, 2].map(() => api("/leave", { method: "POST", token: employeeToken, body: leaveBody })));
    assert.deepEqual(leaves.map((res) => res.status).sort(), [200, 409]);
    const leave = await LeaveApplication.findOne({ employeeId: employee._id });
    assert.equal((await api(`/leave/${leave._id}`, { method: "PATCH", token: adminToken, body: { status: "APPROVED" } })).status, 200);
    assert.equal((await LeaveApplication.findById(leave._id)).status, "APPROVED");
    checked("concurrent overlapping leave requests and admin approval through HTTP");

    const payslipBody = { employeeId: employee._id.toString(), month: 10, year: 2026, basicSalary: 5000, allowances: 100.30, deductions: 50.10 };
    const slips = await Promise.all([1, 2].map(() => api("/payslips", { method: "POST", token: adminToken, body: payslipBody })));
    assert.deepEqual(slips.map((res) => res.status).sort(), [200, 409]);
    const payslip = await Payslip.findOne({ employeeId: employee._id });
    assert.equal(payslip.netSalary, 5050.20);
    assert.equal((await api(`/payslips/${payslip._id}`, { token: employeeToken })).status, 200);
    const other = await User.create({ email: "integration.other@example.test", password: await bcrypt.hash(employeePassword, 10), role: "EMPLOYEE" });
    await Employee.create({ ...employeeBody, email: other.email, userId: other._id });
    const otherLogin = await api("/auth/login", { method: "POST", body: { email: other.email, password: employeePassword, role_type: "Employee" } });
    assert.equal((await api(`/payslips/${payslip._id}`, { token: otherLogin.body.token })).status, 404);
    checked("concurrent payroll generation, decimal totals, owner access, and cross-employee denial");

    assert.equal((await api("/dashboard", { token: adminToken })).status, 200);
    assert.equal((await api("/dashboard", { token: employeeToken })).status, 200);
    assert.equal((await api(`/employees/${employee._id}`, { method: "PUT", token: adminToken, body: { employmentStatus: "INACTIVE" } })).status, 200);
    assert.equal((await api("/auth/session", { token: employeeToken })).status, 401);
    checked("both dashboard roles and immediate blocking of inactive employees");
    console.log(`All ${checks} live HTTP/database integration groups passed. External event delivery was intercepted locally.`);
} finally {
    inngest.send = originalSend;
    if (server) await new Promise((resolve) => server.close(resolve));
    if (createdDatabase && mongoose.connection.readyState === 1) {
        // Only the database verified empty above is cleaned up; configured application data is never used.
        for (const model of models) await model.deleteMany({});
    }
    await mongoose.disconnect();
}
