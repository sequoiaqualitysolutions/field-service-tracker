import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Edit, Trash2, Building2, X, UserCheck, Upload, Download, CheckCircle, AlertCircle } from 'lucide-react';
import { Client, Profile } from '../types';
import { supabase } from '../lib/supabase';

interface CsvRow {
  account_number: string;
  name: string;
  address: string;
  contact_name: string;
  contact_phone: string;
  service_type: string;
  notes: string;
}

interface ImportResult {
  row: number;
  name: string;
  account_number: string;
  success: boolean;
  error?: string;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.match(/(".*?"|[^,]*)/g)?.map(v => v.replace(/^"|"$/g, '').trim()) || [];
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] || ''; });
    return {
      account_number: row['account_number'] || row['accountnumber'] || row['account'] || row['acct'] || '',
      name: row['name'] || row['company'] || row['company_name'] || row['client_name'] || '',
      address: row['address'] || row['location'] || '',
      contact_name: row['contact_name'] || row['contact'] || row['contactname'] || '',
      contact_phone: row['contact_phone'] || row['phone'] || row['contactphone'] || '',
      service_type: row['service_type'] || row['service'] || row['servicetype'] || row['type'] || '',
      notes: row['notes'] || row['note'] || '',
    };
  }).filter(r => r.name && r.account_number);
}

