Run `npm install`, configure the server environment, then use `npm start`.

Employee/account writes, attendance, payroll, and leave operations use MongoDB transactions to prevent partial writes and concurrent duplicates. Use MongoDB Atlas, a replica set, or a sharded cluster; a standalone local MongoDB instance does not support these transactions.

To create an admin, set `ADMIN_EMAIL` and run `npm run seed`. You can set `ADMIN_PASSWORD` to a temporary password of at least 12 characters. If omitted, the seed generates a random password and prints it once. Newly seeded admins must change that password before accessing the application. The seed leaves existing accounts unchanged; change existing admin passwords through Settings.

Use `npm test` for isolated regression checks. These tests mock database and email operations and do not modify live records or send email.

Use `npm run test:integration` with `EMS_VALIDATION_MONGODB_URI` set to an empty local replica-set database, for example `mongodb://127.0.0.1:27028/ems_validation_checks?replicaSet=ems_validation`. This runs the actual Express routes and MongoDB transactions, including concurrent requests and rollback checks. It rejects remote databases and names without the `ems_validation_` prefix, refuses databases with existing collections, and removes its test documents afterward. Inngest delivery is intercepted locally; no external events or emails are sent. The normal `MONGODB_URI` setting is not changed.

For Vercel, configure this directory as the project root and supply the same environment variables through deployment settings. The backend configuration is `vercel.json`. Sync the `/api/inngest` endpoint after deployment to register checkout, reminder, and pending-event retry functions. Failed event deliveries remain in `PendingEvent` and are retried every five minutes with a stable event ID.

See [INNGEST_SETUP.md](./INNGEST_SETUP.md) for the five functions, Cloud sync steps, local PowerShell commands, and verification instructions.

Clock-in/out requests must include `{ "action": "CHECK_IN" }` or `{ "action": "CHECK_OUT" }`; repeated submissions of the same action do not reverse it. Attendance dates, the late-arrival cutoff, dashboard boundaries, and reminders use Asia/Kolkata.

Session checks use the current account role and employee status. Password changes and admin password/role changes invalidate prior tokens. Existing tokens without a version remain valid only while the account version is still zero.

These code changes do not repair historical orphan accounts, mismatched emails, duplicate payslips, or attendance recorded under the wrong timezone. Inspect and repair live data separately; no cleanup, credential rotation, deployment, or Inngest sync is performed by the test suite.
