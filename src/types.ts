export interface Profile {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'team_leader' | 'tech';
  hourly_rate: number;
  google_calendar_id?: string;
  is_platform_admin?: boolean;
  created_at?: string;
}

export interface Client {
  id: number;
  account_number: string;
  name: string;
  address: string;
  contact_name: string;
  contact_phone: string;
  contact_email?: string;
  service_type: string;
  ship_address?: string;
  notes: string;
  created_at?: string;
  client_assignments?: { tech_id: string; profiles: { id: string; name: string } }[];
}

export interface ClientAssignment {
  id: number;
  client_id: number;
  tech_id: string;
}

export interface TimeEntry {
  id: number;
  tech_id: string;
  client_id: number;
  start_time: string;
  end_time: string | null;
  start_lat: number | null;
  start_lng: number | null;
  stop_lat: number | null;
  stop_lng: number | null;
  distance_km: number | null;
  session_id: string | null;
  clocked_in_by: string | null;
  notes: string;
  created_at?: string;
  clients?: { name: string; account_number: string };
  profiles?: { name: string };
}

export interface TeamSession {
  id: string;
  leader_id: string;
  client_id: number;
  start_time: string;
  end_time: string | null;
  start_lat: number | null;
  start_lng: number | null;
  stop_lat: number | null;
  stop_lng: number | null;
  distance_km: number | null;
  notes: string;
  created_at?: string;
  clients?: { name: string; account_number: string };
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  matchedClient?: Client | null;
}

export type AppView = 'dashboard' | 'clients' | 'pay-report' | 'tech-portal' | 'user-management' | 'schedule' | 'team-leader-portal' | 'route-planner';

export interface WeekInfo {
  week: number;
  startDay: number;
  endDay: number;
  label: string;
}

export interface SQSClient {
  id: string;
  company_name: string;
  display_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  site_url: string | null;
  status: 'active' | 'inactive' | 'trial' | 'suspended';
  pricing_tier: 'standard' | 'growth' | 'enterprise' | 'custom';
  monthly_rate: number;
  billing_start_date: string | null;
  billing_notes: string | null;
  created_at: string;
  updated_at: string;
  // Live stats (populated by API)
  user_count?: number;
  hours_this_month?: number;
  flags_this_month?: number;
}
