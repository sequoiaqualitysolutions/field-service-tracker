# SPCS Field Service Tracker — Security and Data Release Checklist

Use this checklist for every database-affecting change, authentication change, RLS/policy change, or deployment that changes data access. A release is not complete until the evidence is recorded with the release.

## 1. Before the change

- [ ] Record the change purpose, affected tables/functions/policies, and rollback plan.
- [ ] Confirm the production project and environment before running SQL.
- [ ] Review all changed `SECURITY DEFINER` functions.
- [ ] Confirm every `SECURITY DEFINER` function has an explicit trusted `search_path` (normally `public, pg_temp`, or a narrower approved path).
- [ ] Confirm `PUBLIC`, `anon`, and `authenticated` execution privileges are intentional for every changed function. Do not revoke `authenticated` execution from helper functions called by RLS policies without testing authenticated reads.
- [ ] Confirm RLS remains enabled on every affected client-facing table.
- [ ] Confirm Auth protection settings, including leaked-password protection, remain enabled.

## 2. After the database change

- [ ] Run Supabase Security Advisor and retain the result with the release record.
- [ ] Treat any new error or warning as a release blocker until reviewed and explicitly accepted.
- [ ] Confirm migrations completed successfully and no unintended objects, policies, grants, or rows changed.
- [ ] Confirm the app's authenticated role can still execute the intended RLS helper path.
- [ ] Confirm anonymous access remains blocked wherever it is not intended.

## 3. Required authenticated smoke tests

Run these with a real account for each relevant role (Admin, Team Leader, and Tech). Do not rely only on the SQL Editor or an anonymous browser session.

- [ ] Sign in and confirm the dashboard or role landing page loads without a blank state or database error.
- [ ] Open the current month and confirm entries are visible.
- [ ] Open at least one prior month and confirm entries are visible.
- [ ] Refresh the page while viewing a month and confirm the records remain visible.
- [ ] Confirm each role sees only its permitted clients and time entries.
- [ ] Confirm admin-only pages remain blocked for non-admins.
- [ ] Confirm clock-in, clock-out, notes, and active-session loading still work where affected.
- [ ] Confirm payroll/report queries still load for Admin and remain unavailable to non-admins.

## 4. Data-presence verification

For a database-affecting release, run a production count query in SAST and retain the output. Use the actual month currently being reviewed plus at least one previous month:

```sql
SELECT
  date_trunc('month', start_time AT TIME ZONE 'Africa/Johannesburg')::date AS month_sast,
  COUNT(*) AS completed_entries
FROM public.time_entries
WHERE end_time IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;
```

Compare the result with the pre-change baseline. An unexpected zero, sharp unexplained drop, or query error is a release blocker.

## 5. Deployment and post-deployment verification

- [ ] Push the reviewed change to the approved GitHub branch.
- [ ] Trigger the approved Netlify build hook when application code changed.
- [ ] Confirm the build completed successfully.
- [ ] Open the production URL in a fresh session and repeat the authenticated smoke tests.
- [ ] Verify browser console/network errors are absent for the tested screens.
- [ ] Record the commit, deployment time, Security Advisor result, monthly counts, roles tested, and any accepted exceptions.

## 6. Incident response if a check fails

- Stop further releases.
- Preserve the failing query/error and the last known-good commit or migration.
- Determine whether the failure is data, permissions/RLS, application filtering, timezone handling, or deployment configuration.
- Restore the last known-good permission or application state only after confirming the safe rollback.
- Re-run the full authenticated smoke test and monthly data-presence verification before notifying the release as resolved.

## Release record

- Release/change:
- Date/time (SAST):
- Git commit:
- Database migration/query:
- Security Advisor result:
- Monthly data counts:
- Roles tested:
- Production deployment result:
- Exceptions and approval:
- Final sign-off:
