# Dental Scheduler Architecture

## Direction

Build a modular monolith for one practice, using synthetic data first. Use `spec.md` as the product authority; unresolved clinical, identity, and integration decisions remain configurable or disabled. This document proposes architecture only.

Proposed stack: TypeScript, React/Next.js for the responsive web app and server API, PostgreSQL for persistence, and a Node.js background worker from the same repository. Use SQL migrations and shared runtime validation for API inputs. Pin supported versions during implementation. Defer native apps, microservices, machine learning, and separate search infrastructure.

```text
Patient / staff web browser
            |
      Web app + /api/v1
            |
 Identity | Scheduling | Treatment | Feedback | Admin
            |
 PostgreSQL + transactional outbox
            |
 Background worker ---- Messaging / private file storage
            |
 Practice-system adapter
     |                  |
 Synthetic simulator    Dentrix Ascend (later)
```

Keep business rules in framework-independent modules shared by API handlers and workers. Browsers never access the database or Ascend directly. A versioned API supports future mobile clients.

## Modules and ownership

| Module | Responsibilities |
| --- | --- |
| Identity and access | Accounts, record matching, verification challenges, sessions, staff roles, guardian grants, recovery review |
| Patient portal | Authorized patient profiles, appointment history, provider preferences, recare and imaging information |
| Scheduling | Availability, resource allocation, duration rules, booking/change/cancellation commands, reconciliation |
| Practice administration | Provider calendar, recurring hours, dated exceptions, operatories, eligibility rules, review queue |
| Treatment | Plan projections, diagnosing dentist, visit sequences, dentist-approved durations, review requests |
| Benefits and estimates | Separate coverage checks and cost estimates, provenance, freshness, patient-facing display policy |
| Feedback | Appointment-linked ratings/comments; patient access to own submissions and owner/admin reporting |
| Operations | Audit events, intake requirements, record requests, notifications, jobs, integration health |

Each module owns its writes. Other modules call its application services rather than updating its tables directly. API handlers validate input and authorize the action; application services enforce domain rules and transaction boundaries.

## Data model and source of truth

Use UUIDs internally and separate external identifiers. Include `practice_id` on practice-owned records, foreign keys, uniqueness constraints, and queries from day one. Resolve practice membership server-side. One practice is active initially; cross-practice administration is deferred.

Core entities:

- `Practice`, `Location`, `Account`, `PracticeMembership`, `PatientLink`, `GuardianGrant`, `VerificationChallenge`.
- `Patient`, `Provider`, `Operatory`, `AppointmentType`, `SchedulingRuleVersion`, `ProviderHours`, `AvailabilityException`.
- `Appointment`, `ResourceAllocation`, `BookingIntent`, `BookingOperation`, `ReviewTask`.
- `TreatmentPlan`, `TreatmentVisit`, `VisitDependency`, `CoverageCheck`, `CostEstimate`.
- `ProviderFavorite`, `Feedback`, `IntakeRequirement`, `IntakeSubmission`, `RecordRequest`.
- `ExternalMapping`, `SyncCheckpoint`, `OutboxEvent`, `AuditEvent`.

Store instants in UTC and each location's IANA timezone, initially `America/Los_Angeles`. Recurring hours use local wall-clock time; generate dated intervals with explicit daylight-saving handling. Store monetary values in integer minor units with currency. Persist scheduling rule versions and operation identifiers for traceability.

In synthetic mode, the simulator owns patient and appointment records. Once connected, Ascend owns those records and treatment/recare facts; local copies are projections with source timestamps and synchronization status. The app owns accounts, guardian grants, favorites, feedback, workflow state, and app-specific policies. Avoid dual ownership of appointment state.

Initially the app owns its provider calendar. In live mode, treat that calendar as an additional restriction on validated Ascend availability until the practice approves a single operational workflow. Do not assume calendar edits can write Ascend Provider Hours.

## Synthetic data and integration boundary

Define a `PracticeSystem` interface for patient matching, patient/history reads, providers/resources, availability, appointment reads/writes, treatment plans, and recare. Keep benefits estimation behind a separate interface because its source is unresolved. Normalize external responses into domain types and expose explicit capability flags for unsupported operations.

Implement `SyntheticPracticeSystem` first as a persistent, separate schema in the development database. Keep simulator writes behind the same adapter contract that Ascend will use; the app must not reach into simulator tables. This preserves the external-system boundary, including independent commits and delayed responses.

Provide deterministic, seeded fixtures and a reset command restricted to synthetic environments. Include duplicate identities, shared contacts, authorized/unauthorized guardians, missing benefits, provider absences/departures, multi-resource visits, and competing bookings. Simulate delays, outages, rejected writes, accepted writes with lost responses, and stale reads. Run the same adapter contract tests against the simulator and later the vendor sandbox.

Use visibly fictional identities and reserved example contact addresses. Route SMS/email to a local inbox and use fake intake files. Verification shortcuts are available only in synthetic deployments and must fail startup in live mode. Label demo screens and estimates as synthetic. Never migrate fixture records into production.

## Scheduling and booking correctness

Availability is the intersection of provider hours and exceptions, eligible provider/operatory combinations, appointment duration, existing allocations, and required additional resources. Favorites affect ranking or explicit filters, never eligibility.

Represent a visit as resource intervals: a hygienist and room may be required throughout, while a dentist participates for a configured segment. Until exam timing is approved, use a conservative full-visit dentist allocation or staff review. Unconfigured appointment types cannot book immediately. Store initial duration examples as editable rules; do not invent missing exam durations.

Booking flow:

