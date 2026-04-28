import React from 'react';
import { LayoutDashboard, Briefcase, DollarSign, Clock, Users, LogOut, CalendarDays, UserCheck, X } from 'lucide-react';
import { AppView, Profile } from '../types';
import { supabase } from '../lib/supabase';
import { MapView } from './MapView';

interface SidebarProps {
  profile: Profile;
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  gpsData?: { startCoords: { lat: number; lng: number } | null; stopCoords: { lat: number; lng: number } | null };
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ profile, currentView, onNavigate, gpsData, onClose }) => {
  const isAdmin = profile.role === 'admin';
  const isLeader = profile.role === 'team_leader';
  const isTech = profile.role === 'tech';

  const navItems: { view: AppView; label: string; icon: React.ReactNode }[] = [];

  if (isAdmin) {
    navItems.push(
      { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
      { view: 'clients', label: 'Clients', icon: <Briefcase size={18} /> },
      { view: 'pay-report', label: 'Pay Report', icon: <DollarSign size={18} /> },
      { view: 'user-management', label: 'Technicians', icon: <Users size={18} /> },
      { view: 'schedule', label: 'Schedule', icon: <CalendarDays size={18} /> },
      { view: 'tech-portal', label: 'Tech Portal', icon: <Clock size={18} /> },
    );
  }

  if (isLeader) {
    navItems.push(
      { view: 'team-leader-portal', label: 'Team Portal', icon: <UserCheck size={18} /> },
      { view: 'schedule', label: 'Schedule', icon: <CalendarDays size={18} /> },
      { view: 'tech-portal', label: 'My Timesheet', icon: <Clock size={18} /> },
    );
  }

  if (isTech) {
    navItems.push(
      { view: 'schedule', label: 'My Schedule', icon: <CalendarDays size={18} /> },
      { view: 'tech-portal', label: 'My Timesheet', icon: <Clock size={18} /> },
    );
  }

  const roleLabel = isAdmin ? 'ADMIN' : isLeader ? 'TEAM LEADER' : 'TECH';
  const roleBadge = isAdmin ? 'badge-secondary' : isLeader ? 'badge-accent' : 'badge-primary';

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  function handleNav(view: AppView) {
    onNavigate(view);
    onClose?.();
  }

  return (
    <div className="w-64 bg-base-200 flex flex-col h-full border-r border-base-300">
      <div className="p-4 border-b border-base-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/spcs-logo.png" alt="SPCS" className="h-9" />
            <div>
              <h2 className="font-black text-xs tracking-wider leading-tight" style={{ fontFamily: "'Waukegan LDO Black', 'Arial Black', sans-serif" }}>SCIENTIFIC PEST</h2>
              <h2 className="font-black text-xs tracking-wider leading-tight" style={{ fontFamily: "'Waukegan LDO Black', 'Arial Black', sans-serif" }}>CONTROL SERVICES</h2>
            </div>
          </div>
          {/* Close button on mobile */}
          <button className="btn btn-ghost btn-xs md:hidden" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-base-content/50 mt-2 truncate">{profile.name}</p>
        <span className={`badge badge-xs ${roleBadge} mt-1`}>{roleLabel}</span>
      </div>

      <ul className="menu menu-sm flex-1 p-2 gap-0.5">
        {navItems.map(item => (
          <li key={item.view}>
            <a
              className={currentView === item.view ? 'active font-semibold' : ''}
              onClick={() => handleNav(item.view)}
            >
              {item.icon}
              {item.label}
            </a>
          </li>
        ))}
      </ul>

      {/* GPS Map */}
      {gpsData && (gpsData.startCoords || gpsData.stopCoords) && (
        <div className="p-2 border-t border-base-300">
          <p className="text-xs font-semibold mb-1 px-1 text-base-content/70">📍 GPS Location</p>
          <MapView startCoords={gpsData.startCoords} stopCoords={gpsData.stopCoords} height="160px" />
          <div className="flex gap-3 mt-1 px-1 text-xs text-base-content/50">
            {gpsData.startCoords && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-success rounded-full inline-block" /> Start
              </span>
            )}
            {gpsData.stopCoords && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-error rounded-full inline-block" /> Stop
              </span>
            )}
          </div>
        </div>
      )}

      <div className="p-2 border-t border-base-300 mt-auto">
        <button className="btn btn-ghost btn-sm w-full justify-start text-error" onClick={handleLogout}>
          <LogOut size={16} /> Sign Out
        </button>
      </div>

      {/* Copyright */}
      <div className="px-3 py-2 border-t border-base-300 text-center">
        <p className="text-[9px] text-base-content/40 leading-tight">
          © {new Date().getFullYear()} Sequoia Quality Solutions™
        </p>
        <p className="text-[8px] text-base-content/30 leading-tight">
          Field Service Time Tracker™
        </p>
      </div>
    </div>
  );
};
