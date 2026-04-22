import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

/* ---------- Simple iCal parser ---------- */

interface ICalEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
}

function unfoldIcal(raw: string): string {
  // iCal line folding: lines starting with space/tab are continuations
  return raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function parseIcalDate(value: string): { iso: string; allDay: boolean } {
  // Handle TZID format: DTSTART;TZID=Africa/Johannesburg:20260422T080000
  const colonIdx = value.lastIndexOf(':');
  const dateStr = colonIdx >= 0 ? value.substring(colonIdx + 1) : value;
  const cleanDate = dateStr.trim();

  // All-day: 20260422
  if (/^\d{8}$/.test(cleanDate)) {
    const y = cleanDate.slice(0, 4);
    const m = cleanDate.slice(4, 6);
    const d = cleanDate.slice(6, 8);
    return { iso: `${y}-${m}-${d}`, allDay: true };
  }

  // DateTime: 20260422T080000Z or 20260422T080000
  if (/^\d{8}T\d{6}Z?$/.test(cleanDate)) {
    const y = cleanDate.slice(0, 4);
    const m = cleanDate.slice(4, 6);
    const d = cleanDate.slice(6, 8);
    const hh = cleanDate.slice(9, 11);
    const mm = cleanDate.slice(11, 13);
    const ss = cleanDate.slice(13, 15);
    const isUTC = cleanDate.endsWith('Z');
    return {
      iso: `${y}-${m}-${d}T${hh}:${mm}:${ss}${isUTC ? 'Z' : ''}`,
      allDay: false,
    };
  }

  return { iso: cleanDate, allDay: false };
}

function parseIcal(icsText: string, timeMin: Date, timeMax: Date): ICalEvent[] {
  const unfolded = unfoldIcal(icsText);
  const lines = unfolded.split(/\r?\n/);
  const events: ICalEvent[] = [];
  let inEvent = false;
  let current: Partial<ICalEvent> & { startDate?: Date; endDate?: Date } = {};
  let counter = 0;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      inEvent = false;
      // Filter by date range
      if (current.startDate && current.endDate) {
        if (current.startDate < timeMax && current.endDate > timeMin) {
          events.push({
            id: current.id || `ical-${counter++}`,
            summary: current.summary || 'Untitled Event',
            description: current.description || '',
            location: current.location || '',
            start: current.start || '',
            end: current.end || '',
            allDay: current.allDay || false,
          });
        }
      }
      continue;
    }
    if (!inEvent) continue;

    // Parse property:value (handle properties with params like DTSTART;TZID=...:value)
    const firstColon = line.indexOf(':');
    if (firstColon < 0) continue;
    const propFull = line.substring(0, firstColon);
    const value = line.substring(firstColon + 1);
    const prop = propFull.split(';')[0].toUpperCase();

    switch (prop) {
      case 'UID':
        current.id = value;
        break;
      case 'SUMMARY':
        current.summary = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\\\/g, '\\');
        break;
      case 'DESCRIPTION':
        current.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\\\/g, '\\');
        break;
      case 'LOCATION':
        current.location = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\\\/g, '\\');
        break;
      case 'DTSTART': {
        // Full line including params for date parsing
        const parsed = parseIcalDate(line.substring(prop.length));
        current.start = parsed.iso;
        current.allDay = parsed.allDay;
        current.startDate = new Date(parsed.iso);
        break;
      }
      case 'DTEND': {
        const parsed = parseIcalDate(line.substring(prop.length));
        current.end = parsed.iso;
        current.endDate = new Date(parsed.iso);
        break;
      }
    }
  }

  // Sort by start time
  events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return events;
}

/* ---------- Handler ---------- */

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response('OK', { headers: cors });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  /* --- Authenticate the calling user --- */
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
  } = await supabaseAdmin.auth.getUser(token);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  /* --- Determine which user's calendar to load --- */
  const url = new URL(req.url);
  const requestedUserId = url.searchParams.get('userId');
  let targetUserId = user.id;

  // If admin requests another user's calendar, allow it
  if (requestedUserId && requestedUserId !== user.id) {
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (callerProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can view other calendars' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    targetUserId = requestedUserId;
  }

  /* --- Look up target user's iCal URL --- */
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('google_calendar_id')
    .eq('id', targetUserId)
    .single();

  if (!profile?.google_calendar_id) {
    return new Response(
      JSON.stringify({
        events: [],
        message: 'No Google Calendar linked to this profile.',
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  /* --- Build date range from query params --- */
  const timeMin = new Date(
    url.searchParams.get('timeMin') ||
    new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
  );
  const timeMax = new Date(
    url.searchParams.get('timeMax') ||
    new Date(Date.now() + 7 * 86400000).toISOString()
  );

  /* --- Fetch and parse iCal feed --- */
  try {
    const icalUrl = profile.google_calendar_id;

    // Validate it looks like an iCal URL
    if (!icalUrl.includes('.ics') && !icalUrl.includes('calendar.google.com')) {
      return new Response(
        JSON.stringify({
          events: [],
          message: 'Calendar URL is not a valid iCal feed. Please update your profile with a secret iCal URL.',
        }),
        { headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const icalRes = await fetch(icalUrl);
    if (!icalRes.ok) {
      throw new Error(`Failed to fetch calendar feed: ${icalRes.status}`);
    }

    const icsText = await icalRes.text();
    const events = parseIcal(icsText, timeMin, timeMax);

    return new Response(JSON.stringify({ events }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ events: [], error: err.message }),
      {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    );
  }
};

export const config = {
  path: '/api/google-calendar',
};
