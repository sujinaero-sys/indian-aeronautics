# Production deploy (Priority 1–6 foundation)

Stack: Node/Express + PostgreSQL + Resend (email) + Razorpay (payments) + Google OIDC. Frontend stays on GitHub Pages.

1. **Database**: create a Postgres (Supabase, Neon, Render or Railway; automated backups on). `psql $DATABASE_URL -f server/schema.sql -f server/seed.sql`
2. **Email**: Resend account > add domain `buye.online` > add the SPF, DKIM (and DMARC) DNS records it shows > set `RESEND_API_KEY`. Sender is `Indian Aeronautics <info@buye.online>` (stored in `settings`).
3. **Google**: Google Cloud Console > OAuth client (Web) > authorised origin `https://ia.buye.online` > set `GOOGLE_CLIENT_ID`.
4. **Razorpay**: Dashboard > Webhooks > URL `https://<api-host>/webhooks/razorpay`, events payment.captured, payment.failed, refund.processed > set `RAZORPAY_WEBHOOK_SECRET`. Subscriptions activate only from this webhook.
5. **Host API** (Render/Railway): `cd server && npm i && npm start`, env from `.env.example`. HTTPS required (cookies are Secure).
6. `npm test` runs merge, team-permission, webhook-signature and earnings checks.

## Moving off the spreadsheet
Export Companies from the Sheet as CSV and import via the admin import (to be wired to the new API); `legacy_sheet_id` keeps a link to each original row. Keep the Sheet as export/backup only. Do not delete it until the new system has run in parallel for a while.
