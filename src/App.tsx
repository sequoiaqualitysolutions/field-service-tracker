import React, { useState, useEffect } from 'react';
import { Menu } from 'lucide-react';
import { supabase } from './lib/supabase';
import { Profile, AppView } from './types';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { TechPortal } from './components/TechPortal';
import { TeamLeaderPortal } from './components/TeamLeaderPortal';
import { TechSchedule } from './components/TechSchedule';
import { AdminDashboard } from './components/AdminDashboard';
import { PayReport } from './components/PayReport';
import { ClientManager } from './components/ClientManager';
import { UserManager } from './components/UserManager';

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<AppView>('tech-portal');
  const [preselectedClientId, setPreselectedClientId] = useState<number | null>(null);
  const [gpsData, setGpsData] = useState<{ startCoords: { lat: number; lng: number } | null; stopCoords: { lat: number; lng: number } | null }>({ startCoords: null, stopCoords: null });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await loadProfile(session.user.id);
    } else {
      setLoading(false);
    }
  }

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (data) {
      const p = data as Profile;
      setProfile(p);
      // Set default view based on role
      if (p.role === 'admin') {
        setCurrentView('dashboard');
      } else if (p.role === 'team_leader') {
        setCurrentView('team-leader-portal');
      } else {
        setCurrentView('tech-portal');
      }
    }
    setLoading(false);
  }

  function handleLogin() {
    checkSession();
  }

  /** Called from TechSchedule when a tech clicks "Clock In" on a scheduled job */
  function handleScheduleClockIn(clientId: number) {
    setPreselectedClientId(clientId);
    setCurrentView('tech-portal');
  }

  function handleNavigate(view: AppView) {
    setCurrentView(view);
    setSidebarOpen(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-300">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (!profile) {
    return <LoginPage onLogin={handleLogin} />;
  }

  function renderView() {
    switch (currentView) {
      case 'dashboard': return profile?.role === 'admin' ? <AdminDashboard /> : <TeamLeaderPortal profile={profile!} onGpsUpdate={setGpsData} />;
      case 'clients': return <ClientManager />;
      case 'pay-report': return profile?.role === 'admin' ? <PayReport /> : <AdminDashboard />;
      case 'user-management': return <UserManager />;
      case 'schedule': return <TechSchedule profile={profile!} onClockIn={handleScheduleClockIn} />;
      case 'team-leader-portal': return <TeamLeaderPortal profile={profile!} onGpsUpdate={setGpsData} />;
      case 'tech-portal': return <TechPortal profile={profile!} preselectedClientId={preselectedClientId} onClearPreselect={() => setPreselectedClientId(null)} onGpsUpdate={setGpsData} />;
      default: return <TechPortal profile={profile!} preselectedClientId={preselectedClientId} onClearPreselect={() => setPreselectedClientId(null)} onGpsUpdate={setGpsData} />;
    }
  }

  const roleLabel = profile.role === 'admin' ? 'ADMIN' : profile.role === 'team_leader' ? 'TEAM LEADER' : 'TECH';

  return (
    <div className="flex h-screen bg-base-300">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-base-200 border-b border-base-300 px-3 py-2 flex items-center gap-3">
        <button className="btn btn-ghost btn-sm btn-square" onClick={() => setSidebarOpen(true)}>
          <Menu size={22} />
        </button>
        <img src="/sqs-logo.svg" alt="SQS" className="h-7 w-7" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-primary truncate">{profile.name}</p>
          <p className="text-[10px] text-base-content/50">{roleLabel}</p>
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — always visible on md+, drawer on mobile */}
      <div className={`
        fixed md:static inset-y-0 left-0 z-50 md:z-auto
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
      `}>
        <Sidebar
          profile={profile}
          currentView={currentView}
          onNavigate={handleNavigate}
          gpsData={gpsData}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* Main content — add top padding on mobile for the top bar */}
      <div className="flex-1 overflow-auto pt-12 md:pt-0">
        {renderView()}
      </div>
    </div>
  );
}
