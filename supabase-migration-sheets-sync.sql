-- ============================================================
-- Migration: Google Sheets Sync Feature
-- Run this in Supabase SQL Editor to add Google Sheets sync support
-- ============================================================

-- Add new columns to clients table
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS contact_email TEXT DEFAULT '';
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS ship_address TEXT DEFAULT '';

-- Create app_settings table for storing configuration
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on app_settings
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies for app_settings
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_settings' AND policyname = 'Authenticated users can view app_settings') THEN
    CREATE POLICY "Authenticated users can view app_settings" ON public.app_settings
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_settings' AND policyname = 'Admins can insert app_settings') THEN
    CREATE POLICY "Admins can insert app_settings" ON public.app_settings
      FOR INSERT TO authenticated WITH CHECK (public.is_admin());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_settings' AND policyname = 'Admins can update app_settings') THEN
    CREATE POLICY "Admins can update app_settings" ON public.app_settings
      FOR UPDATE TO authenticated USING (public.is_admin());
  END IF;
END$$;
