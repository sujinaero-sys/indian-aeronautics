# IA.BUYE.ONLINE — Indian Aeronautics

**Hosting:** GitHub Pages (website) · **Backend:** Google Apps Script + one Google Sheet · **Files:** one Google Drive folder (`IA_Private_Files`). Nothing else to host or pay for.

```
frontend/   website + portal (GitHub Pages)     backend/   Apps Script (5 .gs files)     tests/   44 automated tests
```

## 1. Backend (15 minutes)
1. Create a Google Sheet named **IA Database** (if you already have your Phase 1/2 sheet, use it; your rows are kept).
2. Extensions › Apps Script. Create five script files named `Code`, `Company`, `Market`, `Money`, `Admin` and paste the matching `backend/*.gs` into each. Project Settings › tick “Show appsscript.json” and paste `backend/appsscript.json`.
3. Pick function **setup** › Run (approve permissions: Sheets, Drive, Mail). It creates every sheet, the 4 plans, the email templates, default settings, the Drive folder, and two triggers (mail queue every 10 min, weekly backup).
4. Deploy › New deployment › Web app › Execute as **Me**, Who has access **Anyone**. Copy the `/exec` URL. (After any code change: Deploy › Manage deployments › edit › **New version**; the URL stays the same.)

## 2. Website
1. In `frontend/config.js` paste the `/exec` URL into `api`.
2. Create a GitHub repo, upload the **contents of `frontend/`** to the repo root (or push the whole project and set Pages to the `/frontend` folder if offered), then Settings › Pages › Deploy from branch `main`.
3. Custom domain: keep the `CNAME` file (`ia.buye.online`) and add a DNS CNAME record `ia` → `<your-github-user>.github.io`. Tick “Enforce HTTPS”.
4. In the Sheet’s **Settings** tab set `site_url` to your final address.

## 3. First run
1. Open `/portal.html#/register`, create your account. While testing, set Settings `dev_show_codes` = TRUE to see the verification code on screen. **Set it back to FALSE before launch** (it shows codes to anyone).
2. In the **Users** sheet change your `roles` to `admin`. Log in again: the **Admin** tab appears (analytics, import/export, merge, claims, payments, files, payouts, settings, email templates).
3. Settings tab: set `admin_email` (receives alerts), `support_email`, `whatsapp`, `commission_pct`.

## 4. Switching on the optional services
- **Google sign-in:** Google Cloud Console › Credentials › OAuth client (Web) › authorised JavaScript origin = your site URL. Put the client ID in Settings `google_client_id`. The button appears automatically.
- **Email from info@buye.online:** in the Gmail account that owns the script, add info@buye.online under Settings › Accounts › “Send mail as”. Without it, mail is sent from the owner’s address with Reply-To `info@buye.online`. Gmail allows ~100 emails/day (Google Workspace ~1,500). Mail beyond the quota waits in the **Outbox** sheet and is retried every 10 minutes.
- **Payments (Razorpay):** Apps Script › Project Settings › Script properties › add `RZP_KEY_ID` and `RZP_KEY_SECRET`. Plans then use Razorpay Checkout; each payment is verified by signature **and** by fetching it from Razorpay’s API before any plan is activated. *Or*, with no keys, paste a payment link into the `payment_link` column of the **Plans** sheet and confirm payments in Admin › Payments › Mark paid. Prices, GST %, durations and features are edited in the Plans sheet.

## 5. Importing your existing companies
Admin › import: upload CSV/XLSX › map columns › Validate › decide Merge / Skip / Create separate for each duplicate › Confirm. Admin › merge gives the side-by-side compare, conflict choices, “Merge preview”, CONFIRM MERGE and undo (Admin › Merges).

## 6. Run the tests (optional, needs Node 20+)
`cd tests && npm install && npm test` — 44 tests simulate Google Sheets/Drive/Mail and drive the real screens in a browser-like environment.

## What this setup cannot do (read before launch)
- **No payment webhooks.** Apps Script cannot read the signature header, so payments are verified at checkout (signature + server-to-server fetch). A customer who pays but closes the tab before verification needs Admin › Payments › Mark paid. Refunds are issued in Razorpay, then recorded with “Mark refunded”.
- **No automatic malware scanning.** Uploads are checked for type, size and file signature, stored in a private Drive folder, and stay owner-only until an admin marks them clean (Admin › files). Setting `require_scan_for_sharing` = FALSE turns the review gate off at your own risk.
- **Email limits** (above) and no delivery/bounce tracking.
- **Scale:** every request reads whole sheets. Comfortable for hundreds of companies and a few thousand rows; expect it to slow beyond that. `archive/express-postgres-future/` is a tested PostgreSQL version for when you outgrow Sheets.
- Sessions are tokens in the browser tab (Apps Script cannot set cookies). Assignments for students, unsubscribe links, and payout bank details are not built; payouts are records you pay outside the site.
- Legal pages are drafts: fill the bracketed items and have a lawyer review them before commercial launch.
