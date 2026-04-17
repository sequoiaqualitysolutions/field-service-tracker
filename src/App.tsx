import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { Profile, AppView } from './types';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { TechPortal } from './components/TechPortal';
import { AdminDashboard } from './components/AdminDashboard';
import { PayReport } from './components/PayReport';
import { ClientManager } from './components/ClientManager';
import { UserManager } from './components/UserManager';

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<AppView>('tech-portal');

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
      setCurrentView(p.role === 'admin' ? 'dashboard' : 'tech-portal');
    }
    setLoading(false);
  }

  function handleLogin() {
    checkSession();
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
      case 'dashboard': return <AdminDashboard />;
      case 'clients': return <ClientManager />;
      case 'pay-report': return <PayReport />;
      case 'user-management': return <UserManager />;
      case 'tech-portal': return <TechPortal profile={profile!} />;
      default: return <TechPortal profile={profile!} />;
    }
  }

  return (
    <div className="flex h-screen bg-base-300">
      <Sidebar profile={profile} currentView={currentView} onNavigate={setCurrentView} />
      <div className="flex-1 overflow-auto">
        {renderView()}
      </div>
    </div>
  );
}
