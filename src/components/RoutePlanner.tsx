import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  MapPin,
  Route,
  Clock,
  ArrowRight,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  Plus,
  Trash2,
  Navigation,
  Building2,
  TrendingDown,
  CalendarDays,
  Truck,
} from 'lucide-react';
import { Profile, Client, CalendarEvent } from '../types';
import { supabase } from '../lib/supabase';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface GeocodedStop {
  client: Client;
  lat: number;
  lng: number;
  address: string;
  fromCalendar: boolean;
}

interface RouteResult {
  originalOrder: GeocodedStop[];
  optimizedOrder: GeocodedStop[];
  originalDuration: number; // minutes
  optimizedDuration: number;
  originalDistance: number; // km
  optimizedDistance: number;
  legs: { from: string; to: string; duration: number; distance: number }[];
}

interface UserOption {
  id: string;
  name: string;
  role: string;
  google_calendar_id: string | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const OFFICE_ADDRESS = '8 Derrick Road, Spartan, Kempton Park, 1619, Gauteng, South Africa';
const OFFICE_COORDS = { lat: -26.1287, lng: 28.2298 }; // Approximate — geocoded on first use
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

/* ------------------------------------------------------------------ */
/*  Google Maps loader                                                 */
/* ------------------------------------------------------------------ */
let mapsLoaded = false;
let mapsLoadPromise: Promise<void> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (mapsLoaded && (window as any).google?.maps) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;