export const ClientManager: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [techs, setTechs] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState({
    account_number: '', name: '', address: '', contact_name: '',
    contact_phone: '', service_type: '', notes: ''
  });
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importDone, setImportDone] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadClients(); loadTechs(); }, []);

  async function loadTechs() {
    const { data } = await supabase.from('profiles').select('*').in('role', ['tech', 'team_leader']).order('role').order('name');
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

  function openCsvUpload() {
    setCsvRows([]);
    setImportResults([]);
    setImportDone(false);
    setImporting(false);
    setImportProgress(0);
    setError('');
    setShowCsvModal(true);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsv(text);
      setCsvRows(rows);
      setError(rows.length === 0 ? 'No valid rows found. Check your CSV format.' : '');
    };
    reader.readAsText(file);
  }

  async function handleBulkImport() {
    setImporting(true);
    setImportResults([]);
    setImportProgress(0);
    const results: ImportResult[] = [];

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      try {
        const { error: insertErr } = await supabase.from('clients').insert({
          account_number: row.account_number,
          name: row.name,
          address: row.address,
          contact_name: row.contact_name,
          contact_phone: row.contact_phone,
          service_type: row.service_type,
          notes: row.notes,
        });
        if (insertErr) {
          results.push({ row: i + 1, name: row.name, account_number: row.account_number, success: false, error: insertErr.message });
        } else {
          results.push({ row: i + 1, name: row.name, account_number: row.account_number, success: true });
        }
      } catch (err: any) {
        results.push({ row: i + 1, name: row.name, account_number: row.account_number, success: false, error: err.message });
      }
      setImportProgress(i + 1);
      setImportResults([...results]);
    }

    setImporting(false);
    setImportDone(true);
    loadClients();
  }

  function downloadTemplate() {
    const csv = 'account_number,name,address,contact_name,contact_phone,service_type,notes\nACC-1001,Acme Corp,123 Main St,John Smith,555-0101,HVAC,Monthly maintenance\nACC-1002,Beta Industries,456 Oak Ave,Jane Doe,555-0102,Plumbing,Quarterly inspection';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clients-template.csv';
    a.click();
    URL.revokeObjectURL(url);
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
        <div className="flex gap-2">
          <button className="btn btn-outline btn-sm" onClick={openCsvUpload}>
            <Upload size={16} /> Bulk CSV Upload
          </button>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            <Plus size={16} /> Add Client
          </button>
        </div>
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
                    <UserCheck size={12} /> Assigned Team
                  </p>
                  {techNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {techNames.map((name: string, i: number) => (
                        <span key={i} className="badge badge-sm badge-outline badge-accent">{name}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-warning">⚠ No one assigned</span>
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

      {/* Add/Edit Modal */}
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
                  <UserCheck size={16} className="text-accent" /> Assign Team
                </p>
                {techs.length === 0 ? (
                  <p className="text-xs text-base-content/50">No team members available. Add users first.</p>
                ) : (
                  <>
                    {techs.filter(t => t.role === 'team_leader').length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-primary mb-1">Team Leaders</p>
                        <div className="flex flex-wrap gap-2">
                          {techs.filter(t => t.role === 'team_leader').map(t => (
                            <button key={t.id} type="button"
                              className={`btn btn-sm ${selectedTechIds.includes(t.id) ? 'btn-primary' : 'btn-outline btn-ghost'}`}
                              onClick={() => toggleTech(t.id)}>
                              {selectedTechIds.includes(t.id) ? '✓ ' : ''}{t.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {techs.filter(t => t.role === 'tech').length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-accent mb-1">Technicians</p>
                        <div className="flex flex-wrap gap-2">
                          {techs.filter(t => t.role === 'tech').map(t => (
                            <button key={t.id} type="button"
                              className={`btn btn-sm ${selectedTechIds.includes(t.id) ? 'btn-accent' : 'btn-outline btn-ghost'}`}
                              onClick={() => toggleTech(t.id)}>
                              {selectedTechIds.includes(t.id) ? '✓ ' : ''}{t.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {selectedTechIds.length === 0 && (
                  <p className="text-xs text-warning mt-2">⚠ No one selected — this client won&apos;t appear in any portal</p>
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

      {/* CSV Upload Modal */}
      {showCsvModal && (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Upload size={20} /> Bulk Client Import
              </h3>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setShowCsvModal(false)}><X size={18} /></button>
            </div>

            {!importDone && csvRows.length === 0 && (
              <div className="space-y-4">
                <div className="bg-base-200 rounded-lg p-4">
                  <p className="font-semibold text-sm mb-2">CSV Format Required:</p>
                  <code className="text-xs block bg-base-300 p-3 rounded font-mono">
                    account_number,name,address,contact_name,contact_phone,service_type,notes<br />
                    ACC-1001,Acme Corp,123 Main St,John Smith,555-0101,HVAC,Monthly maintenance<br />
                    ACC-1002,Beta Industries,456 Oak Ave,Jane Doe,555-0102,Plumbing,Quarterly check
                  </code>
                  <p className="text-xs text-base-content/60 mt-2">
                    • <strong>account_number</strong> and <strong>name</strong> are required<br />
                    • All other fields are optional<br />
                    • Account numbers must be unique<br />
                    • You can assign techs to clients after import
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-outline btn-sm" onClick={downloadTemplate}>
                    <Download size={16} /> Download Template
                  </button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt"
                  className="file-input file-input-bordered w-full"
                  onChange={handleFileSelect}
                />
                {error && <div className="alert alert-error py-2 text-sm"><span>{error}</span></div>}
              </div>
            )}

            {csvRows.length > 0 && !importing && !importDone && (
              <div className="space-y-4">
                <div className="alert alert-info py-2">
                  <span className="text-sm">Found <strong>{csvRows.length}</strong> client(s) to import</span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="table table-xs">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Account #</th>
                        <th>Name</th>
                        <th>Service</th>
                        <th>Contact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td className="font-mono text-xs">{r.account_number}</td>
                          <td>{r.name}</td>
                          <td>{r.service_type || '—'}</td>
                          <td>{r.contact_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => { setCsvRows([]); if (fileRef.current) fileRef.current.value = ''; }}>
                    Back
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={handleBulkImport}>
                    <Upload size={16} /> Import {csvRows.length} Clients
                  </button>
                </div>
              </div>
            )}

            {importing && (
              <div className="space-y-4">
                <div className="text-center">
                  <span className="loading loading-spinner loading-lg text-primary"></span>
                  <p className="mt-2 font-semibold">Importing clients... {importProgress} / {csvRows.length}</p>
                </div>
                <progress className="progress progress-primary w-full" value={importProgress} max={csvRows.length}></progress>
              </div>
            )}

            {importDone && (
              <div className="space-y-4">
                {(() => {
                  const success = importResults.filter(r => r.success).length;
                  const failed = importResults.filter(r => !r.success).length;
                  return (
                    <>
                      <div className={`alert ${failed === 0 ? 'alert-success' : 'alert-warning'} py-2`}>
                        <span className="text-sm">
                          <strong>{success}</strong> imported successfully
                          {failed > 0 && <>, <strong className="text-error">{failed}</strong> failed</>}
                        </span>
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        <table className="table table-xs">
                          <thead>
                            <tr><th>Account #</th><th>Name</th><th>Status</th></tr>
                          </thead>
                          <tbody>
                            {importResults.map((r, i) => (
                              <tr key={i} className={r.success ? '' : 'text-error'}>
                                <td className="font-mono text-xs">{r.account_number}</td>
                                <td>{r.name}</td>
                                <td>
                                  {r.success ? (
                                    <span className="flex items-center gap-1 text-success"><CheckCircle size={14} /> Created</span>
                                  ) : (
                                    <span className="flex items-center gap-1 text-error"><AlertCircle size={14} /> {r.error}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                })()}
                <button className="btn btn-primary btn-sm" onClick={() => setShowCsvModal(false)}>Done</button>
              </div>
            )}
          </div>
          <div className="modal-backdrop" onClick={() => { if (!importing) setShowCsvModal(false); }} />
        </div>
      )}
    </div>
  );
};
