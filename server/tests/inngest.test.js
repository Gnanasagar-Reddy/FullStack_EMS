import test from "node:test";
import assert from "node:assert/strict";
import { NonRetriableError } from "inngest";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import PendingEvent from "../models/PendingEvent.js";
import { transporter } from "../config/nodemailer.js";
import { functions } from "../inngest/index.js";
import { deliverEvent } from "../utils/events.js";

const id = "507f1f77bcf86cd799439011";
const otherId = "507f1f77bcf86cd799439012";
const fn = (name) => functions.find((item) => item.opts.id === name).fn;

// Model durable checkpoints: values are serialized and completed steps are cached.
function steps() {
    const cache = new Map();
    const sleeps = new Map();
    return {
        cache, sleeps,
        async run(name, operation) {
            if (!cache.has(name)) cache.set(name, JSON.parse(JSON.stringify((await operation()) ?? null)));
            return cache.get(name);
        },
        async sleepUntil(name, date) {
            const time = date.toISOString();
            if (sleeps.has(name)) assert.equal(time, sleeps.get(name), "Sleep deadline must stay stable during replay");
            sleeps.set(name, time);
        },
    };
}

function mockDailyCandidates(t, ids = [id]) {
    const employees = ids.map((_id) => ({ _id, firstName: "Test", department: "Engineering", employmentStatus: "ACTIVE", email: `${_id}@example.test` }));
    t.mock.method(Employee, "find", () => ({ lean: async () => employees }));
    t.mock.method(Employee, "findById", async (_id) => employees.find((employee) => employee._id === _id));
    t.mock.method(Attendance, "find", () => ({ lean: async () => [] }));
    t.mock.method(LeaveApplication, "find", () => ({ lean: async () => [] }));
    t.mock.method(Attendance, "exists", async () => null);
    t.mock.method(LeaveApplication, "exists", async () => null);
    return employees;
}

test("all five functions retain stable IDs and the expected event/schedule triggers", () => {
    const config = new Map(functions.map((item) => [item.opts.id, item.opts.triggers]));
    assert.equal(config.size, 5);
    assert.deepEqual(config.get("auto-check-out"), [{ event: "employee/check-out" }]);
    assert.deepEqual(config.get("check-out-reminder"), [{ event: "employee/check-out" }]);
    assert.deepEqual(config.get("leave-application-reminder"), [{ event: "leave/pending" }]);
    assert.deepEqual(config.get("attendance-reminder-cron"), [{ cron: "TZ=Asia/Kolkata 30 11 * * *" }]);
    assert.deepEqual(config.get("pending-event-retry"), [{ cron: "*/5 * * * *" }]);
});

test("malformed event IDs fail without retriable database errors", async (t) => {
    const lookup = t.mock.method(Attendance, "findById", async () => assert.fail("must not query"));
    for (const name of ["auto-check-out", "check-out-reminder", "leave-application-reminder"]) {
        await assert.rejects(fn(name)({ event: { data: {} }, step: steps() }), NonRetriableError);
    }
    assert.equal(lookup.mock.callCount(), 0);
});

test("leave reminder uses the application's creation time and sends only once on replay", async (t) => {
    const createdAt = new Date("2026-01-01T04:00:00Z");
    const application = { _id: id, employeeId: otherId, createdAt, status: "PENDING" };
    t.mock.method(LeaveApplication, "findById", async () => application);
    t.mock.method(Employee, "findById", async () => ({ firstName: "Test", department: "Engineering", email: "employee@example.test" }));
    const mail = t.mock.method(transporter, "sendMail", async () => ({ accepted: [] }));
    const step = steps();
    const event = { data: { leaveApplicationId: id }, ts: Date.parse("2026-01-05T04:00:00Z") };
    await fn("leave-application-reminder")({ event, step });
    await fn("leave-application-reminder")({ event, step });
    assert.equal(step.sleeps.get("wait-for-the-24-hours"), "2026-01-02T04:00:00.000Z");
    assert.equal(mail.mock.callCount(), 1);
});

test("leave approval during the sleep prevents the reminder", async (t) => {
    const application = { employeeId: otherId, createdAt: new Date(), status: "PENDING" };
    t.mock.method(LeaveApplication, "findById", async () => application);
    const mail = t.mock.method(transporter, "sendMail", async () => assert.fail("must not send"));
    const step = steps();
    step.sleepUntil = async () => { application.status = "APPROVED"; };
    await fn("leave-application-reminder")({ event: { data: { leaveApplicationId: id } }, step });
    assert.equal(mail.mock.callCount(), 0);
});

