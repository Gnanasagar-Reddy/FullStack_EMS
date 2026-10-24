# Inngest setup for this EMS

The backend serves five functions at `/api/inngest`. The app ID is `fullstack-ems`; keep it unchanged when syncing.

| Function | Trigger | Result |
| --- | --- | --- |
| `auto-check-out` | `employee/check-out` | Waits until 10 hours after the stored check-in, then checks out an open attendance record. |
| `check-out-reminder` | `employee/check-out` | Sends an employee reminder at check-in + 9 hours if the employee is active and still checked in. |
| `leave-application-reminder` | `leave/pending` | Reminds the admin at application creation + 24 hours if the request is still pending and the employee remains active. |
| `attendance-reminder-cron` | Daily at 11:30 AM Asia/Kolkata | Reminds active employees who have neither checked in nor received approved leave. Rechecks before sending. |
| `pending-event-retry` | Every 5 minutes | Retries up to 100 saved events, prioritizing those least recently attempted. |

The existing automatic-checkout rule records **4 hours, Half Day, LATE**, even though it runs after 10 hours. This policy has been preserved; it is separate from the scheduling fixes.

## Inngest Cloud

1. Choose the intended environment in the Inngest dashboard.
2. Put that environment's **Event Key** in the backend host's `INNGEST_EVENT_KEY`, and its **Signing Key** in `INNGEST_SIGNING_KEY`. A key in local `server/.env` does not configure the deployed host. Keep these server-side; do not add them as `VITE_` variables.
3. Leave `INNGEST_DEV` unset in the deployed environment. The backend also needs its normal `MONGODB_URI`, `JWT_SECRET`, and email configuration.
4. Deploy the updated backend. Its publicly reachable HTTPS endpoint must be `https://YOUR-BACKEND-HOST/api/inngest`, using the **backend** host rather than the frontend host or localhost.
5. In Inngest, open **Apps**, choose **Sync new app**, and enter that URL. If `fullstack-ems` already exists, open it and **Resync** after deployment. Verify five functions appear, with the triggers listed above.
6. Check the app's sync status and function runs. If a Vercel deployment is protected, use the documented Inngest/Vercel automation bypass configuration so Inngest can reach it; keep the SDK signing check enabled.

The signing key selects the sync environment; use the corresponding Event Key when sending events. The SDK verifies signatures itself. An unsigned browser request to `/api/inngest` can return **401** in production; this does not by itself indicate a broken sync. Use the Inngest sync result to diagnose signing or reachability problems.

Official references: [apps and syncs](https://www.inngest.com/docs/platform-and-operations/apps-and-syncs), [keys](https://www.inngest.com/docs/platform-and-operations/keys-and-access), [Vercel deployment](https://www.inngest.com/docs/durable-execution/deploying-functions/platforms/vercel).

## Local development on Windows

In a PowerShell terminal, from `server`:

```powershell
$env:INNGEST_DEV="1"
npm.cmd start
```

In a second terminal, start the local Dev Server:

```powershell
npx.cmd --ignore-scripts=false inngest-cli@latest dev --no-discovery -u http://localhost:4000/api/inngest
```

Open `http://localhost:8288`. Confirm the app and all five functions appear. Replace port 4000 if your backend uses a different `PORT`.

Local SDK mode sends events to the Dev Server instead of Cloud. Use a test database and test email configuration for development, since the functions still execute your actual database and mail code. See [official local development instructions](https://www.inngest.com/docs/local-development).

## Verify the workflows

For local code checks, run `npm.cmd test` from `server`. Wait steps are mocked, so these tests finish without waiting 9, 10, or 24 hours, and no email or cloud events are sent.

For an end-to-end Dev Server or Cloud check, create a disposable employee and use the EMS UI:

1. Clock in. Look for `employee/check-out` in **Events**. It starts both the checkout reminder and automatic checkout. Their runs should show the stored-check-in deadlines.
2. Clock out before the reminder. On resumption, the reminder should skip and automatic checkout should preserve the manual checkout.
3. Submit future leave. Look for `leave/pending`, then the `leave-application-reminder` run. Approval before its deadline should suppress the email.
4. Inspect the two cron functions' runs: the attendance reminder runs at 11:30 AM IST; the pending-event worker runs every five minutes. Successful SMTP recipients are separate steps, so another recipient's failure does not resend completed emails on the same run.

When using a dashboard “Send event” action, use IDs of disposable records that actually exist in the same database as the backend. The application normally produces these events itself:

```json
{
  "name": "employee/check-out",
  "data": {
    "employeeId": "ACTUAL_EMPLOYEE_OBJECT_ID",
    "attendanceId": "ACTUAL_ATTENDANCE_OBJECT_ID"
  }
}
```

```json
{
  "name": "leave/pending",
  "data": {
    "leaveApplicationId": "ACTUAL_PENDING_LEAVE_OBJECT_ID"
  }
}
```

The placeholders are not valid IDs. Malformed IDs fail without repeated database retries; deleted records are skipped. Re-sending a fresh event for an old record does not reset the stored check-in/application deadline.

SMTP currently needs valid Brevo credentials before email steps can succeed. A working Inngest run cannot fix a `535 Authentication failed` response from Brevo. Automatic checkout remains independent of email failures.

Keep the existing function IDs and step IDs stable when changing deployed workflows. Check any already-running older workflows after resync; cancel obsolete test runs through the dashboard if needed. [Durable execution concepts](https://www.inngest.com/docs/durable-execution/concepts) explain how completed step results are reused on replay.