  mapsLoadPromise = new Promise((resolve, reject) => {
    if ((window as any).google?.maps) {
      mapsLoaded = true;
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=geometry,places`;
    script.async = true;
    script.defer = true;
    script.onload = () => { mapsLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
  return mapsLoadPromise;
}

/* ------------------------------------------------------------------ */
/*  Geocoding cache (persists in session)                              */
/* ------------------------------------------------------------------ */
const geocodeCache: Record<string, { lat: number; lng: number }> = {};

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const clean = address.replace(/\n/g, ', ').replace(/\s+/g, ' ').trim();
  if (geocodeCache[clean]) return geocodeCache[clean];

  const geocoder = new google.maps.Geocoder();
  try {
    const result = await geocoder.geocode({ address: clean + ', South Africa' });
    if (result.results.length > 0) {
      const loc = result.results[0].geometry.location;
      const coords = { lat: loc.lat(), lng: loc.lng() };
      geocodeCache[clean] = coords;
      return coords;
    }
  } catch (e) {
    console.warn('Geocode failed for:', clean, e);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Distance Matrix helper                                             */
/* ------------------------------------------------------------------ */
async function getDistanceMatrix(
  origins: google.maps.LatLng[],
  destinations: google.maps.LatLng[],
): Promise<google.maps.DistanceMatrixResponse> {
  const service = new google.maps.DistanceMatrixService();
  return new Promise((resolve, reject) => {
    service.getDistanceMatrix(
      {
        origins,
        destinations,
        travelMode: google.maps.TravelMode.DRIVING,
        drivingOptions: {
          departureTime: new Date(),
          trafficModel: google.maps.TrafficModel.BEST_GUESS,
        },
        unitSystem: google.maps.UnitSystem.METRIC,
      },
      (response: google.maps.DistanceMatrixResponse | null, status: string) => {
        if (status === 'OK' && response) resolve(response);
        else reject(new Error(`Distance Matrix failed: ${status}`));
      },
    );
  });
}

/* ------------------------------------------------------------------ */
/*  TSP solver — nearest-neighbor with 2-opt improvement               */
/* ------------------------------------------------------------------ */
function solveTSP(distMatrix: number[][]): number[] {
  const n = distMatrix.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);

  // Nearest-neighbor starting from depot (index 0)
  const visited = new Set<number>([0]);
  const route = [0];
  let current = 0;

  while (visited.size < n) {
    let nearest = -1;
    let nearestDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited.has(j) && distMatrix[current][j] < nearestDist) {
        nearestDist = distMatrix[current][j];
        nearest = j;
      }
    }
    if (nearest === -1) break;
    visited.add(nearest);
    route.push(nearest);
    current = nearest;
  }

  // 2-opt improvement (skip depot at index 0)
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const before =
          distMatrix[route[i - 1]][route[i]] + distMatrix[route[j]][route[(j + 1) % route.length] || 0];
        const after =
          distMatrix[route[i - 1]][route[j]] + distMatrix[route[i]][route[(j + 1) % route.length] || 0];
        if (after < before) {
          // Reverse the segment
          const segment = route.splice(i, j - i + 1);
          segment.reverse();
          route.splice(i, 0, ...segment);
          improved = true;
        }
      }
    }
  }

  return route;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
interface RoutePlannerProps {
  profile: Profile;
}

export function RoutePlanner({ profile }: RoutePlannerProps) {
  const isAdmin = profile.role === 'admin';
  const isTeamLeader = profile.role === 'team_leader';

  /* State */
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(profile.id);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1); // default to tomorrow
    return d.toISOString().split('T')[0];
  });
  const [assignedClients, setAssignedClients] = useState<Client[]>([]);
  const [stops, setStops] = useState<Client[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RouteResult | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [officeCoords, setOfficeCoords] = useState(OFFICE_COORDS);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  /* Load Google Maps on mount */
  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) {
      setError('Google Maps API key not configured. Contact your administrator.');
      return;
    }
    loadGoogleMaps()
      .then(async () => {
        setMapsReady(true);
        // Geocode office address
        const coords = await geocodeAddress(OFFICE_ADDRESS);
        if (coords) setOfficeCoords(coords);
      })
      .catch(() => setError('Failed to load Google Maps. Check your internet connection.'));
  }, []);

  /* Load users (admin sees all) */
  useEffect(() => {
    async function load() {
      if (isAdmin) {
        const { data } = await supabase
          .from('profiles')
          .select('id, name, role, google_calendar_id')
          .neq('role', 'admin')
          .order('name');
        setUsers(data || []);
        if (data && data.length > 0) setSelectedUserId(data[0].id);
      } else {
        // Team leader sees their assigned techs + self
        const { data: assignments } = await supabase
          .from('client_assignments')
          .select('tech_id, profiles!client_assignments_tech_id_fkey(id, name, role, google_calendar_id)')
          .eq('tech_id', profile.id);
        setUsers([{ id: profile.id, name: profile.name, role: profile.role, google_calendar_id: profile.google_calendar_id || null }]);
        setSelectedUserId(profile.id);
      }
    }
    load();
  }, [isAdmin, profile]);

  /* Load assigned clients for selected user */
  useEffect(() => {
    async function loadClients() {
      const { data } = await supabase
        .from('client_assignments')
        .select('client_id, clients(*)')
        .eq('tech_id', selectedUserId);

      const clients = (data || [])
        .map((a: any) => a.clients)
        .filter((c: Client | null) => c && c.service_type !== 'INTERNAL') as Client[];
      setAssignedClients(clients.sort((a, b) => a.name.localeCompare(b.name)));
    }
    if (selectedUserId) loadClients();
  }, [selectedUserId]);

  /* Fetch calendar events for selected user + date */
  const fetchCalendarEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    setCalendarEvents([]);
    setStops([]);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Not authenticated'); setLoading(false); return; }

      const targetUser = users.find(u => u.id === selectedUserId);
      const calendarId = targetUser?.google_calendar_id;

      if (!calendarId) {
        setError(`No Google Calendar configured for ${targetUser?.name || 'this user'}. Add their iCal URL in User Manager.`);
        setLoading(false);
        return;
      }

      const dateObj = new Date(selectedDate + 'T00:00:00');
      const timeMin = new Date(dateObj); timeMin.setHours(0, 0, 0, 0);
      const timeMax = new Date(dateObj); timeMax.setHours(23, 59, 59, 999);

      const calUrl = `/api/google-calendar?timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}${selectedUserId !== profile.id ? `&userId=${selectedUserId}` : ''}`;
      const res = await fetch(calUrl, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const data = await res.json();
      if (data.error && !data.events) {
        setError(data.error);
        setLoading(false);
        return;
      }

      const events: CalendarEvent[] = data.events || [];
      setCalendarEvents(events);

      // Match events to assigned clients
      const matched: Client[] = [];
      for (const ev of events) {
        const summary = ev.summary?.toLowerCase() || '';
        const matchedClient = assignedClients.find(c => {
          const clientName = c.name.toLowerCase();
          const acctNum = c.account_number.toLowerCase();
          return summary.includes(clientName) || summary.includes(acctNum) ||
            clientName.includes(summary.split(' - ')[0]?.trim()) ||
            clientName.split(/[\s-]+/).some(word => word.length > 3 && summary.includes(word));
        });
        if (matchedClient && !matched.find(m => m.id === matchedClient.id)) {
          matched.push(matchedClient);
        }
      }

      setStops(matched);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch calendar');
    }
    setLoading(false);
  }, [selectedUserId, selectedDate, users, assignedClients, profile]);

  /* Add a stop manually */
  function addStop(client: Client) {
    if (!stops.find(s => s.id === client.id)) {
      setStops(prev => [...prev, client]);
    }
    setAddClientOpen(false);
    setResult(null); // clear previous optimization
  }

  /* Remove a stop */
  function removeStop(clientId: number) {
    setStops(prev => prev.filter(s => s.id !== clientId));
    setResult(null);
  }

  /* Optimize route */
  async function optimizeRoute() {
    if (stops.length < 2) {
      setError('Add at least 2 stops to optimize a route.');
      return;
    }
    if (!mapsReady) {
      setError('Google Maps not loaded yet.');
      return;
    }

    setOptimizing(true);
    setError('');
    setResult(null);

    try {
      // Step 1: Geocode all stops
      const geocoded: GeocodedStop[] = [];
      for (const client of stops) {
        const addr = client.address || client.ship_address || '';
        if (!addr.trim()) {
          setError(`Client "${client.name}" has no address. Remove it or add an address in Client Manager.`);
          setOptimizing(false);
          return;
        }
        const coords = await geocodeAddress(addr);
        if (!coords) {
          setError(`Could not geocode address for "${client.name}": ${addr.substring(0, 60)}...`);
          setOptimizing(false);
          return;
        }
        geocoded.push({ client, lat: coords.lat, lng: coords.lng, address: addr, fromCalendar: false });
      }

      // Step 2: Build points array (office + all stops)
      const allPoints = [
        new google.maps.LatLng(officeCoords.lat, officeCoords.lng),
        ...geocoded.map(g => new google.maps.LatLng(g.lat, g.lng)),
      ];

      // Step 3: Get distance matrix
      // Google allows max 25 origins/destinations per request
      const n = allPoints.length;
      const distMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
      const durMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

      // Batch if needed (max 10x10 per request to stay safe)
      const BATCH = 10;
      for (let oi = 0; oi < n; oi += BATCH) {
        for (let di = 0; di < n; di += BATCH) {
          const origins = allPoints.slice(oi, Math.min(oi + BATCH, n));
          const destinations = allPoints.slice(di, Math.min(di + BATCH, n));

          const resp = await getDistanceMatrix(origins, destinations);

          for (let r = 0; r < resp.rows.length; r++) {
            for (let c = 0; c < resp.rows[r].elements.length; c++) {
              const el = resp.rows[r].elements[c];
              if (el.status === 'OK') {
                distMatrix[oi + r][di + c] = el.distance.value / 1000; // km
                durMatrix[oi + r][di + c] = el.duration_in_traffic?.value
                  ? el.duration_in_traffic.value / 60
                  : el.duration.value / 60; // minutes
              } else {
                distMatrix[oi + r][di + c] = 999999;
                durMatrix[oi + r][di + c] = 999999;
              }
            }
          }
        }
      }

      // Step 4: Calculate original route (office → stop1 → stop2 → ... → office)
      const originalIndices = [0, ...geocoded.map((_, i) => i + 1)];
      let origDuration = 0;
      let origDistance = 0;
      for (let i = 0; i < originalIndices.length - 1; i++) {
        origDuration += durMatrix[originalIndices[i]][originalIndices[i + 1]];
        origDistance += distMatrix[originalIndices[i]][originalIndices[i + 1]];
      }
      // Return to office
      origDuration += durMatrix[originalIndices[originalIndices.length - 1]][0];
      origDistance += distMatrix[originalIndices[originalIndices.length - 1]][0];

      // Step 5: Run TSP optimization
      const optimizedIndices = solveTSP(durMatrix);

      let optDuration = 0;
      let optDistance = 0;
      const legs: RouteResult['legs'] = [];
      for (let i = 0; i < optimizedIndices.length - 1; i++) {
        const fromIdx = optimizedIndices[i];
        const toIdx = optimizedIndices[i + 1];
        const fromName = fromIdx === 0 ? '🏢 Office' : geocoded[fromIdx - 1].client.name;
        const toName = toIdx === 0 ? '🏢 Office' : geocoded[toIdx - 1].client.name;
        optDuration += durMatrix[fromIdx][toIdx];
        optDistance += distMatrix[fromIdx][toIdx];
        legs.push({
          from: fromName,
          to: toName,
          duration: Math.round(durMatrix[fromIdx][toIdx]),
          distance: Math.round(distMatrix[fromIdx][toIdx] * 10) / 10,
        });
      }
      // Return to office
      const lastIdx = optimizedIndices[optimizedIndices.length - 1];
      optDuration += durMatrix[lastIdx][0];
      optDistance += distMatrix[lastIdx][0];
      legs.push({
        from: lastIdx === 0 ? '🏢 Office' : geocoded[lastIdx - 1].client.name,
        to: '🏢 Office',
        duration: Math.round(durMatrix[lastIdx][0]),
        distance: Math.round(distMatrix[lastIdx][0] * 10) / 10,
      });

      const optimizedStops = optimizedIndices
        .filter(i => i !== 0)
        .map(i => geocoded[i - 1]);

      const routeResult: RouteResult = {
        originalOrder: [...geocoded],
        optimizedOrder: optimizedStops,
        originalDuration: Math.round(origDuration),
        optimizedDuration: Math.round(optDuration),
        originalDistance: Math.round(origDistance * 10) / 10,
        optimizedDistance: Math.round(optDistance * 10) / 10,
        legs,
      };

      setResult(routeResult);

      // Step 6: Draw on map
      drawRouteOnMap(routeResult, geocoded);
    } catch (err: any) {
      setError(err.message || 'Route optimization failed');
    }
    setOptimizing(false);
  }

  /* Draw route on map */
  function drawRouteOnMap(routeResult: RouteResult, geocoded: GeocodedStop[]) {
    if (!mapRef.current || !mapsReady) return;

    // Clear previous
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    if (polylineRef.current) polylineRef.current.setMap(null);
    if (directionsRendererRef.current) directionsRendererRef.current.setMap(null);

    // Create/reuse map
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new google.maps.Map(mapRef.current, {
        zoom: 10,
        center: officeCoords,
        mapTypeId: 'roadmap',
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        ],
      });
    }

    const map = mapInstanceRef.current;
    const bounds = new google.maps.LatLngBounds();

    // Office marker
    const officeMarker = new google.maps.Marker({
      position: officeCoords,
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: '#F27C22',
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 3,
      },
      label: { text: '🏢', fontSize: '16px' },
      title: 'Office — 8 Derrick Road, Spartan',
      zIndex: 100,
    });
    markersRef.current.push(officeMarker);
    bounds.extend(officeCoords);

    // Stop markers (numbered in optimized order)
    routeResult.optimizedOrder.forEach((stop, idx) => {
      const pos = { lat: stop.lat, lng: stop.lng };
      const marker = new google.maps.Marker({
        position: pos,
        map,
        label: {
          text: String(idx + 1),
          color: '#fff',
          fontWeight: 'bold',
          fontSize: '13px',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 16,
          fillColor: '#050d11',
          fillOpacity: 0.9,
          strokeColor: '#F27C22',
          strokeWeight: 2,
        },
        title: `${idx + 1}. ${stop.client.name}\n${stop.address}`,
        zIndex: 50 - idx,
      });

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="font-family:Montserrat,sans-serif;max-width:260px">
            <strong style="color:#050d11">${idx + 1}. ${stop.client.name}</strong><br/>
            <span style="color:#666;font-size:12px">${stop.address.replace(/\n/g, ', ')}</span>
            ${routeResult.legs[idx] ? `<br/><span style="color:#F27C22;font-size:12px;font-weight:600">🚗 ${routeResult.legs[idx].duration} min (${routeResult.legs[idx].distance} km)</span>` : ''}
          </div>
        `,
      });
      marker.addListener('click', () => infoWindow.open(map, marker));

