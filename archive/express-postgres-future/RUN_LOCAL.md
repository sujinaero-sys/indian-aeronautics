# Run Phase 3 locally (no external email, payment or Google accounts needed)

1. PostgreSQL 14+ running. Create two databases and a user:
   `createuser ia --pwprompt` · `createdb -O ia ia_dev` · `createdb -O ia ia_test` · `psql -d ia_dev -c "CREATE EXTENSION pg_trgm"` (same for ia_test; needs a superuser)
2. `cd server && cp .env.example .env` (edit DATABASE_URL / TEST_DATABASE_URL) · `npm install`
3. `psql "$DATABASE_URL" -f schema.sql -f seed.sql`
4. `npm run dev` → open http://localhost:3000/portal.html (Express serves the frontend, so cookies work same-origin)
5. Register: the 6-digit code appears on the verify screen and in the server console (development only).
6. Make yourself admin: `psql "$DATABASE_URL" -c "UPDATE users SET roles='{admin}' WHERE email='you@example.com'"`
7. Tests: `npm test` (24 tests, uses ia_test and wipes it each run).

Production: `NODE_ENV=production` refuses to start without DATABASE_URL, APP_SECRET and FRONTEND_ORIGIN, disables every dev shortcut, and uses Secure SameSite=None cookies (HTTPS + CORS allow-list = FRONTEND_ORIGIN).
