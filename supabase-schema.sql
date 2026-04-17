-- ============================================================
-- Field Service Tracker — Supabase Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. PROFILES (extends Supabase Auth users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'tech' CHECK (role IN ('admin', 'tech')),
  hourly_rate NUMERIC(10,2) DEFAULT 25.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CLIENTS
CREATE TABLE public.clients (
  id SERIAL PRIMARY KEY,
  account_number TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  service_type TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CLIENT ASSIGNMENTS (which tech services which client)
CREATE TABLE public.client_assignments (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tech_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  UNIQUE(client_id, tech_id)
);

-- 4. TIME ENTRIES
CREATE TABLE public.time_entries (
  id SERIAL PRIMARY KEY,
  tech_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  start_lat DOUBLE PRECISION,
  start_lng DOUBLE PRECISION,
  stop_lat DOUBLE PRECISION,
  stop_lng DOUBLE PRECISION,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- Helper function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- PROFILES
CREATE POLICY "Anyone authenticated can view profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());

-- CLIENTS
CREATE POLICY "Authenticated users can view clients" ON public.clients
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert clients" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update clients" ON public.clients
  FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can delete clients" ON public.clients
  FOR DELETE TO authenticated USING (public.is_admin());

-- CLIENT ASSIGNMENTS
CREATE POLICY "Authenticated users can view assignments" ON public.client_assignments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert assignments" ON public.client_assignments
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can delete assignments" ON public.client_assignments
  FOR DELETE TO authenticated USING (public.is_admin());

-- TIME ENTRIES
CREATE POLICY "Techs see own entries, admins see all" ON public.time_entries
  FOR SELECT TO authenticated USING (tech_id = auth.uid() OR public.is_admin());
CREATE POLICY "Techs can insert own entries" ON public.time_entries
  FOR INSERT TO authenticated WITH CHECK (tech_id = auth.uid());
CREATE POLICY "Techs can update own entries" ON public.time_entries
  FOR UPDATE TO authenticated USING (tech_id = auth.uid());
CREATE POLICY "Admins can delete entries" ON public.time_entries
  FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role, hourly_rate)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'tech'),
    COALESCE((NEW.raw_user_meta_data->>'hourly_rate')::numeric, 25.00)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_time_entries_tech ON public.time_entries(tech_id);
CREATE INDEX idx_time_entries_start ON public.time_entries(start_time);
CREATE INDEX idx_client_assignments_tech ON public.client_assignments(tech_id);
CREATE INDEX idx_client_assignments_client ON public.client_assignments(client_id);

-- ============================================================
-- FIRST ADMIN SETUP
-- After creating your first account through the app login page, run:
--
--   UPDATE public.profiles SET role = 'admin' WHERE email = 'your-admin@email.com';
--
-- ============================================================
