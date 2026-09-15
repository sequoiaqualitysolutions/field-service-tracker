-- ============================================================
-- Migration: Allow admins to clock technicians in and out
-- Run this in the Supabase SQL Editor (project rrjqlneyowtogflegkad)
--
-- SAFETY NOTE (Aug 2026 incident): this migration ONLY ADDS policies.
-- It does not revoke, drop or alter any existing policy, function or
-- grant. is_admin() and is_team_leader() must remain EXECUTE-able by
-- the `authenticated` role.
-- ============================================================

-- 1. Admins can create time entries for any user (team clock-in).
--    Existing policies are unchanged: techs keep own-row insert,
--    team leaders keep session insert. Postgres ORs permissive policies.
DROP POLICY IF EXISTS "Admins can insert entries for anyone" ON public.time_entries;
CREATE POLICY "Admins can insert entries for anyone" ON public.time_entries
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- 2. Admins can create a team session (they become the session leader).
--    The existing "Leaders can create sessions" policy already covers
--    leader_id = auth.uid(); this is explicit and future-proof.
DROP POLICY IF EXISTS "Admins can create sessions" ON public.team_sessions;
CREATE POLICY "Admins can create sessions" ON public.team_sessions
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- 3. Admins can update/close any team session, including one opened by a
--    team leader (needed for force clock-out of an abandoned session).
DROP POLICY IF EXISTS "Admins can update any session" ON public.team_sessions;
CREATE POLICY "Admins can update any session" ON public.team_sessions
  FOR UPDATE TO authenticated USING (public.is_admin());

-- 4. Admins can remove an orphaned session (used by the portal's rollback
--    path when entry creation fails).
DROP POLICY IF EXISTS "Admins can delete sessions" ON public.team_sessions;
CREATE POLICY "Admins can delete sessions" ON public.team_sessions
  FOR DELETE TO authenticated USING (public.is_admin());

-- Clock-OUT of other users already worked for admins via the existing
-- "Techs can update own entries, admins can update all" policy.
-- SELECT on clients, profiles and client_assignments is already open to
-- all authenticated users, so no read changes are required.

-- ============================================================
-- Verification (run as an authenticated admin, not the service key):
--   select policyname, cmd from pg_policies
--    where tablename in ('time_entries','team_sessions')
--    order by tablename, policyname;
-- Expect the four policies above PLUS every pre-existing policy.
-- ============================================================
