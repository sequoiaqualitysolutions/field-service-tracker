import type { Context } from "@netlify/functions";
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async (req: Request, context: Context) => {
  const supabase = createClient(supabaseUrl, serviceKey);
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  // Auth check: verify JWT and check is_platform_admin
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('is_platform_admin').eq('id', user.id).single();
  if (!profile?.is_platform_admin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

  // Route by action
  if (req.method === 'GET') {
    if (action === 'overview') {
      // Get aggregate stats
      const { count: clientCount } = await supabase.from('sqs_clients').select('*', { count: 'exact', head: true }).eq('status', 'active');
      const { count: userCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).neq('is_platform_admin', true);
      
      // Monthly revenue
      const { data: clients } = await supabase.from('sqs_clients').select('monthly_rate').eq('status', 'active');
      const monthlyRevenue = (clients || []).reduce((sum, c) => sum + Number(c.monthly_rate), 0);
      
      // Hours this month
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { data: entries } = await supabase.from('time_entries').select('start_time, end_time').not('end_time', 'is', null).gte('start_time', firstOfMonth);
      let totalHours = 0;
      (entries || []).forEach(e => {
        totalHours += (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3600000;
      });

      // Flags this month
      let flagCount = 0;
      const { data: flagEntries } = await supabase.from('time_entries')
        .select('start_time, end_time, distance_km, start_lat, clients!inner(service_type)')
        .not('end_time', 'is', null)
        .gte('start_time', firstOfMonth);
      (flagEntries || []).forEach((e: any) => {
        if (e.clients?.service_type === 'INTERNAL') return;
        const mins = (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000;
        if (e.distance_km && e.distance_km > 1) flagCount++;
        if (mins < 10) flagCount++;
        if (!e.start_lat) flagCount++;
      });

      return new Response(JSON.stringify({
        activeClients: clientCount || 0,
        totalUsers: userCount || 0,
        monthlyRevenue,
        hoursThisMonth: Math.round(totalHours * 10) / 10,
        flagsThisMonth: flagCount,
      }));
    }

    if (action === 'clients') {
      const { data: clientList } = await supabase.from('sqs_clients').select('*').order('created_at', { ascending: false });
      
      // Enrich with live user counts
      const { data: profiles } = await supabase.from('profiles').select('role').neq('is_platform_admin', true);
      const enriched = (clientList || []).map(c => ({
        ...c,
        user_count: (profiles || []).length, // For now, all users belong to same DB
      }));

      return new Response(JSON.stringify(enriched));
    }

    if (action === 'client') {
      const clientId = url.searchParams.get('id');
      const { data: client } = await supabase.from('sqs_clients').select('*').eq('id', clientId).single();
      if (!client) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

      // Get live stats for this client (same DB)
      const { data: profiles } = await supabase.from('profiles').select('id, name, role, hourly_rate').neq('is_platform_admin', true);
      
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { data: entries } = await supabase.from('time_entries').select('start_time, end_time, distance_km, start_lat, clients!inner(service_type)').not('end_time', 'is', null).gte('start_time', firstOfMonth);
      
      let totalHours = 0;
      let flagCount = 0;
      (entries || []).forEach((e: any) => {
        totalHours += (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3600000;
        if (e.clients?.service_type === 'INTERNAL') return;
        const mins = (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000;
        if (e.distance_km && e.distance_km > 1) flagCount++;
        if (mins < 10) flagCount++;
        if (!e.start_lat) flagCount++;
      });

      // Monthly hours for last 6 months (for chart)
      const monthlyHours: { month: string; hours: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = d.toISOString();
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
        const { data: mEntries } = await supabase.from('time_entries').select('start_time, end_time').not('end_time', 'is', null).gte('start_time', start).lt('start_time', end);
        let mHours = 0;
        (mEntries || []).forEach(e => {
          mHours += (new Date(e.end_time!).getTime() - new Date(e.start_time).getTime()) / 3600000;
        });
        monthlyHours.push({ month: d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' }), hours: Math.round(mHours * 10) / 10 });
      }

      return new Response(JSON.stringify({
        ...client,
        user_count: (profiles || []).length,
        users_by_role: {
          admin: (profiles || []).filter(p => p.role === 'admin').length,
          team_leader: (profiles || []).filter(p => p.role === 'team_leader').length,
          tech: (profiles || []).filter(p => p.role === 'tech').length,
        },
        hours_this_month: Math.round(totalHours * 10) / 10,
        flags_this_month: flagCount,
        monthly_hours: monthlyHours,
      }));
    }
  }

  if (req.method === 'PUT') {
    const body = await req.json();
    const { id, ...updates } = body;
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('sqs_clients').update(updates).eq('id', id).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    return new Response(JSON.stringify(data));
  }

  if (req.method === 'POST') {
    const body = await req.json();
    const { data, error } = await supabase.from('sqs_clients').insert(body).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    return new Response(JSON.stringify(data));
  }

  if (req.method === 'DELETE') {
    const clientId = url.searchParams.get('id');
    const { error } = await supabase.from('sqs_clients').delete().eq('id', clientId);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    return new Response(JSON.stringify({ success: true }));
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
};

export const config = {
  path: '/api/sqs-admin',
};
