import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, PUT, DELETE, OPTIONS',
};

async function verifyAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return false;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  return profile?.role === 'admin';
}

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response('OK', { headers: cors });
  }

  const isAdmin = await verifyAdmin(req.headers.get('authorization'));
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json();

  // CREATE USER
  if (req.method === 'POST') {
    const { email, password, name, role, hourly_rate } = body;
    if (!email || !password || !name) {
      return new Response(JSON.stringify({ error: 'email, password, and name are required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: ['admin', 'team_leader', 'tech'].includes(role) ? role : 'tech', hourly_rate: hourly_rate || 25 },
    });

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ id: newUser.user.id, email, name }), {
      status: 201,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // UPDATE USER PROFILE
  if (req.method === 'PUT') {
    const { id, name, role, hourly_rate, google_calendar_id, password, email } = body;
    if (!id) {
      return new Response(JSON.stringify({ error: 'id is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Update auth fields (email and/or password) in Supabase Auth if provided
    const authUpdates: Record<string, string> = {};
    if (password) authUpdates.password = password;
    if (email) authUpdates.email = email;

    if (Object.keys(authUpdates).length > 0) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, authUpdates);
      if (authError) {
        return new Response(JSON.stringify({ error: 'Auth update failed: ' + authError.message }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
    }

    // Also update email in profiles table if changed
    if (email) {
      await supabaseAdmin.from('profiles').update({ email }).eq('id', id);
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;
    if (hourly_rate !== undefined) updates.hourly_rate = hourly_rate;
    if (google_calendar_id !== undefined) updates.google_calendar_id = google_calendar_id;

    const { error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', id);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // DELETE USER
  if (req.method === 'DELETE') {
    const { id } = body;
    if (!id) {
      return new Response(JSON.stringify({ error: 'id is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
};

export const config = {
  path: '/api/admin-users',
};
