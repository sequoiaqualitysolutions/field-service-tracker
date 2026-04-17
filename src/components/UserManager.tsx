import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit, Trash2, X, Shield, Wrench } from 'lucide-react';
import { Profile } from '../types';
import { supabase } from '../lib/supabase';

export const UserManager: React.FC = () => {
  const [users, setUsers] = useState<Profile[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'tech', hourly_rate: '25.00' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    const { data } = await supabase.from('profiles').select('*').order('name');
    setUsers((data || []) as Profile[]);
  }

  async function getAuthToken(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || '';
  }

  function openAdd() {
    setEditing(null);
    setForm({ email: '', password: '', name: '', role: 'tech', hourly_rate: '25.00' });
    setError('');
    setShowModal(true);
  }

  function openEdit(u: Profile) {
    setEditing(u);
    setForm({ email: u.email, password: '', name: u.name, role: u.role, hourly_rate: String(u.hourly_rate) });
    setError('');
    setShowModal(true);
  }

  async function handleSave() {
    setLoading(true);
    setError('');
    const token = await getAuthToken();

    if (editing) {
      // Update profile via Netlify function
      const res = await fetch('/api/admin-users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: editing.id,
          name: form.name,
          role: form.role,
          hourly_rate: parseFloat(form.hourly_rate),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Update failed'); setLoading(false); return; }
    } else {
      // Create user via Netlify function
      if (!form.email || !form.password || !form.name) {
        setError('Email, password, and name are required');
        setLoading(false);
        return;
      }
      const res = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          name: form.name,
          role: form.role,
          hourly_rate: parseFloat(form.hourly_rate),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Create failed'); setLoading(false); return; }
    }

    setShowModal(false);
    setLoading(false);
    loadUsers();
  }

  async function handleDelete(user: Profile) {
    if (!confirm(`Delete ${user.name}? This removes their account and all time entries.`)) return;
    const token = await getAuthToken();
    const res = await fetch('/api/admin-users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: user.id }),
    });
    if (res.ok) loadUsers();
  }

  const techCount = users.filter(u => u.role === 'tech').length;
  const adminCount = users.filter(u => u.role === 'admin').length;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Users size={22} className="text-primary" /> User Management
        </h2>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <Plus size={16} /> Add User
        </button>
      </div>

      <div className="flex gap-3">
        <div className="badge badge-lg gap-1"><Wrench size={14} /> {techCount} Technicians</div>
        <div className="badge badge-lg badge-secondary gap-1"><Shield size={14} /> {adminCount} Admins</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {users.map(u => (
          <div key={u.id} className="card bg-base-200">
            <div className="card-body p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{u.name}</p>
                  <p className="text-xs text-base-content/50">{u.email}</p>
                </div>
                <div className="flex gap-1">
                  <button className="btn btn-ghost btn-xs" onClick={() => openEdit(u)}><Edit size={14} /></button>
                  <button className="btn btn-ghost btn-xs text-error" onClick={() => handleDelete(u)}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className={`badge badge-sm ${u.role === 'admin' ? 'badge-secondary' : 'badge-primary'}`}>
                  {u.role === 'admin' ? <><Shield size={10} /> Admin</> : <><Wrench size={10} /> Tech</>}
                </span>
                <span className="text-xs text-base-content/60">${Number(u.hourly_rate).toFixed(2)}/hr</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {users.length === 0 && (
        <div className="text-center py-12 text-base-content/50">
          <Users size={48} className="mx-auto mb-3 opacity-30" />
          <p>No users yet. Add your first technician above.</p>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">{editing ? 'Edit User' : 'Add User'}</h3>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            {error && <div className="alert alert-error py-2 text-sm mb-3"><span>{error}</span></div>}
            <div className="space-y-3">
              <input className="input input-bordered w-full" placeholder="Full Name"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <input className="input input-bordered w-full" placeholder="Email Address"
                value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} disabled={!!editing} />
              {!editing && (
                <input className="input input-bordered w-full" placeholder="Password (min 6 characters)" type="password"
                  value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              )}
              <div className="grid grid-cols-2 gap-3">
                <select className="select select-bordered w-full" value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="tech">Technician</option>
                  <option value="admin">Admin</option>
                </select>
                <input className="input input-bordered w-full" placeholder="Hourly Rate" type="number" step="0.01"
                  value={form.hourly_rate} onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))} />
              </div>
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={loading || !form.name}>
                {loading ? 'Saving...' : editing ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowModal(false)} />
        </div>
      )}
    </div>
  );
};
