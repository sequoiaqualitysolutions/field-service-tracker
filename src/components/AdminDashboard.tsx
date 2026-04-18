import React, { useState, useEffect, useRef } from 'react';
import { BarChart3, AlertTriangle, Users, Clock, TrendingUp, MapPin } from 'lucide-react';
import { Profile, TimeEntry, WeekInfo } from '../types';
import { supabase } from '../lib/supabase';
import { formatDuration, getWeeksInMonth, calcHours } from '../utils/helpers';
import Chart from 'chart.js/auto';

export const AdminDashboard: React.FC = () => {
  const [techs, setTechs] = useState<Profile[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedTech, setSelectedTech] = useState<string>('all');
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  useEffect(() => { loadData(); }, [month, year]);
  useEffect(() => { if (techs.length && entries.length >= 0) renderChart(); }, [techs, entries, selectedTech]);

  async function loadData() {
    const { data: techRows } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'tech')
      .order('name');
    setTechs((techRows || []) as Profile[]);

    const startDate = new Date(year, month, 1).toISOString();
    const endDate = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    const { data: entryRows } = await supabase
      .from('time_entries')
      .select('*, clients(name, account_number), profiles(name)')
      .gte('start_time', startDate)
      .lte('start_time', endDate)
      .not('end_time', 'is', null);

    setEntries((entryRows || []) as unknown as TimeEntry[]);
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
      if (hrs > 40) {
        otAlerts.push({ techName: t.name, week: weeks[i].label, hours: hrs, otHours: hrs - 40 });
      }
    });
  });

  const totalOtHours = otAlerts.reduce((s, a) => s + a.otHours, 0);
  const totalHours = techs.reduce((s, t) => s + getTotalHours(t.id), 0);

  // GPS distance analysis
  const gpsAlerts: { techName: string; clientName: string; date: string; reason: string; distance?: number }[] = [];
  entries.forEach(e => {
    const techName = (e.profiles as any)?.name || 'Unknown';
    const clientName = (e.clients as any)?.name || 'Unknown';
    const date = new Date(e.start_time).toLocaleDateString();
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

  // SQS brand-aligned chart colors
  const colors = ['#f27c22', '#d17609', '#935f10', '#6c5f14', '#36d399', '#3abff8', '#a78bfa', '#fb923c'];

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
        pointRadius: weeklyHrs.map(h => h > 40 ? 6 : 4),
        pointBackgroundColor: weeklyHrs.map(h => h > 40 ? '#ef4444' : colors[i % colors.length]),
        segment: {
          borderColor: (ctx: any) => {
            const idx = ctx.p0DataIndex;
            return weeklyHrs[idx] > 40 || weeklyHrs[idx + 1] > 40 ? '#ef4444' : undefined;
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
                return hrs > 40 ? `⚠️ OVERTIME: ${(hrs - 40).toFixed(1)}h over 40h` : '';
              },
            },
          },
        },
        scales: {
          y: {
            min: 0,
            max: maxHrs,
            ticks: {
              color: (ctx: any) => ctx.tick?.value != null && ctx.tick.value >= 40 ? '#ef4444' : '#e0d6cc',
              callback: (v: number | string) => Number(v) === 40 ? '40h ⛔' : `${v}h`,
              font: (ctx: any) => ({ size: 10, family: 'Montserrat', weight: (ctx.tick?.value != null && ctx.tick.value === 40 ? 'bold' : 'normal') as any }),
            },
            grid: {
              color: (ctx: any) => ctx.tick?.value != null && ctx.tick.value === 40 ? '#ef4444' : '#1a1f26',
              lineWidth: (ctx: any) => ctx.tick?.value != null && ctx.tick.value === 40 ? 2 : 1,
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
          <div className="stat-title text-xs"><Users size={14} className="inline mr-1" />Technicians</div>
          <div className="stat-value text-xl">{techs.length}</div>
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

      {/* Chart */}
      <div className="card bg-base-200 border border-primary/10">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm mb-2">Weekly Hours — {monthNames[month]} {year}</h3>
          <div style={{ height: '320px' }}>
            <canvas ref={chartRef} />
          </div>
          <p className="text-xs text-base-content/40 mt-2">Red dashed line = 40h/week threshold. Points turn red when over.</p>
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
            <h3 className="font-bold">📍 GPS Distance Alert — {gpsAlerts.length} flagged entry(ies)</h3>
            <p className="text-xs">Entries where distance between clock-in and clock-out exceeds 2 km, or GPS was missing.</p>
          </div>
        </div>
      )}

      {gpsAlerts.length > 0 && (
        <div className="card bg-base-200 border border-warning/20">
          <div className="card-body p-4">
            <h3 className="font-semibold text-sm text-warning flex items-center gap-2">
              <MapPin size={16} /> GPS Distance Flags
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
                      <td>{a.reason === 'Missing GPS' ? '🟡 No GPS' : '🔴 Moved > 2 km'}</td>
                      <td>{a.distance ? `${a.distance.toFixed(2)} km` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tech Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {techs.map((t, idx) => {
          const totalHrs = getTotalHours(t.id);
          const weeklyHrs = getWeeklyHours(t.id);
          const hasOt = weeklyHrs.some(h => h > 40);
          return (
            <div key={t.id} className={`card ${hasOt ? 'bg-error/10 border-2 border-error/40' : 'bg-base-200 border border-primary/10'}`}>
              <div className="card-body p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-xs text-base-content/50">${Number(t.hourly_rate).toFixed(2)}/hr</p>
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
                        className={`badge badge-xs ${h > 40 ? 'badge-error' : h > 0 ? 'badge-primary' : 'badge-ghost'}`}
                      >
                        W{wi + 1}: {h.toFixed(1)}h {h > 40 ? '🔥' : ''}
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
