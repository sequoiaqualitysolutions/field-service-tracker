import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile, SQSClient } from '../types';

interface Props {
  profile: Profile;
  onLogout: () => void;
}

type SQSView = 'dashboard' | 'clients' | 'client-detail';

interface Overview {
  activeClients: number;
  totalUsers: number;
  monthlyRevenue: number;
  hoursThisMonth: number;
  flagsThisMonth: number;
}

interface ClientDetail extends SQSClient {
  users_by_role?: { admin: number; team_leader: number; tech: number };
  monthly_hours?: { month: string; hours: number }[];
}

const STATUS_BADGE: Record<string, string> = {
  active: 'badge-success',
  inactive: 'badge-error',
  trial: 'badge-warning',
  suspended: 'badge-error',
};

const TIER_HINTS: Record<string, string> = {
  standard: '$49/mo base',
  growth: '$99/mo base',
  enterprise: '$249/mo base',
  custom: 'Custom pricing',
};

const emptyForm = (): Partial<SQSClient> => ({
  company_name: '',
  display_name: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  site_url: '',
  status: 'active',
  pricing_tier: 'standard',
  monthly_rate: 0,
  billing_start_date: '',
  billing_notes: '',
});

export const SQSAdminDashboard: React.FC<Props> = ({ profile, onLogout }) => {
  const [view, setView] = useState<SQSView>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [clients, setClients] = useState<SQSClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientDetail | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'billing' | 'usage'>('info');

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editForm, setEditForm] = useState<Partial<SQSClient>>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);

  // Edit forms for detail view
  const [infoForm, setInfoForm] = useState<Partial<SQSClient>>({});
  const [billingForm, setBillingForm] = useState<Partial<SQSClient>>({});

  const apiFetch = useCallback(async (action: string, method = 'GET', body?: any) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const opts: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const url = `/api/sqs-admin?action=${action}`;
    const res = await fetch(url, opts);
    return res.json();
  }, []);

  const loadOverview = useCallback(async () => {
    const data = await apiFetch('overview');
    if (data && !data.error) setOverview(data);
  }, [apiFetch]);

  const loadClients = useCallback(async () => {
    const data = await apiFetch('clients');
    if (Array.isArray(data)) setClients(data);
  }, [apiFetch]);

  const loadClientDetail = useCallback(async (id: string) => {
    const data = await apiFetch(`client&id=${id}`);
    if (data && !data.error) {
      setSelectedClient(data);
      setInfoForm({
        company_name: data.company_name,
        display_name: data.display_name,
        contact_name: data.contact_name || '',
        contact_email: data.contact_email || '',
        contact_phone: data.contact_phone || '',
        site_url: data.site_url || '',
        status: data.status,
      });
      setBillingForm({
        pricing_tier: data.pricing_tier,
        monthly_rate: data.monthly_rate,
        billing_start_date: data.billing_start_date || '',
        billing_notes: data.billing_notes || '',
      });
    }
  }, [apiFetch]);

  useEffect(() => {
    async function init() {
      setLoadingData(true);
      await Promise.all([loadOverview(), loadClients()]);
      setLoadingData(false);
    }
    init();
  }, [loadOverview, loadClients]);

  useEffect(() => {
    if (selectedClientId) {
      loadClientDetail(selectedClientId);
    }
  }, [selectedClientId, loadClientDetail]);

  function openAddModal() {
    setEditForm(emptyForm());
    setEditingId(null);
    setShowModal(true);
  }

  function openEditModal(client: SQSClient) {
    setEditForm({ ...client });
    setEditingId(client.id);
    setShowModal(true);
  }

  async function handleSaveModal() {
    setSaving(true);
    if (editingId) {
      await apiFetch('clients', 'PUT', { id: editingId, ...editForm });
    } else {
      await apiFetch('clients', 'POST', editForm);
    }
    await loadClients();
    await loadOverview();
    setShowModal(false);
    setSaving(false);
  }

  async function handleSaveInfo() {
    if (!selectedClient) return;
    setSaving(true);
    await apiFetch('clients', 'PUT', { id: selectedClient.id, ...infoForm });
    await loadClientDetail(selectedClient.id);
    await loadClients();
    setSaving(false);
  }

  async function handleSaveBilling() {
    if (!selectedClient) return;
    setSaving(true);
    await apiFetch('clients', 'PUT', { id: selectedClient.id, ...billingForm });
    await loadClientDetail(selectedClient.id);
    await loadClients();
    await loadOverview();
    setSaving(false);
  }

  function viewClientDetail(id: string) {
    setSelectedClientId(id);
    setActiveTab('info');
    setView('client-detail');
  }

  // Helper: get initials
  function initials(name: string) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  // ======= SIDEBAR =======
  const sidebarContent = (
    <div className="flex flex-col h-full w-[260px] bg-base-200 border-r border-base-content/10">
      {/* Logo area */}
      <div className="p-5 border-b border-base-content/10">
        <div className="flex items-center gap-3">
          <img src="/sqs-logo.svg" alt="SQS" className="h-10 w-10" />
          <div>
            <p className="text-sm font-bold text-primary" style={{ fontFamily: 'Montserrat, sans-serif' }}>Sequoia Admin</p>
            <p className="text-[10px] text-base-content/50">Platform Management</p>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        <button
          onClick={() => { setView('dashboard'); setSidebarOpen(false); }}
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            view === 'dashboard' ? 'bg-primary/10 text-primary border-l-2 border-primary' : 'text-base-content/70 hover:bg-base-300 hover:text-base-content'
          }`}
        >
          <span>📊</span> Dashboard
        </button>
        <button
          onClick={() => { setView('clients'); setSidebarOpen(false); }}
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            (view === 'clients' || view === 'client-detail') ? 'bg-primary/10 text-primary border-l-2 border-primary' : 'text-base-content/70 hover:bg-base-300 hover:text-base-content'
          }`}
        >
          <span>🏢</span> Clients
        </button>
        <button
          onClick={() => { window.location.href = '/login'; }}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-base-content/70 hover:bg-base-300 hover:text-base-content transition-colors"
        >
          <span>👥</span> Users
        </button>
      </nav>

      {/* New Client button */}
      <div className="px-4 pb-3">
        <button className="btn btn-primary btn-sm w-full gap-1" onClick={openAddModal}>
          + New Client
        </button>
      </div>

      {/* Footer links */}
      <div className="px-4 pb-4 space-y-2 border-t border-base-content/10 pt-3">
        <a
          href="/login"
          className="text-xs text-base-content/50 hover:text-primary flex items-center gap-1"
        >
          ↗ View Client Portal
        </a>
        <button
          onClick={onLogout}
          className="text-xs text-error/70 hover:text-error flex items-center gap-1"
        >
          ← Sign Out
        </button>
        <p className="text-[10px] text-base-content/30 mt-2">
          Logged in as {profile.name}
        </p>
      </div>
    </div>
  );

  // ======= DASHBOARD VIEW =======
  function renderDashboard() {
    if (!overview) {
      return (
        <div className="flex items-center justify-center h-64">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      );
    }

    const cards = [
      { label: 'Active Clients', value: overview.activeClients, icon: '🏢', color: 'border-l-primary', sub: 'client accounts' },
      { label: 'Total Users', value: overview.totalUsers, icon: '👥', color: 'border-l-success', sub: 'across all clients' },
      { label: 'Hours This Month', value: overview.hoursThisMonth.toLocaleString(), icon: '⏱', color: 'border-l-info', sub: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) },
      { label: 'Flags', value: overview.flagsThisMonth, icon: '⚑', color: 'border-l-warning', sub: 'this month' },
      { label: 'Monthly Revenue', value: `$${overview.monthlyRevenue.toLocaleString()}`, icon: '💰', color: 'border-l-secondary', sub: 'recurring' },
    ];

    return (
      <div>
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-base-content">Admin Dashboard</h1>
          <p className="text-sm text-base-content/50">Sequoia Quality Solutions — Platform Overview</p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {cards.map((c, i) => (
            <div key={i} className={`bg-base-100 border border-base-content/10 rounded-xl p-4 border-l-4 ${c.color}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-base-content/50 mb-1">{c.label}</p>
                  <p className="text-3xl font-bold text-base-content">{c.value}</p>
                  <p className="text-[11px] text-base-content/40 mt-1">{c.sub}</p>
                </div>
                <span className="text-2xl opacity-30">{c.icon}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Client Accounts section */}
        <div className="bg-base-100 border border-base-content/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-base-content">Client Accounts</h2>
            <button className="text-sm text-primary hover:underline" onClick={() => setView('clients')}>
              View All →
            </button>
          </div>
          <div className="space-y-3">
            {clients.slice(0, 5).map(c => (
              <div
                key={c.id}
                className="flex items-center gap-4 p-3 rounded-lg bg-base-200/50 hover:bg-base-200 cursor-pointer transition-colors"
                onClick={() => viewClientDetail(c.id)}
              >
                <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">
                  {initials(c.display_name || c.company_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-base-content truncate">{c.company_name}</p>
                  <p className="text-xs text-base-content/50">{c.user_count || 0} users</p>
                </div>
                <span className={`badge badge-sm ${STATUS_BADGE[c.status] || 'badge-ghost'}`}>
                  {c.status}
                </span>
                <span className="text-sm text-base-content/60">${Number(c.monthly_rate).toFixed(0)}/mo</span>
              </div>
            ))}
            {clients.length === 0 && (
              <p className="text-sm text-base-content/40 text-center py-4">No clients yet</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ======= CLIENTS VIEW =======
  function renderClients() {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-base-content">Client Accounts</h1>
            <p className="text-sm text-base-content/50">Manage all platform clients</p>
          </div>
          <button className="btn btn-primary btn-sm gap-1" onClick={openAddModal}>
            + Add Client
          </button>
        </div>

        <div className="bg-base-100 border border-base-content/10 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-3 bg-base-200/50 text-xs text-base-content/50 font-medium">
            <div className="col-span-3">Company</div>
            <div className="col-span-2">Display Name</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2">Tier</div>
            <div className="col-span-1 text-right">Rate</div>
            <div className="col-span-1 text-right">Users</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          {/* Table rows */}
          {clients.map(c => (
            <div
              key={c.id}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 px-5 py-3 border-t border-base-content/5 hover:bg-base-200/30 transition-colors items-center"
            >
              <div className="col-span-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                  {initials(c.display_name || c.company_name)}
                </div>
                <span className="text-sm font-medium text-base-content truncate">{c.company_name}</span>
              </div>
              <div className="col-span-2 text-sm text-base-content/70">{c.display_name}</div>
              <div className="col-span-1">
                <span className={`badge badge-sm ${STATUS_BADGE[c.status] || 'badge-ghost'}`}>{c.status}</span>
              </div>
              <div className="col-span-2 text-sm text-base-content/60 capitalize">{c.pricing_tier}</div>
              <div className="col-span-1 text-sm text-base-content text-right">${Number(c.monthly_rate).toFixed(0)}</div>
              <div className="col-span-1 text-sm text-base-content/60 text-right">{c.user_count || 0}</div>
              <div className="col-span-2 flex justify-end gap-2">
                <button className="btn btn-ghost btn-xs" onClick={() => openEditModal(c)}>Edit</button>
                <button className="btn btn-primary btn-xs" onClick={() => viewClientDetail(c.id)}>View</button>
              </div>
            </div>
          ))}

          {clients.length === 0 && (
            <div className="text-center py-8 text-base-content/40 text-sm">
              No clients found. Add your first client to get started.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ======= CLIENT DETAIL VIEW =======
  function renderClientDetail() {
    if (!selectedClient) {
      return (
        <div className="flex items-center justify-center h-64">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      );
    }

    const rate = Number(billingForm.monthly_rate || 0);

    return (
      <div>
        {/* Back button */}
        <button
          className="btn btn-ghost btn-sm mb-4 gap-1"
          onClick={() => { setView('clients'); setSelectedClient(null); setSelectedClientId(null); }}
        >
          ← Back to Clients
        </button>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xl font-bold">
              {initials(selectedClient.display_name || selectedClient.company_name)}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-base-content flex items-center gap-3">
                {selectedClient.company_name}
                <span className={`badge ${STATUS_BADGE[selectedClient.status] || 'badge-ghost'}`}>{selectedClient.status}</span>
              </h1>
              <p className="text-sm text-base-content/50">
                {selectedClient.contact_name && <span>{selectedClient.contact_name} · </span>}
                {selectedClient.contact_email && <span>{selectedClient.contact_email}</span>}
              </p>
            </div>
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-base-100 border border-base-content/10 rounded-xl p-4 border-l-4 border-l-success">
            <p className="text-xs text-base-content/50">Users</p>
            <p className="text-2xl font-bold">{selectedClient.user_count || 0}</p>
          </div>
          <div className="bg-base-100 border border-base-content/10 rounded-xl p-4 border-l-4 border-l-info">
            <p className="text-xs text-base-content/50">Hours This Month</p>
            <p className="text-2xl font-bold">{selectedClient.hours_this_month || 0}</p>
          </div>
          <div className="bg-base-100 border border-base-content/10 rounded-xl p-4 border-l-4 border-l-warning">
            <p className="text-xs text-base-content/50">Flags</p>
            <p className="text-2xl font-bold">{selectedClient.flags_this_month || 0}</p>
          </div>
          <div className="bg-base-100 border border-base-content/10 rounded-xl p-4 border-l-4 border-l-secondary">
            <p className="text-xs text-base-content/50">Monthly Revenue</p>
            <p className="text-2xl font-bold">${Number(selectedClient.monthly_rate).toFixed(0)}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs tabs-bordered mb-6">
          <button className={`tab ${activeTab === 'info' ? 'tab-active text-primary' : ''}`} onClick={() => setActiveTab('info')}>
            Client Info
          </button>
          <button className={`tab ${activeTab === 'billing' ? 'tab-active text-primary' : ''}`} onClick={() => setActiveTab('billing')}>
            Billing
          </button>
          <button className={`tab ${activeTab === 'usage' ? 'tab-active text-primary' : ''}`} onClick={() => setActiveTab('usage')}>
            Usage Analytics
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'info' && (
          <div className="bg-base-100 border border-base-content/10 rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">Client Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Company Name</span></label>
                <input className="input input-bordered input-sm" value={infoForm.company_name || ''} onChange={e => setInfoForm(f => ({ ...f, company_name: e.target.value }))} />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Display Name</span></label>
                <input className="input input-bordered input-sm" value={infoForm.display_name || ''} onChange={e => setInfoForm(f => ({ ...f, display_name: e.target.value }))} />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Contact Name</span></label>
                <input className="input input-bordered input-sm" value={infoForm.contact_name || ''} onChange={e => setInfoForm(f => ({ ...f, contact_name: e.target.value }))} />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Contact Email</span></label>
                <input className="input input-bordered input-sm" value={infoForm.contact_email || ''} onChange={e => setInfoForm(f => ({ ...f, contact_email: e.target.value }))} />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Contact Phone</span></label>
                <input className="input input-bordered input-sm" value={infoForm.contact_phone || ''} onChange={e => setInfoForm(f => ({ ...f, contact_phone: e.target.value }))} />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Site URL</span></label>
                <input className="input input-bordered input-sm" value={infoForm.site_url || ''} onChange={e => setInfoForm(f => ({ ...f, site_url: e.target.value }))} />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Status</span></label>
                <select className="select select-bordered select-sm" value={infoForm.status || 'active'} onChange={e => setInfoForm(f => ({ ...f, status: e.target.value as any }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="trial">Trial</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button className="btn btn-primary btn-sm gap-1" onClick={handleSaveInfo} disabled={saving}>
                {saving ? <span className="loading loading-spinner loading-xs" /> : '💾'} Save Client Info
              </button>
            </div>
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="bg-base-100 border border-base-content/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">💰</span>
              <h3 className="text-lg font-semibold">Billing & Revenue</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Pricing Tier</span></label>
                <select className="select select-bordered select-sm" value={billingForm.pricing_tier || 'standard'} onChange={e => setBillingForm(f => ({ ...f, pricing_tier: e.target.value as any }))}>
                  <option value="standard">Standard</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="custom">Custom</option>
                </select>
                <label className="label"><span className="label-text-alt text-xs text-base-content/40">{TIER_HINTS[billingForm.pricing_tier || 'standard']}</span></label>
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Monthly Rate ($)</span></label>
                <input type="number" className="input input-bordered input-sm" value={billingForm.monthly_rate || 0} onChange={e => setBillingForm(f => ({ ...f, monthly_rate: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Billing Start Date</span></label>
                <input type="date" className="input input-bordered input-sm" value={billingForm.billing_start_date || ''} onChange={e => setBillingForm(f => ({ ...f, billing_start_date: e.target.value }))} />
              </div>
              <div className="form-control md:col-span-2">
                <label className="label"><span className="label-text text-xs">Billing Notes</span></label>
                <textarea className="textarea textarea-bordered text-sm" rows={3} value={billingForm.billing_notes || ''} onChange={e => setBillingForm(f => ({ ...f, billing_notes: e.target.value }))} />
              </div>
            </div>

            {/* Revenue summary */}
            <div className="mt-5 bg-base-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-base-content/70 mb-2">Revenue Summary</p>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-primary">${rate.toFixed(2)}</p>
                  <p className="text-xs text-base-content/50">Monthly</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">${(rate * 3).toFixed(2)}</p>
                  <p className="text-xs text-base-content/50">Quarterly</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">${(rate * 12).toFixed(2)}</p>
                  <p className="text-xs text-base-content/50">Annual</p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button className="btn btn-primary btn-sm gap-1" onClick={handleSaveBilling} disabled={saving}>
                {saving ? <span className="loading loading-spinner loading-xs" /> : '💾'} Save Billing Info
              </button>
            </div>
          </div>
        )}

        {activeTab === 'usage' && (
          <div className="space-y-6">
            {/* Monthly hours chart */}
            <div className="bg-base-100 border border-base-content/10 rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Monthly Hours (Last 6 Months)</h3>
              {selectedClient.monthly_hours && selectedClient.monthly_hours.length > 0 ? (
                <div className="flex items-end gap-3 h-48">
                  {(() => {
                    const maxH = Math.max(...selectedClient.monthly_hours.map(m => m.hours), 1);
                    return selectedClient.monthly_hours.map((m, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                        <p className="text-xs font-bold text-primary mb-1">{m.hours}</p>
                        <div
                          className="w-full bg-primary/80 rounded-t-md transition-all duration-300"
                          style={{ height: `${Math.max((m.hours / maxH) * 100, 2)}%`, minHeight: '4px' }}
                        />
                        <p className="text-[10px] text-base-content/50 mt-2 text-center">{m.month}</p>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <p className="text-sm text-base-content/40 text-center py-8">No data available</p>
              )}
            </div>

            {/* Users by role */}
            <div className="bg-base-100 border border-base-content/10 rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Users by Role</h3>
              {selectedClient.users_by_role ? (
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-base-200 rounded-lg p-4">
                    <p className="text-2xl font-bold text-base-content">{selectedClient.users_by_role.admin}</p>
                    <p className="text-xs text-base-content/50">Admin</p>
                  </div>
                  <div className="bg-base-200 rounded-lg p-4">
                    <p className="text-2xl font-bold text-base-content">{selectedClient.users_by_role.team_leader}</p>
                    <p className="text-xs text-base-content/50">Team Leaders</p>
                  </div>
                  <div className="bg-base-200 rounded-lg p-4">
                    <p className="text-2xl font-bold text-base-content">{selectedClient.users_by_role.tech}</p>
                    <p className="text-xs text-base-content/50">Technicians</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-base-content/40">No role data</p>
              )}
            </div>

            {/* Flags */}
            <div className="bg-base-100 border border-base-content/10 rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-2">Flags This Month</h3>
              <p className="text-3xl font-bold text-warning">{selectedClient.flags_this_month || 0}</p>
              <p className="text-xs text-base-content/50 mt-1">GPS distance, short sessions, missing GPS flags</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ======= MODAL =======
  function renderModal() {
    if (!showModal) return null;
    return (
      <div className="modal modal-open">
        <div className="modal-box bg-base-100 max-w-lg">
          <h3 className="font-bold text-lg mb-4">{editingId ? 'Edit Client' : 'Add New Client'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Company Name *</span></label>
              <input className="input input-bordered input-sm" value={editForm.company_name || ''} onChange={e => setEditForm(f => ({ ...f, company_name: e.target.value }))} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Display Name *</span></label>
              <input className="input input-bordered input-sm" value={editForm.display_name || ''} onChange={e => setEditForm(f => ({ ...f, display_name: e.target.value }))} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Contact Name</span></label>
              <input className="input input-bordered input-sm" value={editForm.contact_name || ''} onChange={e => setEditForm(f => ({ ...f, contact_name: e.target.value }))} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Contact Email</span></label>
              <input className="input input-bordered input-sm" value={editForm.contact_email || ''} onChange={e => setEditForm(f => ({ ...f, contact_email: e.target.value }))} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Contact Phone</span></label>
              <input className="input input-bordered input-sm" value={editForm.contact_phone || ''} onChange={e => setEditForm(f => ({ ...f, contact_phone: e.target.value }))} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Site URL</span></label>
              <input className="input input-bordered input-sm" value={editForm.site_url || ''} onChange={e => setEditForm(f => ({ ...f, site_url: e.target.value }))} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Status</span></label>
              <select className="select select-bordered select-sm" value={editForm.status || 'active'} onChange={e => setEditForm(f => ({ ...f, status: e.target.value as any }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="trial">Trial</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Pricing Tier</span></label>
              <select className="select select-bordered select-sm" value={editForm.pricing_tier || 'standard'} onChange={e => setEditForm(f => ({ ...f, pricing_tier: e.target.value as any }))}>
                <option value="standard">Standard</option>
                <option value="growth">Growth</option>
                <option value="enterprise">Enterprise</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Monthly Rate ($)</span></label>
              <input type="number" className="input input-bordered input-sm" value={editForm.monthly_rate || 0} onChange={e => setEditForm(f => ({ ...f, monthly_rate: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Billing Start Date</span></label>
              <input type="date" className="input input-bordered input-sm" value={editForm.billing_start_date || ''} onChange={e => setEditForm(f => ({ ...f, billing_start_date: e.target.value }))} />
            </div>
            <div className="form-control md:col-span-2">
              <label className="label"><span className="label-text text-xs">Billing Notes</span></label>
              <textarea className="textarea textarea-bordered text-sm" rows={2} value={editForm.billing_notes || ''} onChange={e => setEditForm(f => ({ ...f, billing_notes: e.target.value }))} />
            </div>
          </div>
          <div className="modal-action">
            <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleSaveModal} disabled={saving}>
              {saving ? <span className="loading loading-spinner loading-xs" /> : 'Save'}
            </button>
          </div>
        </div>
        <div className="modal-backdrop" onClick={() => setShowModal(false)} />
      </div>
    );
  }

  // ======= MAIN RENDER =======
  const mainContent = (() => {
    switch (view) {
      case 'dashboard': return renderDashboard();
      case 'clients': return renderClients();
      case 'client-detail': return renderClientDetail();
      default: return renderDashboard();
    }
  })();

  return (
    <div className="flex h-screen bg-base-300">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-base-200 border-b border-base-300 px-3 py-2 flex items-center gap-3">
        <button className="btn btn-ghost btn-sm btn-square" onClick={() => setSidebarOpen(true)}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <img src="/sqs-logo.svg" alt="SQS" className="h-7 w-7" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-primary truncate">Sequoia Admin</p>
          <p className="text-[10px] text-base-content/50">Platform Management</p>
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed md:static inset-y-0 left-0 z-50 md:z-auto
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
      `}>
        {sidebarContent}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto pt-12 md:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          {loadingData ? (
            <div className="flex items-center justify-center h-64">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : (
            mainContent
          )}
        </div>
      </div>

      {/* Modal */}
      {renderModal()}
    </div>
  );
};
