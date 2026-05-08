-- SQS Platform clients registry
CREATE TABLE IF NOT EXISTS sqs_clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  site_url TEXT,
  supabase_url TEXT,
  supabase_service_key TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'trial', 'suspended')),
  pricing_tier TEXT DEFAULT 'standard' CHECK (pricing_tier IN ('standard', 'growth', 'enterprise', 'custom')),
  monthly_rate DECIMAL(10,2) DEFAULT 0,
  billing_start_date DATE,
  billing_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: deny all direct access (API function uses service_role key)
ALTER TABLE sqs_clients ENABLE ROW LEVEL SECURITY;

-- Platform admin flag on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT FALSE;

-- Mark SQS admin
UPDATE profiles SET is_platform_admin = true WHERE email = 'sequoiaqualitysolutions@gmail.com';

-- Seed SPCS as first client
INSERT INTO sqs_clients (company_name, display_name, contact_name, contact_email, site_url, status, pricing_tier, monthly_rate, billing_start_date, billing_notes)
VALUES (
  'Scientific Pest Control (Pty) LTD',
  'SPCS',
  'Michael',
  'mike@spcs.co.za',
  'https://sqs-field-time-tracker.netlify.app/login',
  'active',
  'custom',
  202.00,
  '2026-05-01',
  '12 Team Leaders, 1 Admin. Custom pricing: Admin $18 + 12 TL × $12 + Tech Reporting $40 = $202/mo'
);
