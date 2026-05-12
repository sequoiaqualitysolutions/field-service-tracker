import React, { useState, useEffect, useRef } from 'react';
import { BarChart3, AlertTriangle, Users, Clock, TrendingUp, MapPin } from 'lucide-react';
import { Profile, TimeEntry, WeekInfo } from '../types';
import { supabase } from '../lib/supabase';
import { formatDuration, getWeeksInMonth, calcHours } from '../utils/helpers';
import { FlaggedGpsMap } from './FlaggedGpsMap';
import Chart from 'chart.js/auto';

export const AdminDashboard: React.FC = () => {
  const [techs, setTechs] = useState<Profile[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedTech, setSelectedTech] = useState<string>('all');
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  useEffect(() => { loadData(); }, [month, year]);
  useEffect(() => { if (techs.length && entries.length >= 0) renderChart(); }, [techs, entries, selectedTech]);

  async function loadData() {
    const { data: techRows } = await supabase
      .from('profiles')
      .select('*')
      .in('role', ['tech', 'team_leader'])
      .order('name');
    setTechs((techRows || []) as Profile[]);

    // Count ALL users including admin
    const { count } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
    setTotalUsers(count || 0);

    const startDate = new Date(year, month, 1).toISOString();
    const endDate = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    const { data: entryRows } = await supabase
      .from('time_entries')
      .select('*, clients(name, account_number, service_type), profiles!time_entries_tech_id_fkey(name)')
      .gte('start_time', startDate)
      .lte('start_time', endDate)
      .not('end_time', 'is', null);

    setEntries((entryRows || []) as unknown as TimeEntry[]);

    // Active sessions
    const { data: activeData } = await supabase
      .from('time_entries')
      .select('id, tech_id, client_id, start_time, clocked_in_by, session_id, notes, profiles!time_entries_tech_id_fkey(name, role), clients(name)')
      .is('end_time', null)
      .order('start_time', { ascending: true });
    setActiveSessions(activeData || []);
  }

  async function handleForceClockOut(entry: any) {
    if (!confirm(`Force clock out ${entry.profiles?.name || 'Unknown'} from ${entry.clients?.name || 'Unknown'}?`)) return;

    const now = new Date().toISOString();

    // Close the time entry
    await supabase.from('time_entries').update({
      end_time: now,
      notes: (entry.notes ? entry.notes + ' | ' : '') + '[Admin force clock-out]',
    }).eq('id', entry.id);

    // If this entry has a session_id, check if all entries in that session are now closed
    if (entry.session_id) {
      const { data: openEntries } = await supabase
        .from('time_entries')
        .select('id')
        .eq('session_id', entry.session_id)
        .is('end_time', null);

      // If no more open entries, close the team session too
      if (!openEntries || openEntries.length === 0) {
        await supabase.from('team_sessions').update({
          end_time: now,
        }).eq('id', entry.session_id);
      }
    }

    await loadData();
  }

  async function handleForceClockOutAll() {
    if (!confirm(`Force clock out ALL ${activeSessions.length} active sessions? This cannot be undone.`)) return;

    const now = new Date().toISOString();

    // Close all open time entries
    for (const entry of activeSessions) {
      await supabase.from('time_entries').update({
        end_time: now,
        notes: (entry.notes ? entry.notes + ' | ' : '') + '[Admin force clock-out]',
      }).eq('id', entry.id);
    }

    // Close all open team sessions
    await supabase.from('team_sessions').update({
      end_time: now,
    }).is('end_time', null);

    await loadData();
  }

  const weeks = getWeeksInMonth(year, month);

  function getWeeklyHours(techId: string): number[] {
    return weeks.map(w => {
      return entries
        .filter(e => {
          if (e.tech_id !== techId) return false;
          const day = new Date(e.start_time).getDate();
          return day >= w.startDay && day <= w.endDay;
        })
        .reduce((sum, e) => sum + calcHours(e.start_time, e.end_time), 0);
    });
  }

  function getTotalHours(techId: string): number {
    return entries
      .filter(e => e.tech_id === techId)
      .reduce((sum, e) => sum + calcHours(e.start_time, e.end_time), 0);
  }

  // OT analysis
  const otAlerts: { techName: string; week: string; hours: number; otHours: number }[] = [];
  techs.forEach(t => {
    const weeklyHrs = getWeeklyHours(t.id);
    weeklyHrs.forEach((hrs, i) => {
      if (hrs > 45) {
        otAlerts.push({ techName: t.name, week: weeks[i].label, hours: hrs, otHours: hrs - 45 });
      }
    });
  });

  const totalOtHours = otAlerts.reduce((s, a) => s + a.otHours, 0);
  const totalHours = techs.reduce((s, t) => s + getTotalHours(t.id), 0);

  // GPS distance analysis
  const gpsAlerts: { techName: string; clientName: string; date: string; reason: string; distance?: number }[] = [];
  entries.forEach(e => {
    // Skip flags for internal time activities (Travel, Office/Admin, etc.)
    if ((e.clients as any)?.service_type === 'INTERNAL') return;
    const techName = (e.profiles as any)?.name || 'Unknown';
    const clientName = (e.clients as any)?.name || 'Unknown';
    const date = new Date(e.start_time).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' });
    if (e.start_lat == null || e.start_lng == null || e.stop_lat == null || e.stop_lng == null) {
      gpsAlerts.push({ techName, clientName, date, reason: 'Missing GPS' });
    } else if (e.distance_km != null && e.distance_km > 1) {
      gpsAlerts.push({ techName, clientName, date, reason: 'Distance > 1 km', distance: e.distance_km });
    }
    // Short duration flag — less than 10 minutes
    const hours = e.end_time ? (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3600000 : 0;
    if (e.end_time && hours < (10 / 60)) {
      const mins = Math.round(hours * 60);
      gpsAlerts.push({ techName, clientName, date, reason: `Short visit: ${mins} min` });
    }
  });

  // 20 unique chart colors — no duplicates for up to 20 techs/leaders
  const colors = [
    '#f27c22', '#3abff8', '#36d399', '#a78bfa', '#fb923c',
    '#f472b6', '#22d3ee', '#facc15', '#4ade80', '#c084fc',
    '#f87171', '#2dd4bf', '#60a5fa', '#fbbf24', '#a3e635',
    '#e879f9', '#34d399', '#f97316', '#818cf8', '#fb7185',
  ];

  function renderChart() {
    if (!chartRef.current) return;
    if (chartInstance.current) chartInstance.current.destroy();

    const filteredTechs = selectedTech === 'all' ? techs : techs.filter(t => t.id === selectedTech);
    const maxHrs = Math.max(50, ...filteredTechs.flatMap(t => getWeeklyHours(t.id))) + 5;

    const datasets = filteredTechs.map((t, i) => {
      const weeklyHrs = getWeeklyHours(t.id);
      return {
        label: t.name,
        data: weeklyHrs,
        borderColor: colors[i % colors.length],
        backgroundColor: colors[i % colors.length] + '33',
        borderWidth: 2,
        tension: 0.3,
        fill: false,
        pointRadius: weeklyHrs.map(h => h > 45 ? 6 : 4),
        pointBackgroundColor: weeklyHrs.map(h => h > 45 ? '#ef4444' : colors[i % colors.length]),
        segment: {
          borderColor: (ctx: any) => {
            const idx = ctx.p0DataIndex;
            return weeklyHrs[idx] > 45 || weeklyHrs[idx + 1] > 45 ? '#ef4444' : undefined;
          },
        },
      };
    });

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: { labels: weeks.map(w => w.label), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#e0d6cc', usePointStyle: true, padding: 15, font: { family: 'Montserrat' } } },
          tooltip: {
            titleFont: { family: 'Montserrat' },
            bodyFont: { family: 'Montserrat' },
            callbacks: {
              afterLabel: (ctx: any) => {
                const hrs = ctx.parsed.y;
                return hrs > 45 ? `⚠️ OVERTIME: ${(hrs - 45).toFixed(1)}h over 45h` : '';
              },
            },
          },
        },
        scales: {
          y: {
            min: 0,
            max: maxHrs,
            afterBuildTicks: (axis: any) => {
              const ticks = axis.ticks || [];
              if (!ticks.find((t: any) => t.value === 45)) {
                ticks.push({ value: 45 });
                ticks.sort((a: any, b: any) => a.value - b.value);
              }
              axis.ticks = ticks;
            },
            ticks: {
              color: (ctx: any) => ctx.tick?.value != null && ctx.tick.value >= 45 ? '#ef4444' : '#e0d6cc',
              callback: (v: number | string) => Number(v) === 45 ? '45h ⛔' : `${v}h`,
              font: (ctx: any) => ({ size: 10, family: 'Montserrat', weight: (ctx.tick?.value != null && ctx.tick.value === 45 ? 'bold' : 'normal') as any }),
            },
            grid: {
              color: (ctx: any) => ctx.tick?.value != null && ctx.tick.value === 45 ? '#ef4444' : '#1a1f26',
              lineWidth: (ctx: any) => ctx.tick?.value != null && ctx.tick.value === 45 ? 2 : 1,
            },
          },
          x: {
            ticks: { color: '#e0d6cc', font: { family: 'Montserrat' } },
            grid: { color: '#1a1f26' },
          },
        },
      },
    });
  }

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return (
    <div className="p-4 space-y-4">
      {/* SPCS Company Header */}
      <div className="bg-base-100 rounded-xl p-4 shadow border border-primary/10">
        <h1 className="text-lg font-black tracking-wider" style={{ fontFamily: "'Waukegan LDO Black', 'Arial Black', sans-serif" }}>
          SCIENTIFIC PEST CONTROL SERVICES
        </h1>
        <p className="text-xs italic text-base-content/60" style={{ fontFamily: 'Arial, sans-serif' }}>
          Specialists in Food, Pharmaceutical Packaging Industries and Fumigation
        </p>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <BarChart3 size={22} className="text-primary" /> Dashboard
        </h2>
        <div className="flex gap-2">
          <select className="select select-bordered select-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {monthNames.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select className="select select-bordered select-sm" value={year} onChange={e => setYear(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="select select-bordered select-sm" value={selectedTech} onChange={e => setSelectedTech(e.target.value)}>
            <option value="all">All Technicians</option>
            {techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {/* OT Alert Banner */}
      {otAlerts.length > 0 && (
        <div className="alert alert-error shadow-lg">
          <AlertTriangle size={20} />
          <div>
            <h3 className="font-bold">⚠️ Overtime Alert — {otAlerts.length} occurrence(s) this month</h3>
            <div className="text-xs mt-1 space-y-0.5">
              {otAlerts.map((a, i) => (
                <p key={i}>🔴 <strong>{a.techName}</strong> — {a.week}: {a.hours.toFixed(1)}h ({a.otHours.toFixed(1)}h OT)</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="stat bg-base-200 rounded-lg p-3 border border-primary/10">
          <div className="stat-title text-xs"><Users size={14} className="inline mr-1" />Users</div>
          <div className="stat-value text-xl">{totalUsers}</div>
        </div>
        <div className="stat bg-base-200 rounded-lg p-3 border border-primary/10">
          <div className="stat-title text-xs"><Clock size={14} className="inline mr-1" />Total Hours</div>
          <div className="stat-value text-xl">{totalHours.toFixed(1)}</div>
        </div>
        <div className="stat bg-base-200 rounded-lg p-3 border border-primary/10">
          <div className="stat-title text-xs">Time Entries</div>
          <div className="stat-value text-xl">{entries.length}</div>
        </div>
        <div className={`stat rounded-lg p-3 ${totalOtHours > 0 ? 'bg-error/20 border border-error/30' : 'bg-base-200 border border-primary/10'}`}>
          <div className="stat-title text-xs"><TrendingUp size={14} className="inline mr-1" />OT Hours</div>
          <div className={`stat-value text-xl ${totalOtHours > 0 ? 'text-error' : ''}`}>
            {totalOtHours.toFixed(1)}
          </div>
        </div>
        <div className={`stat rounded-lg p-3 ${gpsAlerts.length > 0 ? 'bg-warning/20 border border-warning/30' : 'bg-base-200 border border-primary/10'}`}>
          <div className="stat-title text-xs"><MapPin size={14} className="inline mr-1" />GPS Flags</div>
          <div className={`stat-value text-xl ${gpsAlerts.length > 0 ? 'text-warning' : ''}`}>
            {gpsAlerts.length}
          </div>
        </div>
      </div>

      {/* 🟢 Active Sessions - Who's On The Clock */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
              Active Sessions ({activeSessions.length} on the clock)
            </h3>
            {activeSessions.length > 0 && (
              <button
                className="btn btn-xs btn-error"
                onClick={handleForceClockOutAll}
              >
                ⏹ Force Clock Out All
              </button>
            )}
          </div>
          {activeSessions.length === 0 ? (
            <p className="text-sm text-base-content/50 text-center py-4">No one is currently clocked in</p>
          ) : (
            <div className="overflow-x-auto mt-2">
              <table className="table table-xs w-full">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th>Client</th>
                    <th>Notes</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.map((entry: any) => {
                    const startMs = new Date(entry.start_time).getTime();
                    const diffMin = Math.floor((Date.now() - startMs) / 60000);
                    const hours = Math.floor(diffMin / 60);
                    const mins = diffMin % 60;
                    const duration = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                    return (
                      <tr key={entry.id} className="hover">
                        <td className="font-medium">{entry.profiles?.name || 'Unknown'}</td>
                        <td>
                          <span className="badge badge-xs">
                            {entry.profiles?.role === 'team_leader' ? '👑 Leader' : '🔧 Tech'}
                          </span>
                        </td>
                        <td>{entry.clients?.name || 'Unknown'}</td>
                        <td className="text-xs text-base-content/60 max-w-[200px] truncate">{entry.notes || '—'}</td>
                        <td className="text-xs">
                          {new Date(entry.start_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })}
                        </td>
                        <td>
                          <span className={`badge badge-sm ${hours >= 9 ? 'badge-error' : 'badge-success'}`}>
                            {duration}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-xs btn-error btn-outline"
                            onClick={() => handleForceClockOut(entry)}
                            title="Force clock out"
                          >
                            ⏹ Kick
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="card bg-base-200 border border-primary/10">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm mb-2">Weekly Hours — {monthNames[month]} {year}</h3>
          <div style={{ height: '320px' }}>
            <canvas ref={chartRef} />
          </div>
          <p className="text-xs text-base-content/40 mt-2">Red dashed line = 45h/week threshold. Points turn red when over.</p>
        </div>
      </div>

      {/* Overtime Breakdown */}
      {otAlerts.length > 0 && (
        <div className="card bg-base-200 border border-error/20">
          <div className="card-body p-4">
            <h3 className="font-semibold text-sm text-error flex items-center gap-2">
              <AlertTriangle size={16} /> Overtime Breakdown
            </h3>
            <div className="overflow-x-auto mt-2">
              <table className="table table-xs">
                <thead><tr><th>Technician</th><th>Week</th><th>Total Hours</th><th>OT Hours</th></tr></thead>
                <tbody>
                  {otAlerts.map((a, i) => (
                    <tr key={i} className="text-error">
                      <td className="font-semibold">{a.techName}</td>
                      <td>{a.week}</td>
                      <td>{a.hours.toFixed(1)}h</td>
                      <td className="font-bold">+{a.otHours.toFixed(1)}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* GPS Distance Alerts */}
      {gpsAlerts.length > 0 && (
        <div className="alert alert-warning shadow-lg">
          <MapPin size={20} />
          <div>
            <h3 className="font-bold">🚩 Service Alerts — {gpsAlerts.length} flagged entry(ies)</h3>
            <p className="text-xs">Entries where distance exceeds 1 km, GPS was missing, or visit was under 10 minutes.</p>
          </div>
        </div>
      )}

      {gpsAlerts.length > 0 && (
        <div className="card bg-base-200 border border-warning/20">
          <div className="card-body p-4">
            <h3 className="font-semibold text-sm text-warning flex items-center gap-2">
              <MapPin size={16} /> Service Flags
            </h3>
            <div className="overflow-x-auto mt-2">
              <table className="table table-xs">
                <thead><tr><th>Technician</th><th>Client</th><th>Date</th><th>Issue</th><th>Distance</th></tr></thead>
                <tbody>
                  {gpsAlerts.map((a, i) => (
                    <tr key={i} className="text-warning">
                      <td className="font-semibold">{a.techName}</td>
                      <td>{a.clientName}</td>
                      <td>{a.date}</td>
                      <td>{a.reason === 'Missing GPS' ? '🟡 No GPS' : a.reason.startsWith('Short') ? '⏱️ ' + a.reason : '🔴 ' + a.reason}</td>
                      <td>{a.distance ? `${a.distance.toFixed(2)} km` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Flagged GPS Map */}
      <FlaggedGpsMap entries={entries} selectedTech={selectedTech} />

      {/* Tech Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {techs.map((t, idx) => {
          const totalHrs = getTotalHours(t.id);
          const weeklyHrs = getWeeklyHours(t.id);
          const hasOt = weeklyHrs.some(h => h > 45);
          return (
            <div key={t.id} className={`card ${hasOt ? 'bg-error/10 border-2 border-error/40' : 'bg-base-200 border border-primary/10'}`}>
              <div className="card-body p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-xs text-base-content/50">R{Number(t.hourly_rate).toFixed(2)}/hr</p>
                  </div>
                  {hasOt ? (
                    <span className="badge badge-error badge-sm animate-pulse">⚠ OT</span>
                  ) : (
                    <span className="badge badge-success badge-sm">✓ OK</span>
                  )}
                </div>
                <div className="mt-2">
                  <p className="text-xs text-base-content/60">Month total: <span className="font-semibold">{formatDuration(totalHrs)}</span></p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {weeklyHrs.map((h, wi) => (
                      <span
                        key={wi}
                        className={`badge badge-xs ${h > 45 ? 'badge-error' : h > 0 ? 'badge-primary' : 'badge-ghost'}`}
                      >
                        W{wi + 1}: {h.toFixed(1)}h {h > 45 ? '🔥' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
