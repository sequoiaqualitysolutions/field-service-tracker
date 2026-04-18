import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { createSign } from 'crypto';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

/* ---------- Google Service-Account JWT auth (no extra npm deps) ---------- */

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function createGoogleJWT(clientEmail: string, privateKey: string): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const signInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = signer.sign(privateKey, 'base64url');

  return `${signInput}.${signature}`;
}

async function getGoogleAccessToken(
  clientEmail: string,
  privateKey: string,
): Promise<string> {
  const jwt = createGoogleJWT(clientEmail, privateKey);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    )}&assertion=${encodeURIComponent(jwt)}`,
  });
  const data: any = await res.json();
  if (!data.access_token) {
    throw new Error(`Google auth failed: ${JSON.stringify(data)}`);
  }
  return data.access_token as string;
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

  /* --- Look up this user's Google Calendar ID --- */
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('google_calendar_id')
    .eq('id', user.id)
    .single();

  if (!profile?.google_calendar_id) {
    return new Response(
      JSON.stringify({
        events: [],
        message: 'No Google Calendar linked to your profile.',
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  /* --- Parse the service-account credentials --- */
  const saBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  if (!saBase64) {
    return new Response(
      JSON.stringify({
        events: [],
        message: 'Google Calendar integration is not configured on the server.',
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  let serviceAccount: { client_email: string; private_key: string };
  try {
    serviceAccount = JSON.parse(
      Buffer.from(saBase64, 'base64').toString('utf-8'),
    );
  } catch {
    return new Response(
      JSON.stringify({ events: [], error: 'Invalid service account config.' }),
      {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    );
  }

  /* --- Build date range from query params --- */
  const url = new URL(req.url);
  const timeMin =
    url.searchParams.get('timeMin') ||
    new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const timeMax =
    url.searchParams.get('timeMax') ||
    new Date(Date.now() + 7 * 86400000).toISOString();

  /* --- Call Google Calendar API --- */
  try {
    const accessToken = await getGoogleAccessToken(
      serviceAccount.client_email,
      serviceAccount.private_key,
    );

    const calUrl =
      `https://www.googleapis.com/calendar/v3/calendars/` +
      `${encodeURIComponent(profile.google_calendar_id)}/events` +
      `?timeMin=${encodeURIComponent(timeMin)}` +
      `&timeMax=${encodeURIComponent(timeMax)}` +
      `&singleEvents=true&orderBy=startTime&maxResults=250`;

    const calRes = await fetch(calUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!calRes.ok) {
      const errText = await calRes.text();
      throw new Error(`Calendar API ${calRes.status}: ${errText}`);
    }

    const calData: any = await calRes.json();

    const events = (calData.items || []).map((item: any) => ({
      id: item.id,
      summary: item.summary || 'Untitled Event',
      description: item.description || '',
      location: item.location || '',
      start: item.start?.dateTime || item.start?.date || '',
      end: item.end?.dateTime || item.end?.date || '',
      allDay: !item.start?.dateTime,
    }));

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
