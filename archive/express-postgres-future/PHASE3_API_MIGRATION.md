# Phase 3 — API migration matrix (Apps Script action API → Express + PostgreSQL)

Status key: **done** = route built, wired through the compat layer, automated test passes · **pending** = not migrated; the compat layer returns `NOT_MIGRATED` (the UI shows a clear message, nothing breaks).
Response envelope everywhere: `{success:true,data}` / `{success:false,error:{code,message}}`. Session: httpOnly cookie `ia_sid`.

## Migration map (what the old frontend actually called → new route → tables)

| Old action | New endpoint | Tables | Status | Test |
|---|---|---|---|---|
| register / verify / login / logout / me | `POST /api/auth/register` `verify` `login` `logout`, `GET /api/auth/me` | users, email_codes, sessions | done | auth suite (7 tests) |
| forgot / reset | `POST /api/auth/forgot` `reset` | users, email_codes, sessions | done | reset test |
| dashboard | `GET /api/dashboard` | users, companies, company_members, rfqs, quotes, messages, notifications, subscriptions, plans | done | E2E + RFQ suite |
| company_get | `GET /api/companies/mine`, `GET /api/companies/:id` | companies, company_members | done | authz tests |
| company_save | `PUT /api/companies/mine`, `PATCH /api/companies/:id` | companies, company_members | done | authz tests |
| (new) company members | `GET/POST/DELETE /api/companies/:id/members`, `POST /api/invites/accept` | company_members, company_invites | done | team test |
| (public search) companies | `GET /api/companies?search=&industry=&state=&location=&page=&limit=` | companies | done | search test |
| rfq_create | `POST /api/rfqs` | rfqs | done | visibility test |
| rfq_feed | `GET /api/rfqs/feed` | rfqs, companies, company_members | done | visibility test |
| rfq_get | `GET /api/rfqs/:id` | rfqs, quotes | done | visibility + quote tests |
| rfq_status | `PATCH /api/rfqs/:id` | rfqs | done | quote test |
| rfq_match | `POST /api/rfqs/:id/match` | rfqs, companies | done | match test |
| quote_submit | `POST /api/rfqs/:id/responses` (plan feature `rfq_access` required) | quotes | done | payment+quote test |
| quote_status | `PATCH /api/rfqs/:id/responses/:rid`, `PATCH /api/responses/:id` | quotes | done | quote test |
| msg_inbox / msg_thread / msg_send | `GET /api/messages`, `GET /api/messages/:userId`, `POST /api/messages` | messages, users | done | messaging test |
| notes / notes_read | `GET /api/notifications`, `POST /api/notifications/read-all`, `POST /api/notifications/:id/read` | notifications | done | RFQ suite |
| payments_mine | `GET /api/payments`, `GET /api/payments/:id` | payments, subscriptions | done | webhook test |
| plans | `GET /api/plans` | plans | done | webhook test |
| (subscription) checkout / cancel | `GET /api/subscription`, `POST /api/subscription/checkout`, `POST /api/subscription/cancel` | plans, payments, subscriptions | done (Razorpay order creation untested: no keys) | dev-order E2E |
| payment activation | `POST /api/webhooks/razorpay` (signature, idempotency, amount check) | payments, subscriptions, webhook_events | done | 4 webhook cases |
| saved / save_supplier | `GET/POST /api/saved` | saved_suppliers | done | — (no dedicated test) |
| (admin) merge | `POST /api/admin/merge/preview` `confirm` `undo` | companies, merge_log, audit_log | done | merge test |
| profile | `GET/PATCH /api/profile` | users | done | — |
| claim_submit, claim_review | — | claims table not in PostgreSQL schema yet | pending | — |
| upload, download | — (needs object storage + malware scan) | files | pending | — |
| admin_list, admin_set, import_check, import_commit, export_companies, payment_confirm | — | — | pending | — |
| refund_request, msg_report | — | payments, audit_log | pending | — |
| course_submit, enrol, trainer_students, courses | — | courses, enrolments | pending (`courses` returns empty list) | — |
| Public site: jobs, public RFQ list, stats, anonymous company/RFQ/enquiry forms | — | no jobs table | pending (public site now lists companies from the new API; the rest is hidden until migrated) | — |

## Not in the old API but required by Phase 3 (done)
`GET /api/health` (`{ok, database}`), dev-only verification code in the register response (never when `NODE_ENV=production`), dev-only `POST /api/dev/simulate-payment`.

## Decisions to know about
- **No account enumeration:** registering an existing email returns the same 201 message and creates nothing. (Your spec lists "duplicate account" validation; this is the safer reading. Say so if you want an explicit "email already registered" error.)
- **Plan gating:** responding to RFQs needs `rfq_access` (Professional+), as in the Apps Script version.
- **Company payments** are visible only to company owner/admin; personal payments to the payer.
- **Compat layer** (`frontend/js/api.js: call()/pub()`) is temporary. Next step is replacing `call('x')` in portal.js with `IA_API.*` one view at a time, then deleting `MAP`.
- **Apps Script** is untouched and still runs; nothing was deleted. Its data is not yet imported into PostgreSQL.
