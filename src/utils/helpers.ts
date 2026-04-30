export function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

export const SAST = 'Africa/Johannesburg';

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: SAST });
}

export function formatDateSAST(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { timeZone: SAST });
}

export function formatDaySAST(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: SAST });
}

export function calcHours(start: string, end: string | null): number {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  return (e - s) / 3600000;
}

export function getCurrentGps(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

export function calcDistanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function getWeeksInMonth(year: number, month: number) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: { week: number; startDay: number; endDay: number; label: string }[] = [];

  // First day of the month — what day of week is it? (0=Sun,1=Mon,...,6=Sat)
  const firstDow = new Date(year, month, 1).getDay();

  // Week 1: starts on the 1st, ends on the first Sunday
  // If the 1st is already a Sunday (0), week 1 is just day 1
  // If the 1st is Monday (1), week 1 is days 1-7 (Mon-Sun)
  let firstSunday: number;
  if (firstDow === 0) {
    // 1st is Sunday — week 1 is just that day
    firstSunday = 1;
  } else {
    // Days until Sunday: 7 - firstDow
    firstSunday = 1 + (7 - firstDow);
  }

  let week = 1;
  const endOfWeek1 = Math.min(firstSunday, daysInMonth);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mon = monthNames[month];

  weeks.push({ week, startDay: 1, endDay: endOfWeek1, label: `Wk ${week} (${mon} ${1}-${endOfWeek1})` });

  // Remaining weeks: Monday to Sunday
  let startDay = endOfWeek1 + 1;
  week++;
  while (startDay <= daysInMonth) {
    const endDay = Math.min(startDay + 6, daysInMonth);
    weeks.push({ week, startDay, endDay, label: `Wk ${week} (${mon} ${startDay}-${endDay})` });
    startDay = endDay + 1;
    week++;
  }
  return weeks;
}