1. Search availability and return candidate times with rule version and freshness metadata.
2. Create an expiring `BookingIntent` for the selected slot. Display it as pending; it does not guarantee an Ascend reservation.
3. On confirmation, recheck patient authorization, appointment eligibility, current resource availability, and applicable rules. Persist an idempotent `BookingOperation` before external submission.
4. Send the command through the adapter. The simulator atomically enforces nonoverlapping resource intervals using database constraints/transactions. The live adapter uses only conflict controls verified in the Ascend sandbox.
5. Mark confirmed only after acceptance by the scheduling system. Persist the projection update and notification outbox event together. On conflict, offer refreshed alternatives.

Separate appointment lifecycle from command state. Commands use `pending`, `submitting`, `succeeded`, `rejected`, and `reconciling`. A timeout after submission is an unknown outcome: reconcile before retrying so a lost response cannot create duplicate appointments. Scope idempotency keys to practice, actor, and command; reject reuse with a different payload. Serialize app-issued changes to the same appointment.

Local locks cannot prevent a staff member from booking directly in Ascend. Live immediate booking is gated on verified vendor conflict behavior or an agreed staff-review fallback. Availability rechecks alone do not establish atomic booking safety.

Allow online moves/cancellations when `appointment_start - server_now >= 24 hours`, including equality. Recheck at submission. Prefer a verified in-place reschedule operation; never cancel the original first. If a safe move cannot be guaranteed, route it to staff. Keep the original displayed until the authoritative outcome is known. Significant treatment changes create configurable provider notifications/review tasks.

## Patient and treatment policies

- Match records server-side with generic responses, rate limits, expiring verification codes, attempt limits, and no candidate-record disclosure. Phone/email control is distinct from patient identity and guardian authority. Ambiguity, recovery, and outdated contacts go to staff.
- Store guardian grants per patient with scope, verification evidence reference, expiration/review date, and revocation. Apply restrictions before returning history, costs, or appointments. Shared contact details never confer access; other-adult booking remains a call-to-practice flow.
- Keep recare dates, insurance eligibility, and imaging preferences separate. Missing coverage must not become a $0 estimate. Every estimate records its source, calculation time, validity policy, and disclaimer. Imaging preferences create staff-visible information, not clinical decisions.
- Gate patient-facing treatment booking behind validated estimate/display policy and approved scheduling rules. Initially create staff-review requests. Preserve the diagnosing dentist; absent/departed dentists require review rather than automatic reassignment.
- Model multi-visit treatment as ordered visits with resource requirements and minimum/maximum gaps. Initially staff coordinate partial failures and changes. Automating an entire sequence requires a separately validated reservation/compensation workflow.
- Later duration recommendations use comparable completed visits with sample size and uncertainty; dentist approval remains authoritative. Keep this out of the first release.

## Security and operations

Use server-side authorization on every object and action. Patients access linked records; staff receive operational permissions; dentists receive relevant treatment permissions; owner/admin alone receives all feedback. Require unique staff identities and MFA. Use secure, HTTP-only sessions, CSRF protection, throttling, secret management, encrypted transport/storage, and audited access and changes.

Keep sensitive payloads out of application logs, URLs, analytics, and notification bodies. Audit actor, practice, action, target, timestamp, and outcome in a protected append-only store. Configure retention with the practice. If intake uploads are enabled, use private storage, short-lived authorized downloads, type/size validation, malware scanning, and no public object URLs.

Use separate development, staging, and production databases, credentials, storage, and messaging destinations. Deploy the web/API and worker as two processes from one codebase. Use a PostgreSQL-backed job/outbox queue initially, with bounded retries, deduplication, failed-job review, and monitoring for sync lag and unresolved commands. Notifications follow confirmed transitions and tolerate repeated delivery attempts.

Implement incremental synchronization where supported, otherwise bounded polling; periodically reconcile authoritative records. Do not assume webhook availability. During an integration outage, label cached reads with freshness and disable unsupported writes. Monitor conflicts, booking failures, authorization failures, and queue age without patient payloads. Establish backup/restore drills and incident procedures before real data.

These controls implement the specification's design requirements; they do not establish legal compliance. Live data requires the specified practice, vendor, security, and California privacy reviews, including agreements, record-request handling, retention, and family access. Keep record-request deadlines configurable rather than embedding legal assumptions in code.

## Delivery order and gates

1. **Foundation:** module boundaries, migrations, simulator, fixture reset, role/access model, audit trail, CI, and accessible responsive shell.
2. **Routine scheduling:** provider calendar, resource engine, matching/verification demo, dashboard, booking, rescheduling/cancellation, favorites, recare, and feedback. Add intake guidance and staff queues.
3. **Treatment groundwork:** plan display, estimate provenance, dentist duration settings, and review workflow behind feature flags; validate patient-facing release rules separately.
4. **Ascend sandbox:** map capabilities, validate identity/data fields, conflict behavior, retry/reconciliation, availability ownership, and operational workflows against the real API.
5. **Live pilot:** complete API approval and practice/privacy/security readiness; provision a clean production environment, reconcile schedules, and enable narrowly configured routine types. A kill switch disables writes while preserving staff access and reconciliation.

Verification should prioritize simultaneous claims on one slot, dentist/hygienist overlap, exact 24-hour boundaries, daylight-saving transitions, stale rules, lost API responses, reschedule failures, guardian revocation, cross-practice access, estimate gating, and keyboard/screen-reader booking flows. Exercise backup restoration and reconciliation before the live pilot.

Unresolved launch decisions remain those in `spec.md`: identity/guardian proofing, Ascend access and guarantees, provider-hours ownership, final durations, intake requirements, benefits estimates, treatment sequencing, and operating/vendor responsibilities. None blocks building the synthetic routine-booking path.
