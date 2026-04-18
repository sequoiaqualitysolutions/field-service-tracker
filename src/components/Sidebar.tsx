import React from 'react';
import { LayoutDashboard, Briefcase, DollarSign, Clock, Users, LogOut, CalendarDays, UserCheck } from 'lucide-react';
import { AppView, Profile } from '../types';
import { supabase } from '../lib/supabase';
import { MapView } from './MapView';

interface SidebarProps {
  profile: Profile;
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  gpsData?: { startCoords: { lat: number; lng: number } | null; stopCoords: { lat: number; lng: number } | null };
}

export const Sidebar: React.FC<SidebarProps> = ({ profile, currentView, onNavigate, gpsData }) => {
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
      { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
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

  return (
    <div className="w-56 bg-base-200 flex flex-col h-full border-r border-base-300">
      <div className="p-4 border-b border-base-300">
        <div className="flex items-center gap-2 mb-2">
          <img src="/sqs-logo.svg" alt="SQS" className="h-8 w-8" />
          <div>
            <h2 className="font-bold text-xs text-primary tracking-wide leading-tight">SEQUOIA QUALITY</h2>
            <h2 className="font-bold text-xs text-primary tracking-wide leading-tight">SOLUTIONS</h2>
          </div>
        </div>
        <p className="text-xs text-base-content/50 mt-1 truncate">{profile.name}</p>
        <span className={`badge badge-xs ${roleBadge} mt-1`}>{roleLabel}</span>
      </div>

      <ul className="menu menu-sm flex-1 p-2 gap-0.5">
        {navItems.map(item => (
          <li key={item.view}>
            <a
              className={currentView === item.view ? 'active font-semibold' : ''}
              onClick={() => onNavigate(item.view)}
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
    </div>
  );
};
