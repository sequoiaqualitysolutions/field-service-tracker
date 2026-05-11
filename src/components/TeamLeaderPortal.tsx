import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, MapPin, Clock, Users, Plus, UserCheck, ChevronDown } from 'lucide-react';
import { Profile, Client, TimeEntry, TeamSession } from '../types';
import { formatTime, formatDuration, calcHours, getCurrentGps, calcDistanceKm } from '../utils/helpers';
import { supabase } from '../lib/supabase';

interface TeamLeaderPortalProps {
  profile: Profile;
  onGpsUpdate?: (data: { startCoords: { lat: number; lng: number } | null; stopCoords: { lat: number; lng: number } | null }) => void;
}

export const TeamLeaderPortal: React.FC<TeamLeaderPortalProps> = ({ profile, onGpsUpdate }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [allTechs, setAllTechs] = useState<Profile[]>([]);
  const [selectedClient, setSelectedClient] = useState<number>(0);
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [activeSession, setActiveSession] = useState<TeamSession | null>(null);
  const [sessionEntries, setSessionEntries] = useState<TimeEntry[]>([]);

  const [elapsed, setElapsed] = useState('00:00:00');
  const [notes, setNotes] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const [gpsStatus, setGpsStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [startCoords, setStartCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [stopCoords, setStopCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showAddTech, setShowAddTech] = useState(false);
  const [busyTechs, setBusyTechs] = useState<Record<string, string>>({});  // techId -> client name
  const [techDropdownOpen, setTechDropdownOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Sync GPS data to sidebar
  useEffect(() => {
    onGpsUpdate?.({ startCoords, stopCoords });
  }, [startCoords, stopCoords]);

  // Clean up GPS on unmount
  useEffect(() => {
    return () => { onGpsUpdate?.({ startCoords: null, stopCoords: null }); };
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
      .sort((a: Client, b: Client) => {
        const aInternal = a.service_type === 'INTERNAL' ? 0 : 1;
        const bInternal = b.service_type === 'INTERNAL' ? 0 : 1;
        if (aInternal !== bInternal) return aInternal - bInternal;
        return a.name.localeCompare(b.name);
      });
    setClients(assignedClients);

    // Get all non-admin users excluding self for multi-select
    const { data: techData } = await supabase
      .from('profiles')
      .select('*')
      .neq('role', 'admin')
      .neq('id', profile.id)
      .order('name');
    setAllTechs((techData || []) as Profile[]);

    // Find techs currently clocked in (to grey them out)
    const { data: activeEntries } = await supabase
      .from('time_entries')
      .select('tech_id, clients(name)')
      .is('end_time', null);
    const busyMap: Record<string, string> = {};
    (activeEntries || []).forEach((e: any) => {
      busyMap[e.tech_id] = e.clients?.name || 'another account';
    });
    setBusyTechs(busyMap);

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
        .select('*, clients(name, account_number), profiles!time_entries_tech_id_fkey(name)')
        .eq('session_id', session.id)
        .is('end_time', null);
      setSessionEntries((entries || []) as unknown as TimeEntry[]);
      // Load leader's own entry notes as session notes
      const leaderEntry = (entries || []).find((e: any) => e.tech_id === profile.id);
      if (leaderEntry) setSessionNotes((leaderEntry as any).notes || '');
    } else {
      setActiveSession(null);
      setSessionEntries([]);
    }


  }

  async function handleStartSession() {
    if (!selectedClient) return;
    setLoading(true);
    setGpsStatus('Checking status...');
    setStopCoords(null);

    // Prevent double session — check BOTH team_sessions AND time_entries for leader
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

    // Also check if leader has a stale time_entry without a team_session (prevents stuck states)
    const { data: leaderOpenEntries } = await supabase
      .from('time_entries')
      .select('id, clients(name)')
      .eq('tech_id', profile.id)
      .is('end_time', null)
      .limit(1);

    if (leaderOpenEntries && leaderOpenEntries.length > 0) {
      const clientName = (leaderOpenEntries[0].clients as any)?.name || 'another client';
      setGpsStatus(`⚠️ You have an open time entry at ${clientName}. Please clock out first.`);
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

    // Real-time DB check: find which selected techs are ACTUALLY busy right now
    // (not relying on potentially stale busyTechs state)
    const allCandidates = [...selectedTechs];
    let actuallyBusy: Set<string> = new Set();
    if (allCandidates.length > 0) {
      const { data: busyNow } = await supabase
        .from('time_entries')
        .select('tech_id')
        .in('tech_id', allCandidates)
        .is('end_time', null);
      (busyNow || []).forEach((e: any) => actuallyBusy.add(e.tech_id));
    }
    const availableSelected = allCandidates.filter(id => !actuallyBusy.has(id));

    // Create time entries for leader + all available selected techs
    const allPeople = [profile.id, ...availableSelected];
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

  async function saveSessionNotes() {
    if (!activeSession) return;
    // Save notes to all open entries in this session
    await supabase.from('time_entries').update({ notes: sessionNotes }).eq('session_id', activeSession.id).is('end_time', null);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  }

  async function handleStopSession() {
    if (!activeSession) return;
    setLoading(true);
    setGpsStatus('Acquiring stop GPS...');

    try {
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
      const { error: sessionErr } = await supabase.from('team_sessions').update({
        end_time: now,
        stop_lat: lat,
        stop_lng: lng,
        distance_km: distance,
      }).eq('id', activeSession.id);

      if (sessionErr) {
        console.error('Session update error:', sessionErr);
        setGpsStatus('⚠️ Session close had an error — still closing entries...');
      }

      // Update ALL open entries in this session
      const { error: entriesErr } = await supabase.from('time_entries').update({
        end_time: now,
        stop_lat: lat,
        stop_lng: lng,
        distance_km: distance,
        notes: sessionNotes || undefined,
      }).eq('session_id', activeSession.id).is('end_time', null);

      if (entriesErr) {
        console.error('Entries update error:', entriesErr);
      }

      setActiveSession(null);
      setSessionEntries([]);
      setElapsed('00:00:00');
      await loadData();
    } catch (err) {
      console.error('Clock-out error:', err);
      setGpsStatus('⚠️ Clock-out failed — please try again');
    } finally {
      setLoading(false);
    }
  }

  async function handleClockOutSingleTech(entryId: number) {
    if (!activeSession) return;
    setLoading(true);
    setGpsStatus('Acquiring stop GPS...');

    try {
      let lat: number | null = null;
      let lng: number | null = null;

      try {
        const coords = await getCurrentGps();
        lat = coords.lat;
        lng = coords.lng;
        setGpsStatus(`Stop GPS acquired ✓ (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`);
      } catch {
        setGpsStatus('Stop GPS unavailable');
      }

      const now = new Date().toISOString();

      // Calculate distance from session start
      let distance: number | null = null;
      if (activeSession.start_lat != null && activeSession.start_lng != null && lat != null && lng != null) {
        distance = calcDistanceKm(activeSession.start_lat, activeSession.start_lng, lat, lng);
      }

      const { error } = await supabase.from('time_entries').update({
        end_time: now,
        stop_lat: lat,
        stop_lng: lng,
        distance_km: distance,
      }).eq('id', entryId);

      if (error) {
        console.error('Individual clock-out error:', error);
        setGpsStatus('Failed to clock out: ' + error.message);
      }

      await loadData();
    } catch (err) {
      console.error('Clock-out error:', err);
      setGpsStatus('⚠️ Clock-out failed — please try again');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddTech(techId: string) {
    if (!activeSession) return;
    setLoading(true);

    // Real-time DB check: verify tech is not already clocked in
    const { data: openEntries } = await supabase
      .from('time_entries')
      .select('id, clients(name)')
      .eq('tech_id', techId)
      .is('end_time', null)
      .limit(1);

    if (openEntries && openEntries.length > 0) {
      const clientName = (openEntries[0].clients as any)?.name || 'another account';
      setGpsStatus(`⚠️ Tech is already clocked in at ${clientName}`);
      setLoading(false);
      await loadData();
      return;
    }

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
      setGpsStatus('Failed to add tech: ' + error.message);
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


  const techsInSession = sessionEntries.map(e => e.tech_id);
  const availableTechsToAdd = allTechs.filter(t => !techsInSession.includes(t.id));

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Users size={22} className="text-primary" />
        {profile.name}&apos;s Team Portal
      </h2>

      {/* Clock In / Active Session Card */}
      <div className={`card ${activeSession ? 'bg-success/10 border border-success/30' : 'bg-base-200'}`}>
        <div className="card-body p-5 sm:p-6 space-y-4">
          {!activeSession ? (
            <>
              {/* Client Select */}
              <select
                className="select select-bordered w-full"
                value={selectedClient}
                onChange={e => setSelectedClient(Number(e.target.value))}
              >
                <option value={0}>Select an assigned client...</option>
                {clients.filter(c => c.service_type === 'INTERNAL').length > 0 && (
                  <optgroup label="⏱️ Time Activities">
                    {clients.filter(c => c.service_type === 'INTERNAL').map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                )}
                {clients.filter(c => c.service_type !== 'INTERNAL').length > 0 && (
                  <optgroup label="📍 Client Accounts">
                    {clients.filter(c => c.service_type !== 'INTERNAL').map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.account_number})</option>
                    ))}
                  </optgroup>
                )}
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
                            onClick={() => setSelectedTechs(allTechs.filter(t => !busyTechs[t.id]).map(t => t.id))}
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
                        {allTechs.map(tech => {
                          const isBusy = !!busyTechs[tech.id];
                          return (
                            <label
                              key={tech.id}
                              className={`flex items-center gap-3 px-3 py-2 ${isBusy ? 'opacity-40 cursor-not-allowed' : 'hover:bg-base-200 cursor-pointer'}`}
                              title={isBusy ? `Currently clocked in at ${busyTechs[tech.id]}` : ''}
                            >
                              <input
                                type="checkbox"
                                className="checkbox checkbox-sm checkbox-primary"
                                checked={selectedTechs.includes(tech.id)}
                                onChange={() => !isBusy && toggleTech(tech.id)}
                                disabled={isBusy}
                              />
                              <div className="flex-1">
                                <p className="text-sm font-medium">{tech.name}</p>
                                <p className="text-xs text-base-content/50">
                                  {isBusy
                                    ? `🔴 On clock at ${busyTechs[tech.id]}`
                                    : `${tech.role === 'team_leader' ? '👑 Team Leader' : '🔧 Technician'} • $${Number(tech.hourly_rate).toFixed(2)}/hr`}
                                </p>
                              </div>
                            </label>
                          );
                        })}
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
                        <div className="flex items-center gap-2">
                          <span className="badge badge-sm badge-ghost font-mono">
                            {formatDuration(entryHours)}
                          </span>
                          {!isLeader && (
                            <button
                              className="btn btn-xs btn-error btn-outline"
                              onClick={() => handleClockOutSingleTech(entry.id)}
                              disabled={loading}
                              title={`Clock out ${(entry.profiles as any)?.name}`}
                            >
                              <Square size={10} />
                            </button>
                          )}
                        </div>
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
                        {availableTechsToAdd.map(tech => {
                          const isBusy = !!busyTechs[tech.id];
                          return (
                            <button
                              key={tech.id}
                              className={`btn btn-sm btn-ghost w-full justify-start ${isBusy ? 'opacity-40' : ''}`}
                              onClick={() => handleAddTech(tech.id)}
                              disabled={loading || isBusy}
                              title={isBusy ? `Currently clocked in at ${busyTechs[tech.id]}` : ''}
                            >
                              <Plus size={14} /> {tech.name}
                              <span className="text-xs text-base-content/50 ml-auto">
                                {isBusy ? `🔴 On clock` : tech.role === 'team_leader' ? 'Leader' : 'Tech'}
                              </span>
                            </button>
                          );
                        })}
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

              {/* Session Notes */}
              <div className="space-y-2">
                <textarea
                  className="textarea textarea-bordered w-full text-sm"
                  placeholder="Add job notes for this session..."
                  rows={2}
                  value={sessionNotes}
                  onChange={e => { setSessionNotes(e.target.value); setNotesSaved(false); }}
                />
                <button
                  className={`btn btn-sm w-full ${notesSaved ? 'btn-success' : 'btn-outline btn-primary'}`}
                  onClick={saveSessionNotes}
                  disabled={notesSaved}
                >
                  {notesSaved ? '✓ Notes Saved' : '💾 Save Notes'}
                </button>
              </div>

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




    </div>
  );
};
