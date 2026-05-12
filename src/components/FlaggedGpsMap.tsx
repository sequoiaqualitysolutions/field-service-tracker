import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { TimeEntry } from '../types';
import { MapPin, Calendar, AlertTriangle } from 'lucide-react';

interface FlaggedEntry {
  id: number;
  techName: string;
  clientName: string;
  date: string;
  dateObj: Date;
  reason: string;
  distance?: number;
  startLat: number | null;
  startLng: number | null;
  stopLat: number | null;
  stopLng: number | null;
  startTime: string;
  endTime: string | null;
  durationMin: number;
}

interface FlaggedGpsMapProps {
  entries: TimeEntry[];
  selectedTech: string;
}

type Period = 'today' | 'week' | 'month';

export const FlaggedGpsMap: React.FC<FlaggedGpsMapProps> = ({ entries, selectedTech }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const [selectedPin, setSelectedPin] = useState<FlaggedEntry | null>(null);

  // Build flagged entries from all entries
  const allFlagged: FlaggedEntry[] = [];
  entries.forEach(e => {
    // Skip internal activities
    if ((e.clients as any)?.service_type === 'INTERNAL') return;
    if (!e.end_time) return;

    const techName = (e.profiles as any)?.name || 'Unknown';
    const clientName = (e.clients as any)?.name || 'Unknown';
    const dateObj = new Date(e.start_time);
    const date = dateObj.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' });
    const startTime = dateObj.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });
    const endTime = e.end_time ? new Date(e.end_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' }) : null;
    const durationMin = e.end_time ? Math.round((new Date(e.end_time).getTime() - dateObj.getTime()) / 60000) : 0;
    const hours = durationMin / 60;

    const base = {
      id: e.id, techName, clientName, date, dateObj, startTime, endTime, durationMin,
      startLat: e.start_lat, startLng: e.start_lng, stopLat: e.stop_lat, stopLng: e.stop_lng,
    };

    let flagged = false;

    // Distance flag
    if (e.distance_km != null && e.distance_km > 1) {
      allFlagged.push({ ...base, reason: 'Distance > 1 km', distance: e.distance_km });
      flagged = true;
    }

    // Missing GPS flag
    if (e.start_lat == null || e.start_lng == null || e.stop_lat == null || e.stop_lng == null) {
      if (!flagged) {
        allFlagged.push({ ...base, reason: 'Missing GPS' });
        flagged = true;
      }
    }

    // Short visit flag
    if (hours < (10 / 60)) {
      allFlagged.push({ ...base, reason: `Short visit: ${durationMin} min` });
    }
  });

  // Filter by tech
  const techFiltered = selectedTech === 'all'
    ? allFlagged
    : allFlagged.filter(f => {
        const matchEntry = entries.find(e => e.id === f.id);
        return matchEntry && matchEntry.tech_id === selectedTech;
      });

  // Filter by period
  const now = new Date();
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }));
  today.setHours(0, 0, 0, 0);

  const getWeekStart = () => {
    const d = new Date(today);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday start
    d.setDate(d.getDate() - diff);
    return d;
  };

  const filteredFlags = techFiltered.filter(f => {
    // Create a SAST-adjusted date for comparison
    const entryDate = new Date(f.dateObj.toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }));
    entryDate.setHours(0, 0, 0, 0);

    if (period === 'today') {
      return entryDate.getTime() === today.getTime();
    } else if (period === 'week') {
      const weekStart = getWeekStart();
      return entryDate >= weekStart && entryDate <= today;
    }
    return true; // month — already filtered by dashboard month/year
  });

  // Split into mappable (has GPS) and non-mappable
  const mappableFlags = filteredFlags.filter(f => f.startLat != null && f.startLng != null);
  const noGpsFlags = filteredFlags.filter(f => f.startLat == null || f.startLng == null);

  // Render map
  useEffect(() => {
    if (!mapRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    if (mappableFlags.length === 0) return;

    // Center on first pin
    const center = { lat: mappableFlags[0].startLat!, lng: mappableFlags[0].startLng! };
    const map = L.map(mapRef.current).setView([center.lat, center.lng], 10);
    mapInstanceRef.current = map;

    // Satellite tile layer
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles &copy; Esri', maxZoom: 19 }
    ).addTo(map);

    // Label overlay
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19 }
    ).addTo(map);

    const bounds: L.LatLngExpression[] = [];

    // Color-coded icons by flag type
    const getIcon = (reason: string) => {
      let color = '#ef4444'; // red for distance
      let emoji = '🔴';
      if (reason === 'Missing GPS') {
        color = '#eab308'; emoji = '🟡';
      } else if (reason.startsWith('Short')) {
        color = '#f97316'; emoji = '⏱️';
      }
      return L.divIcon({
        html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 8px rgba(0,0,0,0.5);cursor:pointer"></div>`,
        iconSize: [18, 18], iconAnchor: [9, 9], className: '',
      });
    };

    mappableFlags.forEach(flag => {
      const lat = flag.startLat!;
      const lng = flag.startLng!;
      bounds.push([lat, lng]);

      const durationStr = flag.durationMin >= 60
        ? `${Math.floor(flag.durationMin / 60)}h ${flag.durationMin % 60}m`
        : `${flag.durationMin}m`;

      const reasonIcon = flag.reason === 'Missing GPS' ? '🟡' : flag.reason.startsWith('Short') ? '⏱️' : '🔴';

      const popupContent = `
        <div style="font-family:Montserrat,sans-serif;font-size:12px;min-width:200px;line-height:1.5">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px">${flag.techName}</div>
          <div style="color:#666;margin-bottom:6px">${flag.clientName}</div>
          <div style="background:#fee2e2;border-radius:6px;padding:6px 8px;margin-bottom:6px">
            <span style="font-weight:600">${reasonIcon} ${flag.reason}</span>
            ${flag.distance ? `<br/><span style="font-size:11px">Distance: ${flag.distance.toFixed(2)} km</span>` : ''}
          </div>
          <div style="font-size:11px;color:#888">
            📅 ${flag.date}<br/>
            🕐 ${flag.startTime}${flag.endTime ? ` → ${flag.endTime}` : ''} (${durationStr})<br/>
            📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}
          </div>
          ${flag.stopLat != null && flag.stopLng != null && flag.reason.includes('Distance') ? `
            <div style="font-size:11px;color:#888;margin-top:4px">
              📍 Clock-out: ${flag.stopLat.toFixed(5)}, ${flag.stopLng.toFixed(5)}
            </div>
          ` : ''}
        </div>
      `;

      L.marker([lat, lng], { icon: getIcon(flag.reason) })
        .addTo(map)
        .bindPopup(popupContent, { maxWidth: 280 });

      // If distance flag, also show clock-out pin and draw a line
      if (flag.reason.includes('Distance') && flag.stopLat != null && flag.stopLng != null) {
        bounds.push([flag.stopLat, flag.stopLng]);

        const stopIcon = L.divIcon({
          html: '<div style="background:#dc2626;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 0 6px rgba(0,0,0,0.4);opacity:0.7"></div>',
          iconSize: [14, 14], iconAnchor: [7, 7], className: '',
        });

        L.marker([flag.stopLat, flag.stopLng], { icon: stopIcon })
          .addTo(map)
          .bindPopup(`<div style="font-family:Montserrat,sans-serif;font-size:12px"><b>Clock-out location</b><br/>${flag.techName} — ${flag.clientName}<br/>${flag.distance?.toFixed(2)} km from clock-in</div>`);

        // Draw dashed line between clock-in and clock-out
        L.polyline([[lat, lng], [flag.stopLat, flag.stopLng]], {
          color: '#ef4444',
          weight: 2,
          dashArray: '6, 6',
          opacity: 0.7,
        }).addTo(map);
      }
    });

    if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
    } else if (bounds.length === 1) {
      map.setView(bounds[0] as [number, number], 14);
    }

    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [mappableFlags.map(f => f.id + f.reason).join(','), period]);

  return (
    <div className="card bg-base-200 border border-error/20">
      <div className="card-body p-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-sm text-error flex items-center gap-2">
            <MapPin size={16} /> 📍 Flagged GPS Map — Exception Audit
          </h3>
          <div className="flex gap-1">
            {(['today', 'week', 'month'] as Period[]).map(p => (
              <button
                key={p}
                className={`btn btn-xs ${period === p ? 'btn-error' : 'btn-ghost'}`}
                onClick={() => setPeriod(p)}
              >
                <Calendar size={12} />
                {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
          </div>
        </div>

        {/* Summary badges */}
        <div className="flex gap-2 flex-wrap mt-1">
          <span className="badge badge-error badge-sm gap-1">
            🔴 Distance: {filteredFlags.filter(f => f.reason.includes('Distance')).length}
          </span>
          <span className="badge badge-warning badge-sm gap-1">
            ⏱️ Short visit: {filteredFlags.filter(f => f.reason.startsWith('Short')).length}
          </span>
          <span className="badge badge-sm gap-1" style={{ backgroundColor: '#eab308', color: '#000' }}>
            🟡 No GPS: {noGpsFlags.length}
          </span>
          <span className="badge badge-ghost badge-sm">
            Total flags: {filteredFlags.length}
          </span>
        </div>

        {/* Map */}
        {mappableFlags.length > 0 ? (
          <div ref={mapRef} style={{ height: '380px' }} className="rounded-lg mt-2 border border-base-300" />
        ) : (
          <div className="bg-base-300 rounded-lg flex flex-col items-center justify-center text-base-content/40 text-sm mt-2" style={{ height: '200px' }}>
            <MapPin size={32} className="mb-2 opacity-30" />
            {filteredFlags.length > 0
              ? 'All flagged entries have no GPS data — see table below'
              : `No flagged entries for ${period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'}`
            }
          </div>
        )}

        {/* Legend */}
        {mappableFlags.length > 0 && (
          <div className="flex gap-4 mt-1 text-xs text-base-content/50">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-red-500 border-2 border-white inline-block" /> Distance flag
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-orange-500 border-2 border-white inline-block" /> Short visit
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-yellow-500 border-2 border-white inline-block" /> No GPS
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block border-t-2 border-dashed border-red-500 w-4" /> Clock-in → Clock-out drift
            </span>
          </div>
        )}

        {/* No GPS entries table */}
        {noGpsFlags.length > 0 && (
          <div className="mt-3">
            <h4 className="text-xs font-semibold text-warning mb-1 flex items-center gap-1">
              <AlertTriangle size={12} /> Entries Without GPS (cannot plot on map)
            </h4>
            <div className="overflow-x-auto">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>Technician</th>
                    <th>Client</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Duration</th>
                    <th>Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {noGpsFlags.map((f, i) => {
                    const durationStr = f.durationMin >= 60
                      ? `${Math.floor(f.durationMin / 60)}h ${f.durationMin % 60}m`
                      : `${f.durationMin}m`;
                    return (
                      <tr key={`${f.id}-${i}`} className="text-warning">
                        <td className="font-semibold">{f.techName}</td>
                        <td>{f.clientName}</td>
                        <td>{f.date}</td>
                        <td className="text-xs">{f.startTime}{f.endTime ? ` → ${f.endTime}` : ''}</td>
                        <td>{durationStr}</td>
                        <td>🟡 {f.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