test("deleted leave applications do not sleep or send mail", async (t) => {
    t.mock.method(LeaveApplication, "findById", async () => null);
    const step = steps();
    await fn("leave-application-reminder")({ event: { data: { leaveApplicationId: id } }, step });
    assert.equal(step.sleeps.size, 0);
});

test("checkout reminder uses the attendance owner and skips deactivated employees", async (t) => {
    t.mock.method(Attendance, "findById", async () => ({ employeeId: otherId, checkIn: new Date(), checkOut: null }));
    t.mock.method(Employee, "findById", async (owner) => {
        assert.equal(owner, otherId);
        return { isDeleted: true };
    });
    const mail = t.mock.method(transporter, "sendMail", async () => assert.fail("must not send"));
    await fn("check-out-reminder")({ event: { data: { attendanceId: id, employeeId: id } }, step: steps() });
    assert.equal(mail.mock.callCount(), 0);
});

test("one failed daily email does not resend an earlier successful recipient", async (t) => {
    mockDailyCandidates(t, [id, otherId]);
    const calls = [];
    let failSecond = true;
    t.mock.method(transporter, "sendMail", async (message) => {
        calls.push(message.to);
        if (message.to.startsWith(otherId) && failSecond) throw new Error("SMTP temporary failure");
        return { accepted: [] };
    });
    const step = steps();
    const event = { ts: Date.now() };
    await assert.rejects(fn("attendance-reminder-cron")({ event, step }), /SMTP temporary failure/);
    failSecond = false;
    const result = await fn("attendance-reminder-cron")({ event, step });
    assert.equal(result.emailsSent, 2);
    assert.equal(calls.filter((address) => address.startsWith(id)).length, 1);
    assert.equal(calls.filter((address) => address.startsWith(otherId)).length, 2);
});

test("daily reminder rechecks a late check-in before sending", async (t) => {
    mockDailyCandidates(t);
    t.mock.method(Attendance, "exists", async () => ({ _id: otherId }));
    const mail = t.mock.method(transporter, "sendMail", async () => assert.fail("must not send"));
    const result = await fn("attendance-reminder-cron")({ event: { ts: Date.now() }, step: steps() });
    assert.equal(result.emailsSent, 0);
    assert.equal(mail.mock.callCount(), 0);
});

test("daily reminder rechecks approved leave before sending", async (t) => {
    mockDailyCandidates(t);
    t.mock.method(LeaveApplication, "exists", async () => ({ _id: otherId }));
    const mail = t.mock.method(transporter, "sendMail", async () => assert.fail("must not send"));
    const result = await fn("attendance-reminder-cron")({ event: { ts: Date.now() }, step: steps() });
    assert.equal(result.emailsSent, 0);
    assert.equal(mail.mock.callCount(), 0);
});

test("daily reminder skips a historical run rather than emailing for a previous day", async (t) => {
    mockDailyCandidates(t);
    const mail = t.mock.method(transporter, "sendMail", async () => assert.fail("must not send"));
    const result = await fn("attendance-reminder-cron")({ event: { ts: Date.now() - 48 * 60 * 60 * 1000 }, step: steps() });
    assert.equal(result.emailsSent, 0);
    assert.equal(mail.mock.callCount(), 0);
});

test("outbox delivery preserves the original event time and stable deduplication ID", async (t) => {
    t.mock.method(PendingEvent, "deleteOne", async () => {});
    let sent;
    const event = { _id: id, name: "leave/pending", data: { leaveApplicationId: otherId }, createdAt: new Date("2026-01-01T04:00:00Z") };
    assert.equal(await deliverEvent({ send: async (payload) => { sent = payload; } }, event), true);
    assert.equal(sent.id, id);
    assert.equal(sent.ts, event.createdAt.getTime());
});

test("pending-event retry selects least recently attempted records and limits overlapping workers", async (t) => {
    const retry = functions.find((item) => item.opts.id === "pending-event-retry");
    assert.deepEqual(retry.opts.concurrency, { limit: 1 });
    t.mock.method(PendingEvent, "find", () => ({ sort: (sort) => {
        assert.deepEqual(sort, { lastAttemptAt: 1, createdAt: 1 });
        return { limit: () => ({ lean: async () => [] }) };
    } }));
    assert.deepEqual(await retry.fn({ step: steps() }), { delivered: 0, pending: 0 });
});
