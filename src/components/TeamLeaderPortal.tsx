import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, MapPin, Clock, Users, Plus, UserCheck, ChevronDown } from 'lucide-react';
import { Profile, Client, TimeEntry, TeamSession } from '../types';
import { MapView } from './MapView';
import { formatTime, formatDuration, calcHours, getCurrentGps, calcDistanceKm } from '../utils/helpers';
import { supabase } from '../lib/supabase';

interface TeamLeaderPortalProps {
  profile: Profile;
}

export const TeamLeaderPortal: React.FC<TeamLeaderPortalProps> = ({ profile }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [allTechs, setAllTechs] = useState<Profile[]>([]);
  const [selectedClient, setSelectedClient] = useState<number>(0);
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [activeSession, setActiveSession] = useState<TeamSession | null>(null);
  const [sessionEntries, setSessionEntries] = useState<TimeEntry[]>([]);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [elapsed, setElapsed] = useState('00:00:00');
  const [notes, setNotes] = useState('');
  const [gpsStatus, setGpsStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [startCoords, setStartCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [stopCoords, setStopCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showAddTech, setShowAddTech] = useState(false);
  const [techDropdownOpen, setTechDropdownOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTechDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (activeSession) {
      const tick = () => {
        const start = new Date(activeSession.start_time).getTime();
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
  }, [activeSession]);

  async function loadData() {
    // Get assigned clients for this team leader
    const { data: assignments } = await supabase
      .from('client_assignments')
      .select('client_id, clients(*)')
      .eq('tech_id', profile.id);

    const assignedClients = (assignments || [])
      .map((a: any) => a.clients)
      .filter(Boolean)
      .sort((a: Client, b: Client) => a.name.localeCompare(b.name));
    setClients(assignedClients);

    // Get all non-admin users excluding self for multi-select
    const { data: techData } = await supabase
      .from('profiles')
      .select('*')
      .neq('role', 'admin')
      .neq('id', profile.id)
      .order('name');
    setAllTechs((techData || []) as Profile[]);

    // Get active session
    const { data: activeSessions } = await supabase
      .from('team_sessions')
      .select('*, clients(name, account_number)')
      .eq('leader_id', profile.id)
      .is('end_time', null)
      .limit(1);

    if (activeSessions && activeSessions.length > 0) {
      const session = activeSessions[0] as unknown as TeamSession;
      setActiveSession(session);
      if (session.start_lat != null && session.start_lng != null) {
        setStartCoords({ lat: session.start_lat, lng: session.start_lng });
      }

      // Get entries in this active session
      const { data: entries } = await supabase
        .from('time_entries')
        .select('*, clients(name, account_number), profiles(name)')
        .eq('session_id', session.id)
        .is('end_time', null);
      setSessionEntries((entries || []) as unknown as TimeEntry[]);
    } else {
      setActiveSession(null);
      setSessionEntries([]);
    }

    // Get today's completed entries for this leader
    const today = new Date().toISOString().split('T')[0];
    const { data: todayRows } = await supabase
      .from('time_entries')
      .select('*, clients(name, account_number), profiles(name)')
      .eq('tech_id', profile.id)
      .not('end_time', 'is', null)
      .gte('start_time', `${today}T00:00:00`)
      .lte('start_time', `${today}T23:59:59`)
      .order('start_time', { ascending: false });
    setTodayEntries((todayRows || []) as unknown as TimeEntry[]);
  }

  async function handleStartSession() {
    if (!selectedClient) return;
    setLoading(true);
    setGpsStatus('Checking status...');
    setStopCoords(null);

    // Prevent double session
    const { data: existing } = await supabase
      .from('team_sessions')
      .select('id, clients(name)')
      .eq('leader_id', profile.id)
      .is('end_time', null)
      .limit(1);

    if (existing && existing.length > 0) {
      const clientName = (existing[0].clients as any)?.name || 'another client';
      setGpsStatus(`⚠️ Already clocked in at ${clientName}. Clock out first.`);
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
      setGpsStatus(`GPS acquired ✓ (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`);
    } catch {
      setGpsStatus('GPS unavailable — recording without location');
    }

    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create session
    const { error: sessionError } = await supabase.from('team_sessions').insert({
      id: sessionId,
      leader_id: profile.id,
      client_id: selectedClient,
      start_time: now,
      start_lat: lat,
      start_lng: lng,
      notes: notes,
    });

    if (sessionError) {
      console.error('Session create error:', sessionError);
      setGpsStatus('Failed to start session: ' + sessionError.message);
      setLoading(false);
      return;
    }

    // Create time entries for leader + all selected techs
    const allPeople = [profile.id, ...selectedTechs];
    const entries = allPeople.map(personId => ({
      tech_id: personId,
      client_id: selectedClient,
      start_time: now,
      start_lat: lat,
      start_lng: lng,
      notes: personId === profile.id ? notes : `Clocked in by ${profile.name}`,
      session_id: sessionId,
      clocked_in_by: personId === profile.id ? profile.id : profile.id,
    }));

    const { error: entriesError } = await supabase.from('time_entries').insert(entries);
    if (entriesError) {
      console.error('Entries create error:', entriesError);
      await supabase.from('team_sessions').delete().eq('id', sessionId);
      setGpsStatus('Failed to create time entries: ' + entriesError.message);
      setLoading(false);
      return;
    }

    setNotes('');
    setSelectedTechs([]);
    setTechDropdownOpen(false);
    await loadData();
    setLoading(false);
  }

  async function handleStopSession() {
    if (!activeSession) return;
    setLoading(true);
    setGpsStatus('Acquiring stop GPS...');

    let lat: number | null = null;
    let lng: number | null = null;

    try {
      const coords = await getCurrentGps();
      lat = coords.lat;
      lng = coords.lng;
      setStopCoords(coords);
      setGpsStatus(`Stop GPS acquired ✓ (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`);
    } catch {
      setGpsStatus('Stop GPS unavailable');
    }

    const now = new Date().toISOString();

    // Calculate distance
    let distance: number | null = null;
    if (activeSession.start_lat != null && activeSession.start_lng != null && lat != null && lng != null) {
      distance = calcDistanceKm(activeSession.start_lat, activeSession.start_lng, lat, lng);
    }

    // Update session
    await supabase.from('team_sessions').update({
      end_time: now,
      stop_lat: lat,
      stop_lng: lng,
      distance_km: distance,
    }).eq('id', activeSession.id);

    // Update ALL open entries in this session
    await supabase.from('time_entries').update({
      end_time: now,
      stop_lat: lat,
      stop_lng: lng,
      distance_km: distance,
    }).eq('session_id', activeSession.id).is('end_time', null);

    setActiveSession(null);
    setSessionEntries([]);
    setElapsed('00:00:00');
    await loadData();
    setLoading(false);
  }

  async function handleAddTech(techId: string) {
    if (!activeSession) return;
    setLoading(true);

    const now = new Date().toISOString();

    // Get current GPS
    let lat: number | null = activeSession.start_lat;
    let lng: number | null = activeSession.start_lng;

    try {
      const coords = await getCurrentGps();
      lat = coords.lat;
      lng = coords.lng;
    } catch {
      // Use session start GPS as fallback
    }

    const { error } = await supabase.from('time_entries').insert({
      tech_id: techId,
      client_id: activeSession.client_id,
      start_time: now,
      start_lat: lat,
      start_lng: lng,
      notes: `Added mid-session by ${profile.name}`,
      session_id: activeSession.id,
      clocked_in_by: profile.id,
    });

    if (error) {
      console.error('Add tech error:', error);
    }

    setShowAddTech(false);
    await loadData();
    setLoading(false);
  }

  function toggleTech(techId: string) {
    setSelectedTechs(prev =>
      prev.includes(techId) ? prev.filter(id => id !== techId) : [...prev, techId]
    );
  }

  const todayTotal = todayEntries.reduce((sum, e) => sum + calcHours(e.start_time, e.end_time), 0);
  const techsInSession = sessionEntries.map(e => e.tech_id);
  const availableTechsToAdd = allTechs.filter(t => !techsInSession.includes(t.id));

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Users size={22} className="text-primary" />
        {profile.name}&apos;s Team Portal
      </h2>

      {/* Clock In / Active Session Card */}
      <div className={`card ${activeSession ? 'bg-success/10 border border-success/30' : 'bg-base-200'}`}>
        <div className="card-body p-4 space-y-3">
          {!activeSession ? (
            <>
              {/* Client Select */}
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

              {/* Multi-select Tech Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  className="btn btn-outline w-full justify-between font-normal"
                  onClick={() => setTechDropdownOpen(!techDropdownOpen)}
                >
                  <span className="flex items-center gap-2">
                    <UserCheck size={16} />
                    {selectedTechs.length === 0
                      ? 'Select team members...'
                      : `${selectedTechs.length} tech${selectedTechs.length > 1 ? 's' : ''} selected`}
                  </span>
                  <ChevronDown size={16} className={`transition-transform ${techDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {techDropdownOpen && (
                  <div className="absolute z-50 mt-1 w-full bg-base-300 rounded-lg shadow-xl border border-base-content/10 max-h-64 overflow-y-auto">
                    {allTechs.length === 0 ? (
                      <p className="p-3 text-sm text-base-content/50">No team members available</p>
                    ) : (
                      <>
                        <div className="p-2 border-b border-base-content/10 flex gap-2 sticky top-0 bg-base-300 z-10">
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() => setSelectedTechs(allTechs.map(t => t.id))}
                          >
                            Select All
                          </button>
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() => setSelectedTechs([])}
                          >
                            Clear All
                          </button>
                        </div>
                        {allTechs.map(tech => (
                          <label
                            key={tech.id}
                            className="flex items-center gap-3 px-3 py-2 hover:bg-base-200 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm checkbox-primary"
                              checked={selectedTechs.includes(tech.id)}
                              onChange={() => toggleTech(tech.id)}
                            />
                            <div className="flex-1">
                              <p className="text-sm font-medium">{tech.name}</p>
                              <p className="text-xs text-base-content/50">
                                {tech.role === 'team_leader' ? '👑 Team Leader' : '🔧 Technician'} • ${Number(tech.hourly_rate).toFixed(2)}/hr
                              </p>
                            </div>
                          </label>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Selected Techs Preview */}
              {selectedTechs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedTechs.map(id => {
                    const tech = allTechs.find(t => t.id === id);
                    return tech ? (
                      <span key={id} className="badge badge-sm badge-primary gap-1">
                        {tech.name}
                        <button
                          className="text-primary-content hover:opacity-70"
                          onClick={() => toggleTech(id)}
                        >
                          ×
                        </button>
                      </span>
                    ) : null;
                  })}
                </div>
              )}

              {/* Notes */}
              <textarea
                className="textarea textarea-bordered w-full"
                placeholder="Job notes (optional)..."
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />

              {/* Clock In Button */}
              <button
                className="btn btn-success w-full text-lg"
                onClick={handleStartSession}
                disabled={!selectedClient || loading}
              >
                <Play size={20} />
                Clock In Team ({selectedTechs.length + 1} {selectedTechs.length === 0 ? 'person' : 'people'})
              </button>
              <p className="text-xs text-base-content/40 text-center">
                This will clock in you + {selectedTechs.length} team member{selectedTechs.length !== 1 ? 's' : ''}
              </p>
            </>
          ) : (
            <>
              {/* Active Session Display */}
              <div className="text-center">
                <p className="text-sm text-base-content/60">Clocked in at</p>
                <p className="font-semibold text-lg">
                  {(activeSession.clients as any)?.name || 'Unknown Client'}
                </p>
                <p className="text-3xl font-mono font-bold text-success mt-2">{elapsed}</p>
              </div>

              {/* Team Members in Session */}
              <div className="bg-base-300 rounded-lg p-3">
                <p className="text-xs font-semibold mb-2 flex items-center gap-1">
                  <Users size={14} /> Team on site ({sessionEntries.length})
                </p>
                <div className="space-y-1">
                  {sessionEntries.map(entry => {
                    const isLeader = entry.tech_id === profile.id;
                    const entryHours = calcHours(entry.start_time, null);
                    return (
                      <div key={entry.id} className="flex justify-between items-center text-sm bg-base-200 rounded px-2 py-1">
                        <span className="flex items-center gap-2">
                          {isLeader ? '👑' : '🔧'} {(entry.profiles as any)?.name || 'Unknown'}
                          {isLeader && <span className="badge badge-xs badge-primary">You</span>}
                        </span>
                        <span className="badge badge-sm badge-ghost font-mono">
                          {formatDuration(entryHours)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Add Tech Mid-Session */}
              {availableTechsToAdd.length > 0 && (
                <div>
                  {!showAddTech ? (
                    <button
                      className="btn btn-outline btn-sm w-full"
                      onClick={() => setShowAddTech(true)}
                    >
                      <Plus size={16} /> Add Tech to Session
                    </button>
                  ) : (
                    <div className="bg-base-300 rounded-lg p-3 space-y-2">
                      <p className="text-xs font-semibold">Select a technician to add:</p>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {availableTechsToAdd.map(tech => (
                          <button
                            key={tech.id}
                            className="btn btn-sm btn-ghost w-full justify-start"
                            onClick={() => handleAddTech(tech.id)}
                            disabled={loading}
                          >
                            <Plus size={14} /> {tech.name}
                            <span className="text-xs text-base-content/50 ml-auto">
                              {tech.role === 'team_leader' ? 'Leader' : 'Tech'}
                            </span>
                          </button>
                        ))}
                      </div>
                      <button
                        className="btn btn-xs btn-ghost w-full"
                        onClick={() => setShowAddTech(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Clock Out All */}
              <button
                className="btn btn-error w-full text-lg"
                onClick={handleStopSession}
                disabled={loading}
              >
                <Square size={20} /> Clock Out All ({sessionEntries.length})
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
              {startCoords && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-success rounded-full inline-block" /> Start
                </span>
              )}
              {stopCoords && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-error rounded-full inline-block" /> Stop
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Today's Completed Entries */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-sm">Today&apos;s Completed Sessions</h3>
            <span className="badge badge-sm">{formatDuration(todayTotal)} your hours</span>
          </div>
          {todayEntries.length === 0 ? (
            <p className="text-sm text-base-content/50 text-center py-4">No completed entries today</p>
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
                        <span className={`badge badge-xs ${entry.distance_km > 1 ? 'badge-error animate-pulse' : 'badge-success'}`}>
                          📍 {entry.distance_km.toFixed(2)} km {entry.distance_km > 1 ? '⚠️' : '✓'}
                        </span>
                      ) : (entry.start_lat == null || entry.stop_lat == null) && entry.end_time ? (
                        <span className="badge badge-xs badge-warning">📍 No GPS ⚠️</span>
                      ) : null}
                      {entry.end_time && calcHours(entry.start_time, entry.end_time) < (10 / 60) && (
                        <span className="badge badge-xs badge-error animate-pulse">⏱️ &lt;10 min ⚠️</span>
                      )}
                    </div>
                  </div>
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
