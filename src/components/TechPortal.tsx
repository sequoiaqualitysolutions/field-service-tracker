import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, MapPin, Clock } from 'lucide-react';
import { Profile, Client, TimeEntry } from '../types';
import { MapView } from './MapView';
import { formatTime, formatDuration, calcHours, getCurrentGps, calcDistanceKm } from '../utils/helpers';
import { supabase } from '../lib/supabase';

interface TechPortalProps {
  profile: Profile;
  preselectedClientId?: number | null;
  onClearPreselect?: () => void;
}

export const TechPortal: React.FC<TechPortalProps> = ({ profile, preselectedClientId, onClearPreselect }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<number>(0);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [elapsed, setElapsed] = useState('00:00:00');
  const [notes, setNotes] = useState('');
  const [gpsStatus, setGpsStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [startCoords, setStartCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [stopCoords, setStopCoords] = useState<{ lat: number; lng: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const preselectedApplied = useRef(false);

  useEffect(() => {
    loadData();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Apply preselected client from schedule
  useEffect(() => {
    if (preselectedClientId && !preselectedApplied.current && clients.length > 0 && !activeEntry) {
      setSelectedClient(preselectedClientId);
      preselectedApplied.current = true;
      onClearPreselect?.();
    }
  }, [preselectedClientId, clients, activeEntry, onClearPreselect]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (activeEntry) {
      const tick = () => {
        const start = new Date(activeEntry.start_time).getTime();
        const diff = Math.floor((Date.now() - start) / 1000);
        const h = String(Math.floor(diff / 3600)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
        const s = String(diff % 60).padStart(2, '0');
        setElapsed(`${h}:${m}:${s}`);
      };
      tick();
      timerRef.current = window.setInterval(tick, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeEntry]);

  async function loadData() {
    // Get assigned clients
    const { data: assignments } = await supabase
      .from('client_assignments')
      .select('client_id, clients(*)')
      .eq('tech_id', profile.id);

    const assignedClients = (assignments || [])
      .map((a: any) => a.clients)
      .filter(Boolean)
      .sort((a: Client, b: Client) => a.name.localeCompare(b.name));
    setClients(assignedClients);

    // Get active entry
    const { data: activeRows } = await supabase
      .from('time_entries')
      .select('*, clients(name, account_number)')
      .eq('tech_id', profile.id)
      .is('end_time', null)
      .limit(1);

    if (activeRows && activeRows.length > 0) {
      const entry = activeRows[0] as unknown as TimeEntry;
      setActiveEntry(entry);
      if (entry.start_lat != null && entry.start_lng != null) {
        setStartCoords({ lat: entry.start_lat, lng: entry.start_lng });
      }
      setSelectedClient(entry.client_id);
    }

    // Get today's completed entries
    const today = new Date().toISOString().split('T')[0];
    const { data: todayRows } = await supabase
      .from('time_entries')
      .select('*, clients(name, account_number)')
      .eq('tech_id', profile.id)
      .not('end_time', 'is', null)
      .gte('start_time', `${today}T00:00:00`)
      .lte('start_time', `${today}T23:59:59`)
      .order('start_time', { ascending: false });

    setTodayEntries((todayRows || []) as unknown as TimeEntry[]);
  }

  async function handleStart() {
    if (!selectedClient) return;
    setLoading(true);
    setGpsStatus('Checking status...');
    setStopCoords(null);

    // Safety check: prevent clocking into a second client while already clocked in
    const { data: openEntries } = await supabase
      .from('time_entries')
      .select('id, clients(name)')
      .eq('tech_id', profile.id)
      .is('end_time', null)
      .limit(1);

    if (openEntries && openEntries.length > 0) {
      const clientName = (openEntries[0].clients as any)?.name || 'another client';
      setGpsStatus(`⚠️ You are already clocked in at ${clientName}. Clock out first.`);
      setActiveEntry(openEntries[0] as unknown as TimeEntry);
      setLoading(false);
      await loadData();
      return;
    }

    setGpsStatus('Acquiring GPS position...');

    let lat: number | null = null;
    let lng: number | null = null;

    try {
      const coords = await getCurrentGps();
      lat = coords.lat;
      lng = coords.lng;
      setStartCoords(coords);
      setGpsStatus(`GPS acquired ✓  (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`);
    } catch {
      setGpsStatus('GPS unavailable — recording without location');
    }

    const { error } = await supabase.from('time_entries').insert({
      tech_id: profile.id,
      client_id: selectedClient,
      start_time: new Date().toISOString(),
      start_lat: lat,
      start_lng: lng,
      notes: notes,
    });

    if (error) {
      console.error('Failed to start job:', error);
    } else {
      setNotes('');
      await loadData();
    }
    setLoading(false);
  }

  async function handleStop() {
    if (!activeEntry) return;
    setLoading(true);
    setGpsStatus('Acquiring GPS position...');

    let lat: number | null = null;
    let lng: number | null = null;

    try {
      const coords = await getCurrentGps();
      lat = coords.lat;
      lng = coords.lng;
      setStopCoords(coords);
      setGpsStatus(`Stop GPS acquired ✓  (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`);
    } catch {
      setGpsStatus('Stop GPS unavailable');
    }

    // Calculate straight-line distance between clock-in and clock-out
    let distance: number | null = null;
    if (activeEntry.start_lat != null && activeEntry.start_lng != null && lat != null && lng != null) {
      distance = calcDistanceKm(activeEntry.start_lat, activeEntry.start_lng, lat, lng);
    }

    const { error } = await supabase
      .from('time_entries')
      .update({
        end_time: new Date().toISOString(),
        stop_lat: lat,
        stop_lng: lng,
        distance_km: distance,
      })
      .eq('id', activeEntry.id);

    if (error) {
      console.error('Failed to stop job:', error);
    } else {
      setActiveEntry(null);
      setElapsed('00:00:00');
      await loadData();
    }
    setLoading(false);
  }

  const todayTotal = todayEntries.reduce((sum, e) => sum + calcHours(e.start_time, e.end_time), 0);

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Clock size={22} className="text-primary" />
        {profile.name}&apos;s Timesheet
      </h2>

      {/* Clock In/Out Card */}
      <div className={`card ${activeEntry ? 'bg-success/10 border border-success/30' : 'bg-base-200'}`}>
        <div className="card-body p-4 space-y-3">
          {!activeEntry ? (
            <>
              <select
                className="select select-bordered w-full"
                value={selectedClient}
                onChange={e => setSelectedClient(Number(e.target.value))}
              >
                <option value={0}>Select an assigned client...</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.account_number})</option>
                ))}
              </select>
              {clients.length === 0 && (
                <p className="text-xs text-warning">No clients assigned to you yet. Contact your admin.</p>
              )}
              <textarea
                className="textarea textarea-bordered w-full"
                placeholder="Job notes (optional)..."
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
              <button
                className="btn btn-success w-full"
                onClick={handleStart}
                disabled={!selectedClient || loading}
              >
                <Play size={18} /> Clock In
              </button>
            </>
          ) : (
            <>
              <div className="text-center">
                <p className="text-sm text-base-content/60">Clocked in at</p>
                <p className="font-semibold">
                  {(activeEntry.clients as any)?.name || 'Unknown Client'}
                </p>
                <p className="text-3xl font-mono font-bold text-success mt-2">{elapsed}</p>
              </div>
              <button
                className="btn btn-error w-full"
                onClick={handleStop}
                disabled={loading}
              >
                <Square size={18} /> Clock Out
              </button>
            </>
          )}
          {gpsStatus && (
            <p className="text-xs text-base-content/60 flex items-center gap-1">
              <MapPin size={12} /> {gpsStatus}
            </p>
          )}
        </div>
      </div>

      {/* Map */}
      {(startCoords || stopCoords) && (
        <div className="card bg-base-200">
          <div className="card-body p-3">
            <p className="text-xs font-semibold mb-1">📍 GPS Location</p>
            <MapView startCoords={startCoords} stopCoords={stopCoords} height="200px" />
            <div className="flex gap-4 mt-1 text-xs text-base-content/60">
              {startCoords && <span className="flex items-center gap-1"><span className="w-2 h-2 bg-success rounded-full inline-block" /> Start</span>}
              {stopCoords && <span className="flex items-center gap-1"><span className="w-2 h-2 bg-error rounded-full inline-block" /> Stop</span>}
            </div>
          </div>
        </div>
      )}

      {/* Today's Entries */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-sm">Today&apos;s Entries</h3>
            <span className="badge badge-sm">{formatDuration(todayTotal)} total</span>
          </div>
          {todayEntries.length === 0 ? (
            <p className="text-sm text-base-content/50 text-center py-4">No entries today</p>
          ) : (
            <div className="space-y-2">
              {todayEntries.map(entry => (
                <div key={entry.id} className="bg-base-300 rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-sm">{(entry.clients as any)?.name || 'Unknown'}</p>
                      <p className="text-xs text-base-content/50">
                        {formatTime(entry.start_time)} → {entry.end_time ? formatTime(entry.end_time) : 'Active'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="badge badge-sm badge-primary">
                        {formatDuration(calcHours(entry.start_time, entry.end_time))}
                      </span>
                      {entry.distance_km != null ? (
                        <span className={`badge badge-xs ${entry.distance_km > 2 ? 'badge-error animate-pulse' : 'badge-success'}`}>
                          📍 {entry.distance_km.toFixed(2)} km {entry.distance_km > 2 ? '⚠️' : '✓'}
                        </span>
                      ) : (entry.start_lat == null || entry.stop_lat == null) && entry.end_time ? (
                        <span className="badge badge-xs badge-warning">📍 No GPS ⚠️</span>
                      ) : null}
                    </div>
                  </div>
                  {entry.distance_km != null && entry.distance_km > 2 && (
                    <p className="text-xs text-error mt-1 font-semibold">
                      ⚠️ Distance flag: Tech moved {entry.distance_km.toFixed(2)} km between clock-in and clock-out
                    </p>
                  )}
                  {entry.notes && <p className="text-xs text-base-content/40 mt-1 italic">{entry.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
