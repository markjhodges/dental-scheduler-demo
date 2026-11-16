# Dental Scheduler

A synthetic, single-practice dental scheduling app built as a Next.js modular monolith with PostgreSQL and a separate worker. `spec.md` defines product behavior; `arch.md` defines the technical direction. All seeded identities and messages are fictional.

## Project intent

This is an independent portfolio concept inspired by [Pearl's focus on clearer care and practice operations](https://hellopearl.com/). Its visual direction uses deep navy, bright blue, pale blue surfaces, rounded cards, and a small coral accent. It is not a Pearl product, integration, or endorsement, and it does not use Pearl branding or patient data.

The scheduling work explores a problem Pearl [describes on its site](https://hellopearl.com/): reducing front desk effort while making care easier for patients to understand. The demo emphasizes provider and room constraints, explicit confirmation, safe appointment moves, and human review where the system cannot make a reliable decision.

## Run locally

1. Install Node.js 24 and PostgreSQL 16 or later. If Docker is available, `docker compose up -d` starts the local database on port 5433. Otherwise create an empty database and a database user with schema and extension privileges.
2. Copy `.env.example` to `.env.local` and set `DATABASE_URL`. Keep `APP_MODE=synthetic`. The scripts load `.env.local` automatically.
3. Run `npm install`, `npm run db:migrate`, and `npm run dev`.
4. In a second terminal, run `npm run worker`. Open `http://localhost:3000`.

Run `npm run typecheck`, `npm test`, and `npm run build` for local checks. Database integration tests run when `RUN_DB_TESTS=1` is set against a migrated synthetic database; CI does this with a fresh PostgreSQL service. The simulator supports `SIMULATOR_DELAY_MS`, `SIMULATOR_OUTAGE=1`, `SIMULATOR_REJECT_WRITES=1`, and `SIMULATOR_LOST_RESPONSE=1` for fault exercises.

The PowerShell script commands use `npm.cmd` when script execution policy blocks `npm.ps1`. A synthetic-only reset is available with `RESET_SYNTHETIC=YES npm run db:reset`; it deletes both app and simulator schemas and recreates fixtures. Do not point it at a database with real data.

## What works

- Fictional patient and owner roles, challenge-based demo verification, patient links and explicit guardian grant, server-side access checks, session cookies, audit events.
- Provider calendar with repeating hours and date exceptions, versioned scheduling rules, eligibility and full-visit hygienist/dentist/room allocation.
- Candidate search, expiring pending intent, idempotent confirmation, database-enforced resource conflicts, safe in-place moves, 24-hour change cutoff, cancellation, unknown-result reconciliation.
- Appointment, recare, imaging-preference, favorite, history, feedback, record-request, treatment-plan, dentist duration, staff-review, and owner-report screens.
- Separate simulator tables behind `PracticeSystem`, persistent seeded fixtures, local inbox, transactional outbox and worker.

## Boundaries

`APP_MODE=synthetic` is the only supported deployment mode. The code refuses to start the adapter or worker in another mode. Demo role selection and local inbox are intentionally available only in synthetic mode. Treatment request creation requires `FEATURE_TREATMENT_REQUESTS=1`; direct treatment booking and cost display remain disabled pending approved rules and reliable estimates. Periodic exam remains unbookable until the practice supplies its duration. There is no Ascend adapter or real-data deployment path yet.

The calendar is an additional local restriction, not an Ascend Provider Hours editor. An intent is a pending selection, not a held slot. Emails are delivered to the synthetic local inbox. Intake uploads and production identity recovery are not enabled.

Before any real patient data: validate Ascend conflict and reconciliation behavior in its sandbox, complete the practice's identity/guardian and estimate decisions, add staff MFA and production identity, configure private messaging/storage and backups, and complete the specified privacy/security review.
