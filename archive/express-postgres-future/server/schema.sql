-- IA.BUYE.ONLINE production schema (PostgreSQL 14+). Idempotent: safe to re-run.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT,
  password_hash TEXT, google_sub TEXT UNIQUE, email_verified BOOLEAN NOT NULL DEFAULT false,
  roles TEXT[] NOT NULL DEFAULT '{buyer}', status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id BIGINT REFERENCES users ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS email_codes (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users ON DELETE CASCADE, purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL, attempts INT NOT NULL DEFAULT 0, expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS companies (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, website TEXT, email TEXT, phone TEXT, country TEXT, state TEXT, city TEXT,
  address TEXT, industry TEXT, category TEXT, type TEXT, products TEXT, services TEXT, capabilities TEXT, materials TEXT, certifications TEXT,
  contact_person TEXT, size TEXT, founded TEXT, export_capability TEXT, verification TEXT NOT NULL DEFAULT 'Basic Profile',
  status TEXT NOT NULL DEFAULT 'Pending', views INT NOT NULL DEFAULT 0, legacy_sheet_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), merged_into BIGINT REFERENCES companies);
CREATE INDEX IF NOT EXISTS companies_name_trgm ON companies USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS companies_search ON companies USING gin (to_tsvector('simple', coalesce(name,'')||' '||coalesce(capabilities,'')||' '||coalesce(products,'')||' '||coalesce(city,'')||' '||coalesce(state,'')));
CREATE TABLE IF NOT EXISTS company_members (company_id BIGINT REFERENCES companies ON DELETE CASCADE, user_id BIGINT REFERENCES users ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','procurement','sales','hr','engineering','viewer')), PRIMARY KEY (company_id, user_id));
CREATE TABLE IF NOT EXISTS company_invites (id BIGSERIAL PRIMARY KEY, company_id BIGINT REFERENCES companies ON DELETE CASCADE, email TEXT NOT NULL, name TEXT,
  role TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, accepted BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS merge_log (id BIGSERIAL PRIMARY KEY, admin_id BIGINT REFERENCES users, existing_id BIGINT, duplicate_id BIGINT,
  changes JSONB NOT NULL, previous JSONB NOT NULL, undone BOOLEAN NOT NULL DEFAULT false, at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS rfqs (id BIGSERIAL PRIMARY KEY, rfq_no TEXT UNIQUE, company_id BIGINT REFERENCES companies, created_by BIGINT REFERENCES users,
  title TEXT NOT NULL, description TEXT, category TEXT, quantity TEXT, unit TEXT, material TEXT, process TEXT, certification TEXT, location TEXT, delivery_date DATE, budget TEXT,
  visibility TEXT NOT NULL DEFAULT 'Verified suppliers', status TEXT NOT NULL DEFAULT 'Draft', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE SEQUENCE IF NOT EXISTS rfq_no_seq;
CREATE TABLE IF NOT EXISTS quotes (id BIGSERIAL PRIMARY KEY, rfq_id BIGINT REFERENCES rfqs ON DELETE CASCADE, company_id BIGINT REFERENCES companies, created_by BIGINT REFERENCES users,
  price NUMERIC, currency TEXT DEFAULT 'INR', moq TEXT, lead_time TEXT, terms TEXT, validity TEXT, comments TEXT, status TEXT NOT NULL DEFAULT 'Submitted', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS messages (id BIGSERIAL PRIMARY KEY, thread TEXT NOT NULL, from_id BIGINT REFERENCES users, to_id BIGINT REFERENCES users, body TEXT, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS files (id BIGSERIAL PRIMARY KEY, owner_id BIGINT REFERENCES users, rfq_id BIGINT REFERENCES rfqs, name TEXT, mime TEXT, size BIGINT, object_key TEXT,
  scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected','failed')), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, name TEXT, price_paise BIGINT, duration_days INT, tax_pct NUMERIC, features TEXT[], limits JSONB, active BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS payments (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users, company_id BIGINT, plan_id TEXT REFERENCES plans, provider_order_id TEXT UNIQUE,
  provider_payment_id TEXT, amount_paise BIGINT NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'Created' CHECK (status IN ('Created','Pending','Authorized','Paid','Failed','Cancelled','Refunded','Partially Refunded')),
  invoice_no TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS webhook_events (event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, type TEXT, received_at TIMESTAMPTZ NOT NULL DEFAULT now(), outcome TEXT);
CREATE TABLE IF NOT EXISTS subscriptions (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users, company_id BIGINT, plan_id TEXT REFERENCES plans, payment_id BIGINT UNIQUE REFERENCES payments,
  status TEXT NOT NULL DEFAULT 'active', starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS email_templates (key TEXT PRIMARY KEY, subject TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS email_log (id BIGSERIAL PRIMARY KEY, to_email TEXT, template TEXT, status TEXT NOT NULL DEFAULT 'pending', provider_id TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS job_queue (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INT NOT NULL DEFAULT 0, run_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_log (id BIGSERIAL PRIMARY KEY, user_id BIGINT, action TEXT NOT NULL, detail JSONB, at TIMESTAMPTZ NOT NULL DEFAULT now());
-- Single source of truth for contact details (never hard-code in app code)
INSERT INTO settings(key,value) VALUES ('support_email','"info@buye.online"'),('whatsapp','"+919995863184"'),('sender_name','"Indian Aeronautics"'),('sender_email','"info@buye.online"'),
 ('commission_pct','20'),('max_file_mb','5'),('allowed_ext','["pdf","doc","docx","xls","xlsx","csv","jpg","jpeg","png"]') ON CONFLICT DO NOTHING;

-- Phase 3 additions (idempotent)
CREATE TABLE IF NOT EXISTS notifications (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users ON DELETE CASCADE, kind TEXT NOT NULL DEFAULT 'system', text TEXT NOT NULL, link TEXT, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS saved_suppliers (user_id BIGINT REFERENCES users ON DELETE CASCADE, company_id BIGINT REFERENCES companies ON DELETE CASCADE, PRIMARY KEY (user_id, company_id));
ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS invited BIGINT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread, id);
CREATE INDEX IF NOT EXISTS rfqs_status ON rfqs(status, id DESC);
CREATE INDEX IF NOT EXISTS quotes_rfq ON quotes(rfq_id);
CREATE INDEX IF NOT EXISTS payments_user ON payments(user_id, id DESC);
