-- ============================================================
-- Migration: Add Google Calendar integration
-- Run this on existing databases to add the google_calendar_id column
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS google_calendar_id TEXT;

-- Update the handle_new_user trigger to include google_calendar_id
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
