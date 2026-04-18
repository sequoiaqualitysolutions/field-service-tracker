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
      if (h <= 40) { regularHours += h; }
      else { regularHours += 40; overtimeHours += h - 40; }
    });

    const gpsFlags = techEntries.filter(e =>
      (e.start_lat == null || e.stop_lat == null) ||
      (e.distance_km != null && e.distance_km > 2)
    ).length;

    return { techEntries, totalHours, weeklyHours, regularHours, overtimeHours, gpsFlags };
  }

  function exportCSV() {
    const headers = ['Technician', 'Email', 'Hourly Rate', 'Regular Hours', 'OT Hours', 'Total Hours', 'Regular Pay', 'OT Pay (1.5x)', 'Total Pay', 'GPS Flags'];
    const rows = techs.map(t => {
      const d = getTechData(t.id);
      const rate = Number(t.hourly_rate);
      const regPay = d.regularHours * rate;
      const otPay = d.overtimeHours * rate * 1.5;
      return [t.name, t.email, rate.toFixed(2), d.regularHours.toFixed(2), d.overtimeHours.toFixed(2), d.totalHours.toFixed(2), regPay.toFixed(2), otPay.toFixed(2), (regPay + otPay).toFixed(2), d.gpsFlags.toString()];
    });

    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
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
                      <MapPin size={10} /> {d.gpsFlags} GPS flag{d.gpsFlags > 1 ? 's' : ''}
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
                      const reg = Math.min(h, 40);
                      const ot = Math.max(0, h - 40);
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
