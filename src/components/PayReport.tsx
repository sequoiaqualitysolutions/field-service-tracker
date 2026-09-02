import React, { useState, useEffect } from 'react';
import { DollarSign, Download, Calendar, MapPin, Pencil, Trash2, X, Save } from 'lucide-react';
import { Profile, TimeEntry } from '../types';
import { supabase } from '../lib/supabase';
import { formatDuration, calcHours, getWeeksInMonth, OT_THRESHOLD } from '../utils/helpers';
import jsPDF from 'jspdf';

const TZ = 'Africa/Johannesburg';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-ZA', { timeZone: TZ });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const toSASTIso = (dateStr: string, timeStr: string) => {
  // Build a date string and interpret as SAST (UTC+2)
  return `${dateStr}T${timeStr}:00+02:00`;
};

export const PayReport: React.FC = () => {
  const [techs, setTechs] = useState<Profile[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedTech, setSelectedTech] = useState<string>('all');
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

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

    // Paginated fetch — Supabase caps at 1000 rows per request
    let allEntries: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data: batch } = await supabase
        .from('time_entries')
        .select('*, clients(name, account_number, service_type), profiles!time_entries_tech_id_fkey(name)')
        .gte('start_time', startDate)
        .lte('start_time', endDate)
        .not('end_time', 'is', null)
        .order('start_time')
        .range(from, from + PAGE - 1);
      const rows = batch || [];
      allEntries = allEntries.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }

    setEntries(allEntries as unknown as TimeEntry[]);
  }

  const weeks = getWeeksInMonth(year, month);

  function isSunday(dateStr: string) {
    return new Date(dateStr).getDay() === 0;
  }

  function getTechData(techId: string) {
    const techEntries = entries.filter(e => e.tech_id === techId);
    const totalHours = techEntries.reduce((sum, e) => sum + calcHours(e.start_time, e.end_time), 0);

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

    let regularHours = 0;
    let overtimeHours = 0;
    let sundayHours = 0;
    weeklyData.forEach(w => {
      if (w.weekdayHours <= OT_THRESHOLD) { regularHours += w.weekdayHours; }
      else { regularHours += OT_THRESHOLD; overtimeHours += w.weekdayHours - OT_THRESHOLD; }
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

  // ===== Admin Edit =====
  function openEdit(entry: TimeEntry) {
    setEditEntry(entry);
    const st = new Date(entry.start_time);
    const en = entry.end_time ? new Date(entry.end_time) : null;
    // Format to SAST for the input fields
    const toSASTDate = (d: Date) => {
      const parts = d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
      return parts;
    };
    const toSASTTime = (d: Date) => {
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
    };
    setEditStartDate(toSASTDate(st));
    setEditStart(toSASTTime(st));
    setEditEndDate(en ? toSASTDate(en) : '');
    setEditEnd(en ? toSASTTime(en) : '');
    setEditNotes(entry.notes || '');
  }

  async function saveEdit() {
    if (!editEntry) return;
    setSaving(true);
    const startIso = toSASTIso(editStartDate, editStart);
    const endIso = editEndDate && editEnd ? toSASTIso(editEndDate, editEnd) : null;

    // Recalculate distance if both GPS points exist
    const updates: any = {
      start_time: startIso,
      end_time: endIso,
      notes: editNotes,
    };

    const { error } = await supabase
      .from('time_entries')
      .update(updates)
      .eq('id', editEntry.id);

    if (error) {
      alert('Failed to save: ' + error.message);
    } else {
      setEditEntry(null);
      await loadData();
    }
    setSaving(false);
  }

  async function deleteEntry(id: number) {
    const { error } = await supabase.from('time_entries').delete().eq('id', id);
    if (error) {
      alert('Failed to delete: ' + error.message);
    } else {
      setDeleteConfirm(null);
      await loadData();
    }
  }

  // ===== Export (branded PDF — one technician per page: summary then detail) =====
  function exportReport() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PW = 297, PH = 210, M = 10;

    const BRAND: [number, number, number] = [5, 13, 17];
    const ORANGE: [number, number, number] = [242, 124, 34];
    const RED: [number, number, number] = [220, 38, 38];
    const AMBER: [number, number, number] = [217, 119, 6];
    const GREEN: [number, number, number] = [22, 163, 74];
    const BLUE: [number, number, number] = [37, 99, 235];
    const GREY: [number, number, number] = [115, 115, 115];
    const LINE: [number, number, number] = [225, 225, 225];
    const INK: [number, number, number] = [30, 30, 30];

    const SHORT_WEEK = 40; // weeks under this many hours are flagged

    // This report always covers every team member, regardless of the on-screen filter.
    const exportTechs = techs;
    const rows = exportTechs.map(t => ({ t, d: getTechData(t.id) }));

    let gReg = 0, gOT = 0, gSun = 0, gPay = 0;
    rows.forEach(({ t, d }) => {
      const rate = Number(t.hourly_rate) || 0;
      gReg += d.regularHours;
      gOT += d.overtimeHours;
      gSun += d.sundayHours;
      gPay += d.regularHours * rate + d.overtimeHours * rate * 1.5 + d.sundayHours * rate * 2;
    });

    const generated = new Date().toLocaleString('en-ZA', { timeZone: TZ });

    // A week clipped by the start or end of the month is always short, so it is
    // reported but never highlighted.
    function isPartialWeek(i: number) {
      return (weeks[i].endDay - weeks[i].startDay + 1) < 7;
    }

    function footer() {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.3);
      doc.line(M, PH - 14, PW - M, PH - 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...BRAND);
      doc.text('Powered by Sequoia Grove / \u00A9 2026 Sequoia Quality Solutions\u2122', M, PH - 9.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GREY);
      doc.text('Field Service Time Tracker\u2122', M, PH - 5.5);
      doc.text(`Generated ${generated} (SAST)`, PW - M, PH - 9.5, { align: 'right' });
    }

    function header() {
      doc.setFillColor(...BRAND);
      doc.rect(0, 0, PW, 17, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('SPCS  |  Pay Report', M, 11);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...ORANGE);
      doc.text(`${monthNames[month]} ${year}   \u2022   All Team Members`, PW - M, 11, { align: 'right' });
      return 17;
    }

    function kpis(y: number) {
      const gap = 4;
      const w = (PW - 2 * M - 3 * gap) / 4;
      const h = 19;
      const cards: [string, string, [number, number, number]][] = [
        ['Regular Hours', gReg.toFixed(1), GREEN],
        ['Overtime Hours (1.5x)', gOT.toFixed(1), gOT > 0 ? RED : INK],
        ['Sunday Hours (2x)', gSun.toFixed(1), gSun > 0 ? AMBER : INK],
        ['Total Payroll', `R${gPay.toFixed(2)}`, INK],
      ];
      cards.forEach((c, i) => {
        const x = M + i * (w + gap);
        doc.setFillColor(245, 246, 247);
        doc.setDrawColor(...LINE);
        doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...GREY);
        doc.text(c[0], x + 3, y + 6);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(...c[2]);
        doc.text(c[1], x + 3, y + 15);
      });
      return h;
    }

    // A tech block: name / email / rate, total pay, flag badges, weekly table
    function techBlock(t: Profile, d: ReturnType<typeof getTechData>, y: number) {
      const rate = Number(t.hourly_rate) || 0;
      const regPay = d.regularHours * rate;
      const otPay = d.overtimeHours * rate * 1.5;
      const sunPay = d.sundayHours * rate * 2;
      const totalPay = regPay + otPay + sunPay;
      const flagged = d.overtimeHours > 0 || d.sundayHours > 0;

      const cols = [50, 34, 34, 34, 40, 45, 40];
      const rowH = 5.6;
      const bodyRows = d.weeklyData.length;
      const blockH = 13 + rowH * (bodyRows + 2) + 4;

      // card
      doc.setFillColor(flagged ? 253 : 250, flagged ? 242 : 250, flagged ? 242 : 251);
      doc.setDrawColor(flagged ? 240 : 225, flagged ? 200 : 225, flagged ? 200 : 225);
      doc.roundedRect(M, y, PW - 2 * M, blockH, 1.5, 1.5, 'FD');

      // name + email/rate
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...INK);
      doc.text(t.name, M + 4, y + 6.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...GREY);
      doc.text(`${t.email}  \u2022  R${rate.toFixed(2)}/hr`, M + 4, y + 11);

      // total pay
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...INK);
      doc.text(`R${totalPay.toFixed(2)}`, PW - M - 4, y + 6.5, { align: 'right' });

      // badges (right aligned, same set as on screen)
      const badges: [string, [number, number, number]][] = [];
      if (d.overtimeHours > 0) badges.push([`OT 1.5x: +R${otPay.toFixed(2)}`, RED]);
      if (d.sundayHours > 0) badges.push([`Sun 2x: +R${sunPay.toFixed(2)}`, AMBER]);
      if (d.gpsFlags > 0) badges.push([`${d.gpsFlags} GPS missing`, AMBER]);
      if (d.distanceFlags > 0) badges.push([`${d.distanceFlags} distance > 1km`, RED]);
      if (d.shortVisitFlags > 0) badges.push([`${d.shortVisitFlags} short visit${d.shortVisitFlags > 1 ? 's' : ''}`, RED]);

      let bx = PW - M - 4;
      doc.setFontSize(6.5);
      // drawn right-to-left so the on-screen left-to-right order is preserved
      [...badges].reverse().forEach(([label, colour]) => {
        const w = doc.getTextWidth(label) + 4;
        if (bx - w < M + 90) return; // never overlap the name block
        doc.setFillColor(...colour);
        doc.roundedRect(bx - w, y + 8.2, w, 4.4, 1, 1, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text(label, bx - w + 2, y + 11.35);
        bx -= w + 2;
      });

      // table
      let ty = y + 14;
      const headers = ['Week', 'Total', 'Regular', 'OT (1.5x)', 'Sunday (2x)', 'Status', '<40 hours'];
      doc.setFillColor(238, 239, 241);
      doc.rect(M + 3, ty, PW - 2 * M - 6, rowH, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...GREY);
      let cx = M + 5;
      headers.forEach((h, i) => { doc.text(h, cx, ty + 3.9); cx += cols[i]; });
      ty += rowH;

      d.weeklyData.forEach((w, i) => {
        const reg = Math.min(w.weekdayHours, OT_THRESHOLD);
        const ot = Math.max(0, w.weekdayHours - OT_THRESHOLD);
        const hasFlags = ot > 0 || w.sundayHours > 0;
        const status = [
          ot > 0 ? 'OT' : '',
          w.sundayHours > 0 ? 'Sun' : '',
          ot === 0 && w.sundayHours === 0 && w.totalHours > 0 ? 'OK' : '',
          w.totalHours === 0 ? '\u2014' : '',
        ].filter(Boolean).join('  ');

        const partial = isPartialWeek(i);
        const isShort = w.totalHours > 0 && w.totalHours < SHORT_WEEK;
        const shortText = w.totalHours === 0 ? '\u2014' : (isShort ? 'Yes' : 'No');
        // Highlighted only for genuine short weeks — a week clipped by the month is not news.
        const highlightShort = isShort && !partial;

        const cells = [
          weeks[i].label,
          `${w.totalHours.toFixed(1)}h`,
          `${reg.toFixed(1)}h`,
          ot > 0 ? `+${ot.toFixed(1)}h` : '\u2014',
          w.sundayHours > 0 ? `${w.sundayHours.toFixed(1)}h` : '\u2014',
          status,
          shortText,
        ];
        doc.setFontSize(7.5);
        cx = M + 5;
        cells.forEach((c, ci) => {
          if (hasFlags) doc.setTextColor(...RED);
          else doc.setTextColor(...INK);
          if (ci === 4 && w.sundayHours > 0) doc.setTextColor(...AMBER);
          let weight = ci === 1 ? 'bold' : 'normal';
          if (ci === 6) {
            if (highlightShort) { doc.setTextColor(...BLUE); weight = 'bold'; }
            else { doc.setTextColor(...(isShort ? GREY : INK)); weight = 'normal'; }
          }
          doc.setFont('helvetica', weight);
          doc.text(c, cx, ty + 3.9);
          cx += cols[ci];
        });
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.15);
        doc.line(M + 3, ty + rowH, PW - M - 3, ty + rowH);
        ty += rowH;
      });

      // TOTAL row
      doc.setFillColor(...BRAND);
      doc.rect(M + 3, ty, PW - 2 * M - 6, rowH, 'F');
      const shortWeekCount = d.weeklyData.filter((w, i) =>
        w.totalHours > 0 && w.totalHours < SHORT_WEEK && !isPartialWeek(i)
      ).length;
      const totals = [
        'TOTAL',
        `${d.totalHours.toFixed(1)}h`,
        `${d.regularHours.toFixed(1)}h`,
        d.overtimeHours > 0 ? `+${d.overtimeHours.toFixed(1)}h` : '\u2014',
        d.sundayHours > 0 ? `${d.sundayHours.toFixed(1)}h` : '\u2014',
        `R${totalPay.toFixed(2)}`,
        shortWeekCount > 0 ? `${shortWeekCount} short` : '\u2014',
      ];
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      cx = M + 5;
      totals.forEach((c, ci) => {
        if (ci === 3 && d.overtimeHours > 0) doc.setTextColor(255, 150, 150);
        else if (ci === 4 && d.sundayHours > 0) doc.setTextColor(255, 205, 120);
        else if (ci === 6 && shortWeekCount > 0) doc.setTextColor(150, 200, 255);
        else doc.setTextColor(255, 255, 255);
        doc.text(c, cx, ty + 3.9);
        cx += cols[ci];
      });

      return blockH;
    }

    // ===== Detail: every time entry for the month, mirroring the on-screen table =====
    const D_COLS = [22, 12, 52, 30, 14, 14, 14, 75, 44];
    const D_HEADERS = ['Date', 'Day', 'Client', 'Activity', 'In', 'Out', 'Hours', 'Notes', 'Flags'];
    const D_ROWH = 4.6;
    const BOTTOM = PH - 18;

    function detailHeaderRow(y: number) {
      doc.setFillColor(238, 239, 241);
      doc.rect(M, y, PW - 2 * M, D_ROWH, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(...GREY);
      let cx = M + 2;
      D_HEADERS.forEach((h, i) => { doc.text(h, cx, y + 3.2); cx += D_COLS[i]; });
      return y + D_ROWH;
    }

    function continuedBanner(t: Profile, y: number) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text(`${t.name}`, M, y + 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...GREY);
      doc.text('time entry detail (continued)', M + doc.getTextWidth(`${t.name}`) + 26, y + 4);
      return y + 7;
    }

    function fit(text: string, width: number) {
      let s = text;
      if (doc.getTextWidth(s) <= width) return s;
      while (s.length > 1 && doc.getTextWidth(s + '\u2026') > width) s = s.slice(0, -1);
      return s + '\u2026';
    }

    function detailTable(t: Profile, d: ReturnType<typeof getTechData>, startY: number) {
      if (d.techEntries.length === 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...GREY);
        doc.text('No time entries for this month.', M, startY + 4);
        return;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...INK);
      doc.text(`Time entry detail \u2014 ${d.techEntries.length} entr${d.techEntries.length === 1 ? 'y' : 'ies'}`, M, startY + 3);
      let y = detailHeaderRow(startY + 5.5);

      d.techEntries.forEach(entry => {
        if (y + D_ROWH > BOTTOM) {
          doc.addPage();
          const hy = header();
          footer();
          y = detailHeaderRow(continuedBanner(t, hy + 5) + 1.5);
        }

        const hrs = calcHours(entry.start_time, entry.end_time);
        const durMin = entry.end_time
          ? (new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 60000
          : 999;
        const isEntryInternal = (entry.clients as any)?.service_type === 'INTERNAL';
        const isSun = isSunday(entry.start_time);

        const flags: [string, [number, number, number]][] = [];
        if (!isEntryInternal && (entry.start_lat == null || entry.stop_lat == null)) flags.push(['No GPS', AMBER]);
        if (!isEntryInternal && entry.distance_km != null && entry.distance_km > 1) flags.push([`${entry.distance_km.toFixed(1)}km`, RED]);
        if (durMin < 10) flags.push([`${Math.round(durMin)}min`, RED]);
        if (isSun) flags.push(['Sun 2x', AMBER]);

        if (isSun) {
          doc.setFillColor(255, 248, 235);
          doc.rect(M, y, PW - 2 * M, D_ROWH, 'F');
        }

        const activity = isEntryInternal
          ? ((entry.clients as any)?.name || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/gu, '')
          : '\u2014';
        const cells = [
          fmtDate(entry.start_time),
          fmtDay(entry.start_time),
          isEntryInternal ? '\u2014' : ((entry.clients as any)?.name || '\u2014'),
          activity,
          fmtTime(entry.start_time),
          entry.end_time ? fmtTime(entry.end_time) : '\u2014',
          `${hrs.toFixed(1)}h`,
          entry.notes || 'No notes',
        ];

        doc.setFontSize(6.5);
        let cx = M + 2;
        cells.forEach((c, ci) => {
          doc.setFont('helvetica', ci === 1 && isSun ? 'bold' : 'normal');
          if (ci === 1 && isSun) doc.setTextColor(...AMBER);
          else if (ci === 3 && isEntryInternal) doc.setTextColor(...AMBER);
          else if (ci === 7 && !entry.notes) doc.setTextColor(180, 180, 180);
          else doc.setTextColor(...INK);
          doc.text(fit(String(c), D_COLS[ci] - 3), cx, y + 3.2);
          cx += D_COLS[ci];
        });

        // flags cell
        if (flags.length === 0) {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...GREEN);
          doc.text('OK', cx, y + 3.2);
        } else {
          let fx = cx;
          doc.setFont('helvetica', 'bold');
          flags.forEach(([label, colour]) => {
            const w = doc.getTextWidth(label);
            if (fx + w > PW - M - 1) return;
            doc.setTextColor(...colour);
            doc.text(label, fx, y + 3.2);
            fx += w + 3;
          });
        }

        doc.setDrawColor(240, 240, 240);
        doc.setLineWidth(0.1);
        doc.line(M, y + D_ROWH, PW - M, y + D_ROWH);
        y += D_ROWH;
      });
    }

    // One technician per page: summary block, then their detail. Next tech starts a fresh page.
    if (rows.length === 0) {
      header();
      footer();
    }
    rows.forEach(({ t, d }, i) => {
      if (i > 0) doc.addPage();
      const hy = header();
      footer();
      let y = hy + 5;
      if (i === 0) y += kpis(y) + 5; // KPI cards head the report once
      y += techBlock(t, d, y) + 5;
      detailTable(t, d, y);
    });

    doc.save(`SPCS-Pay-Report-${monthNames[month]}-${year}.pdf`);
  }

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Filter techs for display
  const displayTechs = selectedTech === 'all' ? techs : techs.filter(t => t.id === selectedTech);

  // Grand totals (of displayed techs)
  let grandRegular = 0, grandOT = 0, grandSunday = 0, grandPay = 0;
  displayTechs.forEach(t => {
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
        <div className="flex gap-2 flex-wrap">
          <select className="select select-bordered select-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {monthNames.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select className="select select-bordered select-sm" value={year} onChange={e => setYear(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="select select-bordered select-sm" value={selectedTech} onChange={e => setSelectedTech(e.target.value)}>
            <option value="all">All Team Members</option>
            {techs.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role === 'team_leader' ? 'TL' : 'Tech'})</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={exportReport}>
            <Download size={14} /> Export PDF
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
      {displayTechs.map(t => {
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
                      const reg = Math.min(w.weekdayHours, OT_THRESHOLD);
                      const ot = Math.max(0, w.weekdayHours - OT_THRESHOLD);
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

              {/* Detailed entries with notes + edit */}
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
                          <th>Actions</th>
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
                          return (
                            <tr key={entry.id} className={isSun ? 'bg-warning/10' : ''}>
                              <td className="whitespace-nowrap">{fmtDate(entry.start_time)}</td>
                              <td className={isSun ? 'text-warning font-bold' : ''}>{fmtDay(entry.start_time)}</td>
                              <td>{isEntryInternal ? '—' : ((entry.clients as any)?.name || '—')}</td>
                              <td className="text-amber-500 font-medium">{isEntryInternal ? ((entry.clients as any)?.name || '').replace(/[📋🔧🚗📚]\s*/g, '') : '—'}</td>
                              <td className="whitespace-nowrap">{fmtTime(entry.start_time)}</td>
                              <td className="whitespace-nowrap">{entry.end_time ? fmtTime(entry.end_time) : '—'}</td>
                              <td>{hrs.toFixed(1)}h</td>
                              <td className="text-xs text-base-content/70 max-w-[200px]">{entry.notes || <span className="text-base-content/30 italic">No notes</span>}</td>
                              <td>{flags.length > 0 ? flags.join(' ') : '✅'}</td>
                              <td className="flex gap-1">
                                <button className="btn btn-ghost btn-xs text-info" onClick={() => openEdit(entry)} title="Edit entry">
                                  <Pencil size={12} />
                                </button>
                                {deleteConfirm === entry.id ? (
                                  <div className="flex gap-1">
                                    <button className="btn btn-error btn-xs" onClick={() => deleteEntry(entry.id)}>Yes</button>
                                    <button className="btn btn-ghost btn-xs" onClick={() => setDeleteConfirm(null)}>No</button>
                                  </div>
                                ) : (
                                  <button className="btn btn-ghost btn-xs text-error" onClick={() => setDeleteConfirm(entry.id)} title="Delete entry">
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </td>
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

      {displayTechs.length === 0 && (
        <div className="text-center py-12 text-base-content/50">
          <Calendar size={48} className="mx-auto mb-3 opacity-30" />
          <p>No technicians found. Add techs in the Technicians page first.</p>
        </div>
      )}

      {/* Edit Modal */}
      {editEntry && (
        <div className="modal modal-open">
          <div className="modal-box">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg">✏️ Edit Time Entry</h3>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setEditEntry(null)}><X size={18} /></button>
            </div>
            <div className="text-sm mb-3 text-base-content/70">
              <strong>{(editEntry.profiles as any)?.name}</strong> — {(editEntry.clients as any)?.name || 'Unknown client'}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">Start Date</label>
                <input type="date" className="input input-bordered input-sm w-full" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Start Time</label>
                <input type="time" className="input input-bordered input-sm w-full" value={editStart} onChange={e => setEditStart(e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">End Date</label>
                <input type="date" className="input input-bordered input-sm w-full" value={editEndDate} onChange={e => setEditEndDate(e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">End Time</label>
                <input type="time" className="input input-bordered input-sm w-full" value={editEnd} onChange={e => setEditEnd(e.target.value)} />
              </div>
            </div>
            <div className="mt-3">
              <label className="label text-xs">Notes</label>
              <textarea className="textarea textarea-bordered w-full" rows={3} value={editNotes} onChange={e => setEditNotes(e.target.value)} />
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" onClick={() => setEditEntry(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving}>
                <Save size={14} /> {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setEditEntry(null)} />
        </div>
      )}
    </div>
  );
};
