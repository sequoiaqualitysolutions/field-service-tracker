import React, { useState, useEffect } from 'react';
import { DollarSign, Download, Calendar, MapPin } from 'lucide-react';
import { Profile, TimeEntry } from '../types';
import { supabase } from '../lib/supabase';
import { formatDuration, calcHours, getWeeksInMonth } from '../utils/helpers';
import * as XLSX from 'xlsx';


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
      .select('*, clients(name, account_number, service_type), profiles!time_entries_tech_id_fkey(name)')
      .gte('start_time', startDate)
      .lte('start_time', endDate)
      .not('end_time', 'is', null)
      .order('start_time');

    setEntries((entryRows || []) as unknown as TimeEntry[]);
  }

  const weeks = getWeeksInMonth(year, month);

  function isSunday(dateStr: string) {
    return new Date(dateStr).getDay() === 0;
  }

  function getTechData(techId: string) {
    const techEntries = entries.filter(e => e.tech_id === techId);
    const totalHours = techEntries.reduce((sum, e) => sum + calcHours(e.start_time, e.end_time), 0);

    // Split hours per week into weekday and Sunday
    const weeklyData = weeks.map(w => {
      const weekEntries = techEntries.filter(e => {
        const day = new Date(e.start_time).getDate();
        return day >= w.startDay && day <= w.endDay;
      });
      const weekdayHours = weekEntries
        .filter(e => !isSunday(e.start_time))
        .reduce((sum, e) => sum + calcHours(e.start_time, e.end_time), 0);
      const sundayHours = weekEntries
        .filter(e => isSunday(e.start_time))
        .reduce((sum, e) => sum + calcHours(e.start_time, e.end_time), 0);
      return { weekdayHours, sundayHours, totalHours: weekdayHours + sundayHours };
    });

    // Regular / OT is calculated on weekday hours only (Sunday is separate at 2x)
    let regularHours = 0;
    let overtimeHours = 0;
    let sundayHours = 0;
    weeklyData.forEach(w => {
      if (w.weekdayHours <= 45) { regularHours += w.weekdayHours; }
      else { regularHours += 45; overtimeHours += w.weekdayHours - 45; }
      sundayHours += w.sundayHours;
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

    return { techEntries, totalHours, weeklyData, regularHours, overtimeHours, sundayHours, gpsFlags, distanceFlags, shortVisitFlags, totalFlags };
  }

  function exportReport() {
    const wb = XLSX.utils.book_new();

    // ========== TAB 1: Summary ==========
    const summaryRows: any[][] = [];
    summaryRows.push(['PAY REPORT SUMMARY']);
    summaryRows.push([`Month: ${monthNames[month]} ${year}`]);
    summaryRows.push([]);
    summaryRows.push(['Technician','Email','Hourly Rate (R)','Regular Hours','OT Hours (1.5x)','Sunday Hours (2x)','Total Hours','Regular Pay (R)','OT Pay (R)','Sunday Pay (R)','Total Pay (R)','GPS Missing','Distance > 1km','Short Visit','Total Flags']);

    let tReg = 0, tOT = 0, tSun = 0, tTotalHrs = 0, tPay = 0;
    techs.forEach(t => {
      const d = getTechData(t.id);
      const rate = Number(t.hourly_rate);
      const regPay = d.regularHours * rate;
      const otPay = d.overtimeHours * rate * 1.5;
      const sunPay = d.sundayHours * rate * 2;
      const totalPay = regPay + otPay + sunPay;
      tReg += d.regularHours; tOT += d.overtimeHours; tSun += d.sundayHours;
      tTotalHrs += d.totalHours; tPay += totalPay;
      summaryRows.push([
        t.name, t.email, Number(rate.toFixed(2)),
        Number(d.regularHours.toFixed(2)), Number(d.overtimeHours.toFixed(2)), Number(d.sundayHours.toFixed(2)), Number(d.totalHours.toFixed(2)),
        Number(regPay.toFixed(2)), Number(otPay.toFixed(2)), Number(sunPay.toFixed(2)), Number(totalPay.toFixed(2)),
        d.gpsFlags, d.distanceFlags, d.shortVisitFlags, d.totalFlags
      ]);
    });
    summaryRows.push([]);
    summaryRows.push(['TOTALS','','',Number(tReg.toFixed(2)),Number(tOT.toFixed(2)),Number(tSun.toFixed(2)),Number(tTotalHrs.toFixed(2)),'','','',Number(tPay.toFixed(2)),'','','','']);

    const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
    ws1['!cols'] = [
      { wch: 20 }, // Technician
      { wch: 28 }, // Email
      { wch: 14 }, // Hourly Rate
      { wch: 14 }, // Regular Hours
      { wch: 16 }, // OT Hours
      { wch: 18 }, // Sunday Hours
      { wch: 14 }, // Total Hours
      { wch: 16 }, // Regular Pay
      { wch: 14 }, // OT Pay
      { wch: 16 }, // Sunday Pay
      { wch: 16 }, // Total Pay
      { wch: 14 }, // GPS Missing
      { wch: 16 }, // Distance
      { wch: 14 }, // Short Visit
      { wch: 14 }, // Total Flags
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

    // ========== TAB 2: Detailed Entries ==========
    const detailRows: any[][] = [];
    detailRows.push(['DETAILED TIME ENTRIES']);
    detailRows.push([`Month: ${monthNames[month]} ${year}`]);
    detailRows.push([]);
    detailRows.push(['Technician','Client','Activity','Account #','Date','Day','Clock In','Clock Out','Hours','Sunday','Notes','GPS Missing','Distance > 1km','Short Visit']);

    entries.forEach(e => {
      const techName = (e.profiles as any)?.name || 'Unknown';
      const isInternal = (e.clients as any)?.service_type === 'INTERNAL';
      const clientName = isInternal ? '' : ((e.clients as any)?.name || 'Unknown');
      const activityName = isInternal ? ((e.clients as any)?.name || '').replace(/[\u{1F4CB}\u{1F527}\u{1F697}\u{1F4DA}\u{1F37D}]\s*/gu, '') : '';
      const acctNum = isInternal ? '' : ((e.clients as any)?.account_number || '');
      const entryDate = new Date(e.start_time);
      const date = entryDate.toLocaleDateString();
      const dayName = entryDate.toLocaleDateString('en-US', { weekday: 'short' });
      const clockIn = entryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const clockOut = e.end_time ? new Date(e.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const hrs = Number(calcHours(e.start_time, e.end_time).toFixed(2));
      const isSun = isSunday(e.start_time) ? 'YES' : '';
      const notes = (e.notes || '').replace(/\n/g, ' ');
      const gpsMissing = isInternal ? '' : ((e.start_lat == null || e.stop_lat == null) ? 'YES' : '');
      const distFlag = isInternal ? '' : ((e.distance_km != null && e.distance_km > 1) ? `YES (${e.distance_km.toFixed(2)}km)` : '');
      const durMin = e.end_time ? (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000 : 999;
      const shortFlag = isInternal ? '' : (durMin < 10 ? `YES (${Math.round(durMin)}min)` : '');

      detailRows.push([
        techName, clientName, activityName, acctNum,
        date, dayName, clockIn, clockOut, hrs, isSun, notes,
        gpsMissing, distFlag, shortFlag
      ]);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(detailRows);
    ws2['!cols'] = [
      { wch: 18 }, // Technician
      { wch: 24 }, // Client
      { wch: 22 }, // Activity
      { wch: 14 }, // Account #
      { wch: 14 }, // Date
      { wch: 8 },  // Day
      { wch: 12 }, // Clock In
      { wch: 12 }, // Clock Out
      { wch: 10 }, // Hours
      { wch: 10 }, // Sunday
      { wch: 30 }, // Notes
      { wch: 14 }, // GPS Missing
      { wch: 18 }, // Distance
      { wch: 16 }, // Short Visit
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Detailed Entries');

    // Generate and download
    const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pay-report-${monthNames[month]}-${year}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Grand totals
  let grandRegular = 0, grandOT = 0, grandSunday = 0, grandPay = 0;
  techs.forEach(t => {
    const d = getTechData(t.id);
    const rate = Number(t.hourly_rate);
    grandRegular += d.regularHours;
    grandOT += d.overtimeHours;
    grandSunday += d.sundayHours;
    grandPay += d.regularHours * rate + d.overtimeHours * rate * 1.5 + d.sundayHours * rate * 2;
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
          <button className="btn btn-primary btn-sm" onClick={exportReport}>
            <Download size={14} /> Export Report
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat bg-base-200 rounded-lg p-3">
          <div className="stat-title text-xs">Regular Hours</div>
          <div className="stat-value text-xl text-success">{grandRegular.toFixed(1)}</div>
        </div>
        <div className="stat bg-base-200 rounded-lg p-3">
          <div className="stat-title text-xs">Overtime Hours (1.5x)</div>
          <div className={`stat-value text-xl ${grandOT > 0 ? 'text-error' : ''}`}>{grandOT.toFixed(1)}</div>
        </div>
        <div className="stat bg-base-200 rounded-lg p-3">
          <div className="stat-title text-xs">Sunday Hours (2x)</div>
          <div className={`stat-value text-xl ${grandSunday > 0 ? 'text-warning' : ''}`}>{grandSunday.toFixed(1)}</div>
        </div>
        <div className="stat bg-base-200 rounded-lg p-3">
          <div className="stat-title text-xs">Total Payroll</div>
          <div className="stat-value text-xl">R{grandPay.toFixed(2)}</div>
        </div>
      </div>

      {/* Per-tech breakdown */}
      {techs.map(t => {
        const d = getTechData(t.id);
        const rate = Number(t.hourly_rate);
        const regPay = d.regularHours * rate;
        const otPay = d.overtimeHours * rate * 1.5;
        const sunPay = d.sundayHours * rate * 2;
        const totalPay = regPay + otPay + sunPay;
        const hasOTOrSunday = d.overtimeHours > 0 || d.sundayHours > 0;

        return (
          <div key={t.id} className={`card ${hasOTOrSunday ? 'bg-error/10 border border-error/30' : 'bg-base-200'}`}>
            <div className="card-body p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold">{t.name}</h3>
                  <p className="text-xs text-base-content/50">{t.email} • R{rate.toFixed(2)}/hr</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">R{totalPay.toFixed(2)}</p>
                  {d.overtimeHours > 0 && <span className="badge badge-error badge-xs">OT 1.5x: +R{otPay.toFixed(2)}</span>}
                  {d.sundayHours > 0 && <span className="badge badge-warning badge-xs ml-1">Sun 2x: +R{sunPay.toFixed(2)}</span>}
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
                      <th>Total</th>
                      <th>Regular</th>
                      <th>OT (1.5x)</th>
                      <th>Sunday (2x)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.weeklyData.map((w, i) => {
                      const reg = Math.min(w.weekdayHours, 45);
                      const ot = Math.max(0, w.weekdayHours - 45);
                      const hasFlags = ot > 0 || w.sundayHours > 0;
                      return (
                        <tr key={i} className={hasFlags ? 'text-error' : ''}>
                          <td>{weeks[i].label}</td>
                          <td className="font-semibold">{w.totalHours.toFixed(1)}h</td>
                          <td>{reg.toFixed(1)}h</td>
                          <td>{ot > 0 ? `+${ot.toFixed(1)}h` : '—'}</td>
                          <td className={w.sundayHours > 0 ? 'text-warning font-semibold' : ''}>{w.sundayHours > 0 ? `${w.sundayHours.toFixed(1)}h` : '—'}</td>
                          <td>
                            {ot > 0 && '🔴 OT '}
                            {w.sundayHours > 0 && '🟡 Sun '}
                            {ot === 0 && w.sundayHours === 0 && w.totalHours > 0 && '✅'}
                            {w.totalHours === 0 && '—'}
                          </td>
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
                      <td className={d.sundayHours > 0 ? 'text-warning' : ''}>{d.sundayHours > 0 ? `${d.sundayHours.toFixed(1)}h` : '—'}</td>
                      <td>R{totalPay.toFixed(2)}</td>
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
                          <th>Day</th>
                          <th>Client</th>
                          <th>Activity</th>
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
                          const isEntryInternal = (entry.clients as any)?.service_type === 'INTERNAL';
                          if (!isEntryInternal && (entry.start_lat == null || entry.stop_lat == null)) flags.push('🟡 No GPS');
                          if (!isEntryInternal && entry.distance_km != null && entry.distance_km > 1) flags.push(`🔴 ${entry.distance_km.toFixed(1)}km`);
                          if (durMin < 10) flags.push(`⏱️ ${Math.round(durMin)}min`);
                          const isSun = isSunday(entry.start_time);
                          if (isSun) flags.push('☀️ Sun 2x');
                          const entryDate = new Date(entry.start_time);
                          const dayName = entryDate.toLocaleDateString('en-US', { weekday: 'short' });
                          return (
                            <tr key={entry.id} className={isSun ? 'bg-warning/10' : ''}>
                              <td className="whitespace-nowrap">{entryDate.toLocaleDateString()}</td>
                              <td className={isSun ? 'text-warning font-bold' : ''}>{dayName}</td>
                              <td>{(entry.clients as any)?.service_type === 'INTERNAL' ? '—' : ((entry.clients as any)?.name || '—')}</td>
                              <td className="text-amber-500 font-medium">{(entry.clients as any)?.service_type === 'INTERNAL' ? ((entry.clients as any)?.name || '').replace(/[📋🔧🚗📚]\s*/g, '') : '—'}</td>
                              <td className="whitespace-nowrap">{entryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
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
