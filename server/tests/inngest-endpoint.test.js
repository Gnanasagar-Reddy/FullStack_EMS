import test from "node:test";
import assert from "node:assert/strict";

process.env.INNGEST_DEV = "0";
process.env.INNGEST_SIGNING_KEY = `signkey-prod-${"a".repeat(64)}`;
const { default: app } = await import("../app.js");

test("production Inngest endpoint rejects unsigned and invalidly signed requests", async (t) => {
    t.mock.method(console, "error", () => {});
    t.mock.method(console, "warn", () => {});
    const server = await new Promise((resolve) => {
        const http = app.listen(0, "127.0.0.1", () => resolve(http));
    });
    try {
        const url = `http://127.0.0.1:${server.address().port}/api/inngest`;
        assert.equal((await fetch(url)).status, 401);
        const invalid = await fetch(url, { method: "POST", headers: {
            "Content-Type": "application/json", "x-inngest-signature": "invalid",
        }, body: "{}" });
        assert.equal(invalid.status, 401);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
