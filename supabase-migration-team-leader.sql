-- ============================================================
-- Migration: Add Team Leader Role + Session Management
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add team_leader to allowed roles
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'team_leader', 'tech'));

-- 2. Create team_sessions table
CREATE TABLE IF NOT EXISTS public.team_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  leader_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  start_lat DOUBLE PRECISION,
  start_lng DOUBLE PRECISION,
  stop_lat DOUBLE PRECISION,
  stop_lng DOUBLE PRECISION,
  distance_km DOUBLE PRECISION,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Add session tracking columns to time_entries
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.team_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS clocked_in_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 4. Helper function for team leader check
CREATE OR REPLACE FUNCTION public.is_team_leader()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'team_leader'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 5. RLS for team_sessions
ALTER TABLE public.team_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leaders and admins can view sessions" ON public.team_sessions
  FOR SELECT TO authenticated USING (leader_id = auth.uid() OR public.is_admin());

CREATE POLICY "Leaders can create sessions" ON public.team_sessions
  FOR INSERT TO authenticated WITH CHECK (leader_id = auth.uid());

CREATE POLICY "Leaders can update own sessions" ON public.team_sessions
  FOR UPDATE TO authenticated USING (leader_id = auth.uid());

-- 6. Additional time_entries policies for team leaders
-- Team leaders can see all entries (for dashboard)
CREATE POLICY "Team leaders see all entries" ON public.time_entries
  FOR SELECT TO authenticated USING (public.is_team_leader());

-- Team leaders can create entries for techs in their sessions
CREATE POLICY "Team leaders can insert session entries" ON public.time_entries
  FOR INSERT TO authenticated WITH CHECK (public.is_team_leader());

-- Team leaders can update entries they created (for clock-out)
CREATE POLICY "Team leaders can update session entries" ON public.time_entries
  FOR UPDATE TO authenticated USING (clocked_in_by = auth.uid());

-- 7. Team leaders can also manage client assignments
CREATE POLICY "Team leaders can view assignments" ON public.client_assignments
  FOR SELECT TO authenticated USING (public.is_team_leader());

-- 8. Indexes
CREATE INDEX IF NOT EXISTS idx_team_sessions_leader ON public.team_sessions(leader_id);
CREATE INDEX IF NOT EXISTS idx_team_sessions_active ON public.team_sessions(leader_id) WHERE end_time IS NULL;
CREATE INDEX IF NOT EXISTS idx_time_entries_session ON public.time_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_clocked_in_by ON public.time_entries(clocked_in_by);
