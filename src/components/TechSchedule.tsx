import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  CalendarDays,
  CalendarClock,
  Clock,
  MapPin,
  Briefcase,
  RefreshCw,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Play,
  Info,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Profile, Client, CalendarEvent } from '../types';
import { supabase } from '../lib/supabase';
import { formatTime } from '../utils/helpers';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
interface TechScheduleProps {
  profile: Profile;
  onClockIn?: (clientId: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}
function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay(); // 0=Sun
  r.setDate(r.getDate() - day);
  r.setHours(0, 0, 0, 0);
  return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
function fmtShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtWeekday(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}
function fmtTime(iso: string): string {
  if (!iso || iso.length <= 10) return 'All day';
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Fuzzy match: does the event title contain any client name? */
function matchEventToClient(
  summary: string,
  clients: Client[],
): Client | null {
  const lower = summary.toLowerCase();
  // Try exact account_number match first
  for (const c of clients) {
    if (c.account_number && lower.includes(c.account_number.toLowerCase())) {
      return c;
    }
  }
  // Then try name match (longest first to avoid partial collisions)
  const sorted = [...clients].sort(
    (a, b) => b.name.length - a.name.length,
  );
  for (const c of sorted) {
    if (c.name && lower.includes(c.name.toLowerCase())) {
      return c;
    }
  }
  return null;
}

function eventStatus(
  ev: CalendarEvent,
): 'upcoming' | 'in-progress' | 'completed' | 'all-day' {
  if (ev.allDay) return 'all-day';
  const now = Date.now();
  const start = new Date(ev.start).getTime();
  const end = new Date(ev.end).getTime();
  if (now < start) return 'upcoming';
  if (now >= start && now <= end) return 'in-progress';
  return 'completed';
}

const statusColors: Record<string, string> = {
  upcoming: 'border-l-info',
  'in-progress': 'border-l-success',
  completed: 'border-l-base-content/20',
  'all-day': 'border-l-warning',
};
const statusBadge: Record<string, string> = {
  upcoming: 'badge-info',
  'in-progress': 'badge-success',
  completed: 'badge-ghost',
  'all-day': 'badge-warning',
};
const statusLabel: Record<string, string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In Progress',
  completed: 'Completed',
  'all-day': 'All Day',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export const TechSchedule: React.FC<TechScheduleProps> = ({
  profile,
  onClockIn,
}) => {
  const [view, setView] = useState<'today' | 'week'>('today');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date()));
  const timerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);

  /* ---------- Fetch calendar events ---------- */
  const fetchEvents = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError('');
      setMessage('');

      try {
        // Fetch assigned clients
        const { data: assignments } = await supabase
          .from('client_assignments')
          .select('client_id, clients(*)')
          .eq('tech_id', profile.id);

        const assignedClients = (assignments || [])
          .map((a: any) => a.clients)
          .filter(Boolean) as Client[];
        setClients(assignedClients);

        // Determine date range
        let timeMin: string;
        let timeMax: string;
        if (view === 'today') {
          timeMin = startOfDay(new Date()).toISOString();
          timeMax = endOfDay(new Date()).toISOString();
        } else {
          timeMin = weekStart.toISOString();
          timeMax = addDays(weekStart, 7).toISOString();
        }

        // Call our serverless function
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setError('Not authenticated');
          setLoading(false);
          return;
        }

        // Check if user has a Google Calendar ID configured
        if (!profile.google_calendar_id) {
          setMessage('Google Calendar is not configured yet. Your admin will set this up — use the Clock In page for now.');
          setEvents([]);
          setLoading(false);
          return;
        }

        const res = await fetch(
          `/api/google-calendar?timeMin=${encodeURIComponent(
            timeMin,
          )}&timeMax=${encodeURIComponent(timeMax)}`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
          },
        );

        if (!res.ok) {
          setMessage('Google Calendar is not available yet. Your admin will set this up — use the Clock In page for now.');
          setEvents([]);
          setLoading(false);
          return;
        }

        let data;
        try {
          data = await res.json();
        } catch {
          setMessage('Google Calendar is not configured yet. Your admin will set this up — use the Clock In page for now.');
          setEvents([]);
          setLoading(false);
          return;
        }

        if (data.message) setMessage(data.message);
        if (data.error && !data.events) {
          setError(data.error);
          setLoading(false);
          return;
        }

        // Match events to clients
        const enriched: CalendarEvent[] = (data.events || []).map(
          (ev: CalendarEvent) => ({
            ...ev,
            matchedClient: matchEventToClient(ev.summary, assignedClients),
          }),
        );

        setEvents(enriched);
        setLastRefresh(new Date());
        setCountdown(REFRESH_INTERVAL / 1000);
      } catch (err: any) {
        setError(err.message || 'Failed to load schedule');
      }
      setLoading(false);
    },
    [profile.id, view, weekStart],
  );

  /* ---------- Auto-refresh every 15 min ---------- */
  useEffect(() => {
    fetchEvents();

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => fetchEvents(true), REFRESH_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchEvents]);

  /* ---------- Countdown ticker ---------- */
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = window.setInterval(() => {
      setCountdown((c) => (c <= 1 ? REFRESH_INTERVAL / 1000 : c - 1));
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  /* ---------- Helpers for weekly view ---------- */
  function eventsForDay(day: Date): CalendarEvent[] {
    return events.filter((ev) => {
      const evDate = new Date(ev.start);
      return sameDay(evDate, day);
    });
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  const countdownMin = Math.floor(countdown / 60);
  const countdownSec = Math.floor(countdown % 60);

  /* ---------- Event card (shared) ---------- */
  function EventCard({ ev, compact }: { ev: CalendarEvent; compact?: boolean }) {
    const status = eventStatus(ev);
    const client = ev.matchedClient;

    return (
      <div
        className={`card bg-base-200 border-l-4 ${statusColors[status]} ${
          compact ? 'p-2' : ''
        }`}
      >
        <div className={compact ? '' : 'card-body p-3'}>
          {/* Time */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Clock size={14} className="text-primary" />
              {fmtTime(ev.start)}
              {!ev.allDay && (
                <>
                  <span className="text-base-content/40">→</span>
                  {fmtTime(ev.end)}
                </>
              )}
            </div>
            <span className={`badge badge-xs ${statusBadge[status]}`}>
              {statusLabel[status]}
            </span>
          </div>

          {/* Title */}
          <p className={`font-bold ${compact ? 'text-xs' : 'text-sm'} mt-1`}>
            {ev.summary}
          </p>

          {!compact && (
            <>
              {/* Matched client info */}
              {client && (
                <div className="text-xs space-y-0.5 mt-1 text-base-content/70">
                  <div className="flex items-center gap-1">
                    <Briefcase size={12} />
                    <span>
                      {client.name}{' '}
                      <span className="text-base-content/40">
                        ({client.account_number})
                      </span>
                    </span>
                  </div>
                  {client.address && (
                    <div className="flex items-center gap-1">
                      <MapPin size={12} />
                      <span>{client.address}</span>
                    </div>
                  )}
                  {client.service_type && (
                    <div className="flex items-center gap-1">
                      <Info size={12} />
                      <span>{client.service_type}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Location from Google (if no client match) */}
              {!client && ev.location && (
                <div className="flex items-center gap-1 text-xs text-base-content/60 mt-1">
                  <MapPin size={12} />
                  <span>{ev.location}</span>
                </div>
              )}

              {/* Description */}
              {ev.description && (
                <p className="text-xs text-base-content/50 mt-1 line-clamp-2">
                  {ev.description}
                </p>
              )}

              {/* Clock-In button */}
              {client && onClockIn && status !== 'completed' && (
                <button
                  className="btn btn-primary btn-xs mt-2 gap-1"
                  onClick={() => onClockIn(client.id)}
                >
                  <Play size={12} /> Clock In
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <CalendarDays size={22} className="text-primary" /> My Schedule
        </h2>
        <div className="flex items-center gap-2">
          {/* Sync status */}
          <div className="flex items-center gap-1 text-xs text-base-content/50">
            {lastRefresh ? (
              <>
                <Wifi size={12} className="text-success" />
                <span>
                  Synced{' '}
                  {lastRefresh.toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                <span className="text-base-content/30">
                  • Next in {countdownMin}:{String(countdownSec).padStart(2, '0')}
                </span>
              </>
            ) : (
              <>
                <WifiOff size={12} />
                <span>Not synced</span>
              </>
            )}
          </div>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => fetchEvents()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* View toggle */}
      <div className="tabs tabs-boxed w-fit">
        <a
          className={`tab tab-sm ${view === 'today' ? 'tab-active' : ''}`}
          onClick={() => setView('today')}
        >
          <CalendarClock size={14} className="mr-1" /> Today
        </a>
        <a
          className={`tab tab-sm ${view === 'week' ? 'tab-active' : ''}`}
          onClick={() => setView('week')}
        >
          <CalendarDays size={14} className="mr-1" /> This Week
        </a>
      </div>

      {/* Error / message */}
      {error && (
        <div className="alert alert-error py-2 text-sm">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      {message && !error && (
        <div className="alert alert-info py-2 text-sm">
          <Info size={16} />
          <span>{message}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      )}

      {/* ==================== TODAY VIEW ==================== */}
      {!loading && view === 'today' && (
        <div className="space-y-3">
          <h3 className="font-semibold text-base-content/70 text-sm">
            📅 {fmtDate(today)}
          </h3>

          {events.length === 0 && !message && !error && (
            <div className="text-center py-16 text-base-content/40">
              <CalendarDays size={48} className="mx-auto mb-3 opacity-30" />
              <p className="font-semibold">No jobs scheduled today</p>
              <p className="text-xs mt-1">
                Events from your Google Calendar will appear here.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {events.map((ev) => (
              <EventCard key={ev.id} ev={ev} />
            ))}
          </div>
        </div>
      )}

      {/* ==================== WEEKLY VIEW ==================== */}
      {!loading && view === 'week' && (
        <div className="space-y-3">
          {/* Week navigation */}
          <div className="flex items-center gap-3">
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-semibold text-sm">
              {fmtShortDate(weekStart)} – {fmtShortDate(addDays(weekStart, 6))}
            </span>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
            >
              <ChevronRight size={16} />
            </button>
            {!sameDay(weekStart, startOfWeek(today)) && (
              <button
                className="btn btn-outline btn-xs"
                onClick={() => setWeekStart(startOfWeek(today))}
              >
                This Week
              </button>
            )}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map((day) => {
              const isToday = sameDay(day, today);
              const dayEvents = eventsForDay(day);
              return (
                <div
                  key={day.toISOString()}
                  className={`rounded-lg p-2 min-h-[140px] ${
                    isToday
                      ? 'bg-primary/10 border border-primary/30'
                      : 'bg-base-200'
                  }`}
                >
                  <div className="text-center mb-1">
                    <div className="text-xs text-base-content/50 font-semibold">
                      {fmtWeekday(day)}
                    </div>
                    <div
                      className={`text-sm font-bold ${
                        isToday ? 'text-primary' : ''
                      }`}
                    >
                      {day.getDate()}
                    </div>
                  </div>
                  <div className="space-y-1">
                    {dayEvents.length === 0 && (
                      <p className="text-[10px] text-base-content/30 text-center mt-4">
                        —
                      </p>
                    )}
                    {dayEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className={`text-[11px] leading-tight p-1 rounded border-l-2 ${
                          statusColors[eventStatus(ev)]
                        } bg-base-100`}
                        title={`${ev.summary}\n${fmtTime(ev.start)} - ${fmtTime(ev.end)}${
                          ev.matchedClient
                            ? `\n${ev.matchedClient.name}`
                            : ''
                        }`}
                      >
                        <div className="font-semibold truncate">
                          {ev.summary}
                        </div>
                        <div className="text-base-content/50">
                          {fmtTime(ev.start)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Event list below calendar */}
          {events.length > 0 && (
            <div className="space-y-2 mt-4">
              <h4 className="text-sm font-semibold text-base-content/60">
                Week Details
              </h4>
              {weekDays.map((day) => {
                const dayEvents = eventsForDay(day);
                if (dayEvents.length === 0) return null;
                return (
                  <div key={day.toISOString()}>
                    <p className="text-xs font-bold text-base-content/50 mb-1">
                      {fmtWeekday(day)}, {fmtShortDate(day)}
                    </p>
                    <div className="space-y-1">
                      {dayEvents.map((ev) => (
                        <EventCard key={ev.id} ev={ev} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
