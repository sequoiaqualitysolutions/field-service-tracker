# Field Service Tracker

Time collection app for the service industry with GPS tracking, satellite maps, overtime dashboards, and payroll reports.

## Tech Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS + DaisyUI
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Hosting:** Netlify (with serverless functions for admin operations)
- **Maps:** Leaflet + Esri satellite tiles
- **Charts:** Chart.js

---

## Setup Guide

### 1. Supabase Setup

1. Go to [supabase.com](https://supabase.com) and open your project (or create one)
2. Go to **SQL Editor** and paste the entire contents of `supabase-schema.sql` → click **Run**
3. This creates all tables, RLS policies, indexes, and the auto-profile trigger

**Get your keys:**
- Go to **Settings → API**
- Copy the **Project URL** and **anon/public key** (for frontend)
- Copy the **service_role key** (for Netlify Functions — keep secret!)

### 2. Netlify Setup

1. Push this project to a Git repo (GitHub/GitLab/Bitbucket)
2. In Netlify, create a new site → connect to your repo
3. Build settings should auto-detect from `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`

4. Go to **Site settings → Environment variables** and add:

| Variable | Value | Notes |
|----------|-------|-------|
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Supabase anon/public key |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Same URL (for functions) |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase service role key (SECRET) |

5. Trigger a redeploy after adding env vars

### 3. Create Your Admin Account

1. Open your deployed site
2. You'll see a login page — but you need an account first!
3. Go to your Supabase Dashboard → **Authentication → Users → Add User**
4. Create a user with your email and password
5. Then go to **SQL Editor** and run:

```sql
UPDATE public.profiles
SET role = 'admin', name = 'Your Name'
WHERE email = 'your-admin@email.com';
```

6. Now sign in at your site — you'll have full admin access!

### 4. Add Technicians

Once logged in as admin:
1. Go to **Technicians** in the sidebar
2. Click **Add User** — enter their email, password, name, and hourly rate
3. Techs can then sign in with those credentials

### 5. Set Up Clients & Assignments

1. Go to **Clients** in the sidebar
2. Add client accounts with details
3. **Assign technicians** to each client — techs only see their assigned clients

---

## Features

### For Technicians
- 🕐 **Clock In/Out** — tap to start/stop on assigned client accounts
- 📍 **GPS Capture** — automatic GPS coordinates on clock in AND clock out
- 🗺️ **Satellite Map** — visual confirmation of start/stop locations
- 📋 **Daily Log** — see all entries for today with hours

### For Admins
- 📊 **Dashboard** — line graph of weekly hours per tech with 40hr/week threshold
- 🔴 **Overtime Alerts** — red banner when anyone exceeds 40hrs in a week
- 💰 **Pay Report** — monthly breakdown with regular/OT hours, auto-calculated pay
- 📥 **CSV Export** — download payroll data for easy processing
- 👥 **User Management** — add/edit/remove technicians
- 🏢 **Client Management** — manage accounts and assign techs

### Security
- 🔐 Supabase Auth (email/password)
- 🛡️ Row Level Security — techs can only see their own time entries
- 🔑 Admin functions use server-side Netlify Functions with service role key

---

## Local Development

```bash
# Copy .env.example to .env and fill in your Supabase keys
cp .env.example .env

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open http://localhost:5173

---

## Project Structure

```
├── index.html              # Entry HTML
├── netlify.toml            # Netlify build config
├── supabase-schema.sql     # Database schema (run in Supabase SQL Editor)
├── netlify/functions/
│   └── admin-users.ts      # Serverless function for user management
├── src/
│   ├── App.tsx             # Main app shell with auth routing
│   ├── main.tsx            # React entry point
│   ├── types.ts            # TypeScript interfaces
│   ├── lib/supabase.ts     # Supabase client
│   ├── utils/helpers.ts    # Formatting & GPS utilities
│   └── components/
│       ├── LoginPage.tsx   # Auth login form
│       ├── Sidebar.tsx     # Navigation sidebar
│       ├── MapView.tsx     # Leaflet satellite map
│       ├── TechPortal.tsx  # Tech clock in/out view
│       ├── AdminDashboard.tsx  # Hours chart + OT alerts
│       ├── PayReport.tsx   # Monthly payroll breakdown
│       ├── ClientManager.tsx   # Client CRUD + tech assignment
│       └── UserManager.tsx # Admin user management
```
