import React, { useState, useEffect } from 'react';
import { DollarSign, Download, Calendar, MapPin } from 'lucide-react';
import { Profile, TimeEntry } from '../types';
import { supabase } from '../lib/supabase';
import { formatDuration, calcHours, getWeeksInMonth } from '../utils/helpers';

export const PayReport: React.FC = () => {
  const [techs, setTechs] = useState<Profile[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => { loadData(); }, [month, year]);

  async function loadData() {
    const { data: techRows } = await supabase
      .from('profiles')
      .select('*')
      .in('role', ['tech', 'team_leader'])
      .order('name');
    setTechs((techRows || []) as Profile[]);

    const startDate = new Date(year, month, 1).toISOString();
    const endDate = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    const { data: entryRows } = await supabase
      .from('time_entries')
      .select('*, clients(name, account_number), profiles!time_entries_tech_id_fkey(name)')
      .gte('start_time', startDate)
      .lte('start_time', endDate)
      .not('end_time', 'is', null)
      .order('start_time');

    setEntries((entryRows || []) as unknown as TimeEntry[]);
  }

  const weeks = getWeeksInMonth(year, month);

  function getTechData(techId: string) {
    const techEntries = entries.filter(e => e.tech_id === techId);
    const totalHours = techEntries.reduce((sum, e) => sum + calcHours(e.start_time, e.end_time), 0);

    const weeklyHours = weeks.map(w =>
      techEntries
        .filter(e => {
          const day = new Date(e.start_time).getDate();
          return day >= w.startDay && day <= w.endDay;
        })
        .reduce((sum, e) => sum + calcHours(e.start_time, e.end_time), 0)
    );

    let regularHours = 0;
    let overtimeHours = 0;
    weeklyHours.forEach(h => {
      if (h <= 45) { regularHours += h; }
      else { regularHours += 45; overtimeHours += h - 45; }
    });

    const gpsFlags = techEntries.filter(e =>
      e.start_lat == null || e.stop_lat == null
    ).length;
    const distanceFlags = techEntries.filter(e =>
      e.distance_km != null && e.distance_km > 1
    ).length;
    const shortVisitFlags = techEntries.filter(e =>
      e.end_time && (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000 < 10
    ).length;
    const totalFlags = gpsFlags + distanceFlags + shortVisitFlags;

    return { techEntries, totalHours, weeklyHours, regularHours, overtimeHours, gpsFlags, distanceFlags, shortVisitFlags, totalFlags };
  }

  function exportCSV() {
    // Summary sheet
    const summaryHeaders = ['Technician', 'Email', 'Hourly Rate', 'Regular Hours', 'OT Hours', 'Total Hours', 'Regular Pay', 'OT Pay (1.5x)', 'Total Pay', 'GPS Missing Flags', 'Distance > 1km Flags', 'Short Visit Flags', 'Total Flags'];
    const summaryRows = techs.map(t => {
      const d = getTechData(t.id);
      const rate = Number(t.hourly_rate);
      const regPay = d.regularHours * rate;
      const otPay = d.overtimeHours * rate * 1.5;
      return [t.name, t.email, rate.toFixed(2), d.regularHours.toFixed(2), d.overtimeHours.toFixed(2), d.totalHours.toFixed(2), regPay.toFixed(2), otPay.toFixed(2), (regPay + otPay).toFixed(2), d.gpsFlags.toString(), d.distanceFlags.toString(), d.shortVisitFlags.toString(), d.totalFlags.toString()];
    });

    // Detailed entries with notes
    const detailHeaders = ['Technician', 'Client', 'Account #', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Notes', 'GPS Missing', 'Distance > 1km', 'Short Visit'];
    const detailRows = entries.map(e => {
      const techName = (e.profiles as any)?.name || 'Unknown';
      const clientName = (e.clients as any)?.name || 'Unknown';
      const acctNum = (e.clients as any)?.account_number || '';
      const date = new Date(e.start_time).toLocaleDateString();
      const clockIn = new Date(e.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const clockOut = e.end_time ? new Date(e.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const hrs = calcHours(e.start_time, e.end_time).toFixed(2);
      const notes = (e.notes || '').replace(/,/g, ';').replace(/\n/g, ' ');
      const gpsMissing = (e.start_lat == null || e.stop_lat == null) ? 'YES' : '';
      const distFlag = (e.distance_km != null && e.distance_km > 1) ? `YES (${e.distance_km.toFixed(2)}km)` : '';
      const durMin = e.end_time ? (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000 : 999;
      const shortFlag = durMin < 10 ? `YES (${Math.round(durMin)}min)` : '';
      return [techName, clientName, acctNum, date, clockIn, clockOut, hrs, notes, gpsMissing, distFlag, shortFlag];
    });

    const csv = '--- SUMMARY ---\n' + [summaryHeaders, ...summaryRows].map(r => r.join(',')).join('\n') +
      '\n\n--- DETAILED ENTRIES ---\n' + [detailHeaders, ...detailRows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pay-report-${monthNames[month]}-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Grand totals
  let grandRegular = 0, grandOT = 0, grandPay = 0;
  techs.forEach(t => {
    const d = getTechData(t.id);
    const rate = Number(t.hourly_rate);
    grandRegular += d.regularHours;
    grandOT += d.overtimeHours;
    grandPay += d.regularHours * rate + d.overtimeHours * rate * 1.5;
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <DollarSign size={22} className="text-primary" /> Pay Report
        </h2>
        <div className="flex gap-2">
          <select className="select select-bordered select-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {monthNames.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select className="select select-bordered select-sm" value={year} onChange={e => setYear(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={exportCSV}>
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="stat bg-base-200 rounded-lg p-3">
          <div className="stat-title text-xs">Regular Hours</div>
          <div className="stat-value text-xl text-success">{grandRegular.toFixed(1)}</div>
        </div>
        <div className="stat bg-base-200 rounded-lg p-3">
          <div className="stat-title text-xs">Overtime Hours</div>
          <div className={`stat-value text-xl ${grandOT > 0 ? 'text-error' : ''}`}>{grandOT.toFixed(1)}</div>
        </div>
        <div className="stat bg-base-200 rounded-lg p-3">
          <div className="stat-title text-xs">Total Payroll</div>
          <div className="stat-value text-xl">${grandPay.toFixed(2)}</div>
        </div>
      </div>

      {/* Per-tech breakdown */}
      {techs.map(t => {
        const d = getTechData(t.id);
        const rate = Number(t.hourly_rate);
        const regPay = d.regularHours * rate;
        const otPay = d.overtimeHours * rate * 1.5;
        const totalPay = regPay + otPay;

        return (
          <div key={t.id} className={`card ${d.overtimeHours > 0 ? 'bg-error/10 border border-error/30' : 'bg-base-200'}`}>
            <div className="card-body p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold">{t.name}</h3>
                  <p className="text-xs text-base-content/50">{t.email} • ${rate.toFixed(2)}/hr</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">${totalPay.toFixed(2)}</p>
                  {d.overtimeHours > 0 && <span className="badge badge-error badge-xs">OT: +${otPay.toFixed(2)}</span>}
                  {d.gpsFlags > 0 && (
                    <span className="badge badge-warning badge-xs mt-1 flex items-center gap-1">
                      🟡 {d.gpsFlags} GPS missing
                    </span>
                  )}
                  {d.distanceFlags > 0 && (
                    <span className="badge badge-error badge-xs mt-1 flex items-center gap-1">
                      🔴 {d.distanceFlags} distance {'>'} 1km
                    </span>
                  )}
                  {d.shortVisitFlags > 0 && (
                    <span className="badge badge-error badge-xs mt-1 flex items-center gap-1">
                      ⏱️ {d.shortVisitFlags} short visit{d.shortVisitFlags > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Weekly breakdown */}
              <div className="overflow-x-auto mt-2">
                <table className="table table-xs">
                  <thead>
                    <tr>
                      <th>Week</th>
                      <th>Hours</th>
                      <th>Regular</th>
                      <th>OT</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.weeklyHours.map((h, i) => {
                      const reg = Math.min(h, 45);
                      const ot = Math.max(0, h - 45);
                      return (
                        <tr key={i} className={ot > 0 ? 'text-error' : ''}>
                          <td>{weeks[i].label}</td>
                          <td className="font-semibold">{h.toFixed(1)}h</td>
                          <td>{reg.toFixed(1)}h</td>
                          <td>{ot > 0 ? `+${ot.toFixed(1)}h` : '—'}</td>
                          <td>{ot > 0 ? '🔴 Over' : h > 0 ? '✅' : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold">
                      <td>TOTAL</td>
                      <td>{d.totalHours.toFixed(1)}h</td>
                      <td>{d.regularHours.toFixed(1)}h</td>
                      <td className={d.overtimeHours > 0 ? 'text-error' : ''}>{d.overtimeHours > 0 ? `+${d.overtimeHours.toFixed(1)}h` : '—'}</td>
                      <td>${totalPay.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Detailed entries with notes */}
              {d.techEntries.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80">
                    📋 View {d.techEntries.length} time entries with notes
                  </summary>
                  <div className="overflow-x-auto mt-2">
                    <table className="table table-xs">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Client</th>
                          <th>In</th>
                          <th>Out</th>
                          <th>Hours</th>
                          <th>Notes</th>
                          <th>Flags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.techEntries.map(entry => {
                          const hrs = calcHours(entry.start_time, entry.end_time);
                          const durMin = entry.end_time ? (new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 60000 : 999;
                          const flags: string[] = [];
                          if (entry.start_lat == null || entry.stop_lat == null) flags.push('🟡 No GPS');
                          if (entry.distance_km != null && entry.distance_km > 1) flags.push(`🔴 ${entry.distance_km.toFixed(1)}km`);
                          if (durMin < 10) flags.push(`⏱️ ${Math.round(durMin)}min`);
                          return (
                            <tr key={entry.id}>
                              <td className="whitespace-nowrap">{new Date(entry.start_time).toLocaleDateString()}</td>
                              <td>{(entry.clients as any)?.name || '—'}</td>
                              <td className="whitespace-nowrap">{new Date(entry.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                              <td className="whitespace-nowrap">{entry.end_time ? new Date(entry.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                              <td>{hrs.toFixed(1)}h</td>
                              <td className="text-xs text-base-content/70 max-w-[200px]">{entry.notes || <span className="text-base-content/30 italic">No notes</span>}</td>
                              <td>{flags.length > 0 ? flags.join(' ') : '✅'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          </div>
        );
      })}

      {techs.length === 0 && (
        <div className="text-center py-12 text-base-content/50">
          <Calendar size={48} className="mx-auto mb-3 opacity-30" />
          <p>No technicians found. Add techs in the Technicians page first.</p>
        </div>
      )}
    </div>
  );
};
