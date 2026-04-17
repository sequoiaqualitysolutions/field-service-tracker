import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit, Trash2, Building2, X, UserCheck } from 'lucide-react';
import { Client, Profile } from '../types';
import { supabase } from '../lib/supabase';

export const ClientManager: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [techs, setTechs] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState({
    account_number: '', name: '', address: '', contact_name: '',
    contact_phone: '', service_type: '', notes: ''
  });
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>([]);

  useEffect(() => { loadClients(); loadTechs(); }, []);

  async function loadTechs() {
    const { data } = await supabase.from('profiles').select('*').eq('role', 'tech').order('name');
    setTechs((data || []) as Profile[]);
  }

  async function loadClients() {
    const { data } = await supabase
      .from('clients')
      .select('*, client_assignments(tech_id, profiles(id, name))')
      .order('name');
    setClients((data || []) as Client[]);
  }

  function openAdd() {
    setEditing(null);
    setForm({ account_number: '', name: '', address: '', contact_name: '', contact_phone: '', service_type: '', notes: '' });
    setSelectedTechIds([]);
    setShowModal(true);
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({
      account_number: c.account_number, name: c.name, address: c.address || '',
      contact_name: c.contact_name || '', contact_phone: c.contact_phone || '',
      service_type: c.service_type || '', notes: c.notes || '',
    });
    const ids = (c.client_assignments || []).map(a => a.tech_id);
    setSelectedTechIds(ids);
    setShowModal(true);
  }

  function toggleTech(techId: string) {
    setSelectedTechIds(prev => prev.includes(techId) ? prev.filter(id => id !== techId) : [...prev, techId]);
  }

  async function handleSave() {
    if (editing) {
      await supabase.from('clients').update({
        account_number: form.account_number, name: form.name, address: form.address,
        contact_name: form.contact_name, contact_phone: form.contact_phone,
        service_type: form.service_type, notes: form.notes,
      }).eq('id', editing.id);

      // Update assignments
      await supabase.from('client_assignments').delete().eq('client_id', editing.id);
      if (selectedTechIds.length > 0) {
        await supabase.from('client_assignments').insert(
          selectedTechIds.map(tid => ({ client_id: editing.id, tech_id: tid }))
        );
      }
    } else {
      const { data: newClient } = await supabase
        .from('clients')
        .insert({
          account_number: form.account_number, name: form.name, address: form.address,
          contact_name: form.contact_name, contact_phone: form.contact_phone,
          service_type: form.service_type, notes: form.notes,
        })
        .select('id')
        .single();

      if (newClient && selectedTechIds.length > 0) {
        await supabase.from('client_assignments').insert(
          selectedTechIds.map(tid => ({ client_id: newClient.id, tech_id: tid }))
        );
      }
    }
    setShowModal(false);
    loadClients();
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this client and all assignments?')) return;
    await supabase.from('client_assignments').delete().eq('client_id', id);
    await supabase.from('clients').delete().eq('id', id);
    loadClients();
  }

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.account_number.toLowerCase().includes(search.toLowerCase()) ||
    (c.service_type || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Building2 size={22} className="text-primary" /> Client Accounts
        </h2>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <Plus size={16} /> Add Client
        </button>
      </div>

      <label className="input input-bordered flex items-center gap-2">
        <Search className="h-[1em] opacity-50" />
        <input type="search" className="grow" placeholder="Search by name, account, or service..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map(c => {
          const techNames = (c.client_assignments || []).map(a => (a.profiles as any)?.name).filter(Boolean);
          return (
            <div key={c.id} className="card bg-base-200">
              <div className="card-body p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-xs text-base-content/50 font-mono">{c.account_number}</p>
                  </div>
                  <div className="flex gap-1">
                    <button className="btn btn-ghost btn-xs" onClick={() => openEdit(c)}><Edit size={14} /></button>
                    <button className="btn btn-ghost btn-xs text-error" onClick={() => handleDelete(c.id)}><Trash2 size={14} /></button>
                  </div>
                </div>
                {c.service_type && <span className="badge badge-primary badge-sm mt-1">{c.service_type}</span>}
                {c.address && <p className="text-xs text-base-content/60 mt-1">{c.address}</p>}
                {c.contact_name && (
                  <p className="text-xs text-base-content/60">
                    Contact: {c.contact_name}{c.contact_phone ? ` • ${c.contact_phone}` : ''}
                  </p>
                )}
                {c.notes && <p className="text-xs text-base-content/40 italic mt-1">{c.notes}</p>}
                <div className="mt-2 pt-2 border-t border-base-300">
                  <p className="text-xs font-semibold text-base-content/60 flex items-center gap-1 mb-1">
                    <UserCheck size={12} /> Assigned Techs
                  </p>
                  {techNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {techNames.map((name: string, i: number) => (
                        <span key={i} className="badge badge-sm badge-outline badge-accent">{name}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-warning">⚠ No techs assigned</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-sm text-base-content/50 col-span-2 text-center py-8">
            {search ? 'No clients match your search' : 'No clients yet — add one to get started'}
          </p>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">{editing ? 'Edit Client' : 'Add Client'}</h3>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <input className="input input-bordered w-full" placeholder="Account Number (e.g. ACC-1006)"
                value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} />
              <input className="input input-bordered w-full" placeholder="Company Name"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <input className="input input-bordered w-full" placeholder="Address"
                value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <input className="input input-bordered w-full" placeholder="Contact Name"
                  value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
                <input className="input input-bordered w-full" placeholder="Contact Phone"
                  value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} />
              </div>
              <input className="input input-bordered w-full" placeholder="Service Type (e.g. HVAC, Plumbing)"
                value={form.service_type} onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))} />
              <textarea className="textarea textarea-bordered w-full" placeholder="Notes" rows={2}
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

              <div className="border border-base-300 rounded-lg p-3">
                <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <UserCheck size={16} className="text-accent" /> Assign Technicians
                </p>
                {techs.length === 0 ? (
                  <p className="text-xs text-base-content/50">No technicians available. Add techs first.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {techs.map(t => (
                      <button key={t.id} type="button"
                        className={`btn btn-sm ${selectedTechIds.includes(t.id) ? 'btn-accent' : 'btn-outline btn-ghost'}`}
                        onClick={() => toggleTech(t.id)}>
                        {selectedTechIds.includes(t.id) ? '✓ ' : ''}{t.name}
                      </button>
                    ))}
                  </div>
                )}
                {selectedTechIds.length === 0 && (
                  <p className="text-xs text-warning mt-2">⚠ No techs selected — this client won&apos;t appear in any tech&apos;s portal</p>
                )}
              </div>
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!form.account_number || !form.name}>
                {editing ? 'Save Changes' : 'Add Client'}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowModal(false)} />
        </div>
      )}
    </div>
  );
};