      markersRef.current.push(marker);
      bounds.extend(pos);
    });

    // Draw route polyline
    const routePath = [
      officeCoords,
      ...routeResult.optimizedOrder.map(s => ({ lat: s.lat, lng: s.lng })),
      officeCoords,
    ];

    polylineRef.current = new google.maps.Polyline({
      path: routePath,
      geodesic: true,
      strokeColor: '#F27C22',
      strokeOpacity: 0.8,
      strokeWeight: 4,
      map,
    });

    map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
  }

  /* Format duration */
  function fmtDuration(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const timeSaved = result ? result.originalDuration - result.optimizedDuration : 0;
  const distSaved = result ? result.originalDistance - result.optimizedDistance : 0;
  const availableToAdd = assignedClients.filter(c => !stops.find(s => s.id === c.id));

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="bg-primary/10 p-3 rounded-xl">
          <Route size={28} className="text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-base-content" style={{ fontFamily: 'Montserrat' }}>
            Route Planner
          </h1>
          <p className="text-sm text-base-content/60">
            Optimize daily routes to minimize driving time
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="card bg-base-100 shadow-md">
        <div className="card-body p-4">
          <div className="flex flex-wrap gap-4 items-end">
            {/* Date picker */}
            <div className="form-control w-44">
              <label className="label py-1"><span className="label-text font-semibold text-xs">📅 Date</span></label>
              <input
                type="date"
                className="input input-bordered input-sm"
                value={selectedDate}
                onChange={e => { setSelectedDate(e.target.value); setResult(null); }}
              />
            </div>

            {/* User selector (admin only sees dropdown) */}
            {(isAdmin || isTeamLeader) && users.length > 1 && (
              <div className="form-control w-56">
                <label className="label py-1"><span className="label-text font-semibold text-xs">👤 Team Member</span></label>
                <select
                  className="select select-bordered select-sm"
                  value={selectedUserId}
                  onChange={e => { setSelectedUserId(e.target.value); setResult(null); }}
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} {u.google_calendar_id ? '' : '(no calendar)'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Load from calendar button */}
            <button
              className="btn btn-primary btn-sm gap-2"
              onClick={fetchCalendarEvents}
              disabled={loading}
            >
              {loading ? <span className="loading loading-spinner loading-xs" /> : <CalendarDays size={16} />}
              Load Schedule
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-error shadow-sm">
          <AlertCircle size={18} />
          <span className="text-sm">{error}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* Stops list */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Stops */}
        <div className="space-y-4">
          <div className="card bg-base-100 shadow-md">
            <div className="card-body p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-base flex items-center gap-2">
                  <MapPin size={18} className="text-primary" />
                  Stops ({stops.length})
                </h3>
                <div className="relative">
                  <button
                    className="btn btn-outline btn-primary btn-xs gap-1"
                    onClick={() => setAddClientOpen(!addClientOpen)}
                  >
                    <Plus size={14} /> Add Stop
                  </button>
                  {addClientOpen && availableToAdd.length > 0 && (
                    <div className="absolute right-0 top-8 z-50 bg-base-100 border border-base-300 rounded-lg shadow-xl w-72 max-h-60 overflow-y-auto">
                      {availableToAdd.map(c => (
                        <button
                          key={c.id}
                          className="w-full text-left px-3 py-2 hover:bg-base-200 text-sm border-b border-base-200 last:border-0"
                          onClick={() => addStop(c)}
                        >
                          <span className="font-semibold">{c.name}</span>
                          <br />
                          <span className="text-xs text-base-content/50">
                            {c.address ? c.address.replace(/\n/g, ', ').substring(0, 60) : 'No address'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Office (always first) */}
              <div className="flex items-center gap-3 px-3 py-2 bg-primary/5 rounded-lg border border-primary/20 mb-2">
                <div className="bg-primary text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold shrink-0">
                  🏢
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">Office — Start Point</p>
                  <p className="text-xs text-base-content/50 truncate">8 Derrick Road, Spartan, Kempton Park</p>
                </div>
              </div>

              {/* Client stops */}
              {stops.length === 0 ? (
                <div className="text-center py-6 text-base-content/40">
                  <Truck size={32} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No stops yet. Click <strong>Load Schedule</strong> to pull from calendar, or <strong>Add Stop</strong> manually.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {stops.map((client, idx) => (
                    <div key={client.id} className="flex items-center gap-3 px-3 py-2 bg-base-200/50 rounded-lg hover:bg-base-200">
                      <div className="bg-base-content/80 text-base-100 rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{client.name}</p>
                        <p className="text-xs text-base-content/50 truncate">
                          {client.address ? client.address.replace(/\n/g, ', ').substring(0, 60) : 'No address'}
                        </p>
                      </div>
                      <button
                        className="btn btn-ghost btn-xs text-error"
                        onClick={() => removeStop(client.id)}
                        title="Remove stop"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Office return */}
              {stops.length > 0 && (
                <div className="flex items-center gap-3 px-3 py-2 bg-primary/5 rounded-lg border border-primary/20 mt-2">
                  <div className="bg-primary text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold shrink-0">
                    🏢
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">Office — Return</p>
                    <p className="text-xs text-base-content/50 truncate">8 Derrick Road, Spartan, Kempton Park</p>
                  </div>
                </div>
              )}

              {/* Optimize button */}
              <button
                className="btn btn-primary btn-block mt-4 gap-2"
                onClick={optimizeRoute}
                disabled={optimizing || stops.length < 2}
              >
                {optimizing ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Calculating optimal route...
                  </>
                ) : (
                  <>
                    <Navigation size={18} />
                    Optimize Route
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Calendar events info */}
          {calendarEvents.length > 0 && (
            <div className="card bg-base-100 shadow-md">
              <div className="card-body p-4">
                <h3 className="font-bold text-sm flex items-center gap-2 mb-2">
                  <CalendarDays size={16} className="text-primary" />
                  Calendar Events ({calendarEvents.length})
                </h3>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {calendarEvents.map((ev, i) => (
                    <div key={i} className="text-xs flex items-center gap-2 px-2 py-1 bg-base-200/50 rounded">
                      <Clock size={12} className="text-base-content/40 shrink-0" />
                      <span className="truncate">{ev.summary}</span>
                      {ev.start && !ev.allDay && (
                        <span className="text-base-content/40 shrink-0 ml-auto">
                          {new Date(ev.start).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Map + Results */}
        <div className="space-y-4">
          {/* Map */}
          <div className="card bg-base-100 shadow-md">
            <div className="card-body p-0 overflow-hidden rounded-2xl">
              <div ref={mapRef} className="w-full h-80 md:h-96 bg-base-200">
                {!mapsReady && (
                  <div className="flex items-center justify-center h-full text-base-content/40">
                    <span className="loading loading-spinner loading-md mr-2" />
                    Loading map...
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Results */}
          {result && (
            <>
              {/* Savings banner */}
              <div className={`card shadow-md ${timeSaved > 0 ? 'bg-success/10 border-2 border-success/30' : 'bg-warning/10 border-2 border-warning/30'}`}>
                <div className="card-body p-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${timeSaved > 0 ? 'bg-success/20' : 'bg-warning/20'}`}>
                      <TrendingDown size={24} className={timeSaved > 0 ? 'text-success' : 'text-warning'} />
                    </div>
                    <div>
                      {timeSaved > 0 ? (
                        <>
                          <p className="text-lg font-bold text-success">
                            Save {fmtDuration(timeSaved)} & {distSaved.toFixed(1)} km
                          </p>
                          <p className="text-xs text-base-content/60">
                            Optimized route is {Math.round((timeSaved / result.originalDuration) * 100)}% faster than current order
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-lg font-bold text-warning">Route is already optimal</p>
                          <p className="text-xs text-base-content/60">Current order is the most efficient</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Before/After comparison */}
              <div className="grid grid-cols-2 gap-4">
                <div className="card bg-base-100 shadow border-l-4 border-error/50">
                  <div className="card-body p-3 text-center">
                    <p className="text-xs text-base-content/50 font-semibold uppercase">Current Route</p>
                    <p className="text-xl font-bold text-error">{fmtDuration(result.originalDuration)}</p>
                    <p className="text-xs text-base-content/50">{result.originalDistance} km</p>
                  </div>
                </div>
                <div className="card bg-base-100 shadow border-l-4 border-success">
                  <div className="card-body p-3 text-center">
                    <p className="text-xs text-base-content/50 font-semibold uppercase">Optimized</p>
                    <p className="text-xl font-bold text-success">{fmtDuration(result.optimizedDuration)}</p>
                    <p className="text-xs text-base-content/50">{result.optimizedDistance} km</p>
                  </div>
                </div>
              </div>

              {/* Optimized route legs */}
              <div className="card bg-base-100 shadow-md">
                <div className="card-body p-4">
                  <h3 className="font-bold text-sm flex items-center gap-2 mb-3">
                    <Route size={16} className="text-primary" />
                    Optimized Route Order
                  </h3>
                  <div className="space-y-1">
                    {result.legs.map((leg, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <span className="font-semibold truncate">{leg.from}</span>
                          <ArrowRight size={14} className="text-primary shrink-0" />
                          <span className="truncate">{leg.to}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-xs">
                          <span className="badge badge-ghost badge-sm">{leg.duration} min</span>
                          <span className="text-base-content/40">{leg.distance} km</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="divider my-2" />
                  <div className="flex justify-between text-sm font-bold">
                    <span>Total Drive Time</span>
                    <span className="text-primary">{fmtDuration(result.optimizedDuration)} ({result.optimizedDistance} km)</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Click-away handler for dropdown */}
      {addClientOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setAddClientOpen(false)} />
      )}
    </div>
  );
}
