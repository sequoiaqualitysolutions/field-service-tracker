export function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

export function getWeeksInMonth(year: number, month: number) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = [];
  let startDay = 1;
  let week = 1;
  while (startDay <= daysInMonth) {
    const endDay = Math.min(startDay + 6, daysInMonth);
    weeks.push({ week, startDay, endDay, label: `Wk ${week} (${startDay}-${endDay})` });
    startDay = endDay + 1;
    week++;
  }
  return weeks;
}
