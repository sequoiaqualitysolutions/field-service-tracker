-- Migration: Add distance_km column to time_entries
-- Run this in your Supabase SQL Editor
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS distance_km DOUBLE PRECISION;
