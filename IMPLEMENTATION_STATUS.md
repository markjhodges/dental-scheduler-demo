# Implementation status

## Built

- Next.js/TypeScript web app and versioned `/api/v1` routes, PostgreSQL migrations, synthetic fixtures, separate worker, CI, and local Compose database definition.
- Patient, owner, staff, and dentist demo roles; server-side patient links and guardian scopes; challenge verification through a synthetic local inbox; sessions, origin checks, access checks, and append-only audit events.
- Routine scheduling rules, provider calendar, eligibility, room and provider allocation, pending intents, idempotent commands, accepted-write reconciliation, safe in-place moves, exact 24-hour cutoff, cancellation, projection sync, and notification outbox.
- Patient overview, recare, prior providers/favorites, imaging preference, history/feedback, records requests, treatment-plan display, dentist-approved durations, staff queue, and owner feedback report.
- Explicit unavailable benefits estimator and disabled patient-facing treatment booking. No $0 or treatment cost is shown without a validated source.

## Verified locally

- `npm run typecheck` passed.
- `npm test` passed four pure domain tests; two PostgreSQL integration tests were skipped because this computer has no local PostgreSQL service.
- `npm run build` passed with Next.js 16.4.6. Dependency installation reported zero npm vulnerabilities after updates.

## Next verification step

Start PostgreSQL with `docker compose up -d` or an existing server, set `.env.local`, run `npm run db:migrate`, then set `RUN_DB_TESTS=1` and run `npm test`. Launch `npm run dev` and `npm run worker`, then exercise patient booking, competing claims, changes, guardian revocation, and the owner calendar in a browser. CI runs these database tests against a fresh PostgreSQL service.

## Gated future work

Ascend sandbox access and verified booking conflict behavior; practice-approved identity and guardian proofing; final exam durations, intake requirements, treatment sequences, and benefits estimates; production authentication/MFA, messaging/storage, privacy and security review, and a separate clean live environment. The web app refuses `APP_MODE` values other than `synthetic`.
