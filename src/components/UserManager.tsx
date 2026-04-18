import React, { useState, useEffect, useRef } from 'react';
import { Users, Plus, Edit, Trash2, X, Shield, Wrench, Upload, Download, CheckCircle, AlertCircle, UserCheck } from 'lucide-react';
import { Profile } from '../types';
import { supabase } from '../lib/supabase';

interface CsvRow {
  name: string;
  email: string;
  password: string;
  role: string;
  hourly_rate: string;
}

interface ImportResult {
  row: number;
  name: string;
  email: string;
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
      name: row['name'] || row['full_name'] || '',
      email: row['email'] || row['email_address'] || '',
      password: row['password'] || '',
      role: (row['role'] || 'tech').toLowerCase(),
      hourly_rate: row['hourly_rate'] || row['rate'] || '25.00',
    };
  }).filter(r => r.name && r.email);
}

export const UserManager: React.FC = () => {
  const [users, setUsers] = useState<Profile[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'tech', hourly_rate: '25.00', google_calendar_id: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importDone, setImportDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
    setForm({ email: '', password: '', name: '', role: 'tech', hourly_rate: '25.00', google_calendar_id: '' });
    setError('');
    setShowModal(true);
  }

  function openEdit(u: Profile) {
    setEditing(u);
    setForm({ email: u.email, password: '', name: u.name, role: u.role, hourly_rate: String(u.hourly_rate), google_calendar_id: u.google_calendar_id || '' });
    setError('');
    setShowModal(true);
  }

  async function handleSave() {
    setLoading(true);
    setError('');
    const token = await getAuthToken();

    if (editing) {
      const res = await fetch('/api/admin-users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: editing.id,
          name: form.name,
          role: form.role,
          hourly_rate: parseFloat(form.hourly_rate),
          google_calendar_id: form.google_calendar_id || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Update failed'); setLoading(false); return; }
    } else {
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
    const token = await getAuthToken();
    const results: ImportResult[] = [];

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      try {
        const res = await fetch('/api/admin-users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            email: row.email,
            password: row.password || 'TempPass123!',
            name: row.name,
            role: ['admin', 'team_leader'].includes(row.role) ? row.role : 'tech',
            hourly_rate: parseFloat(row.hourly_rate) || 25,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          results.push({ row: i + 1, name: row.name, email: row.email, success: true });
        } else {
          results.push({ row: i + 1, name: row.name, email: row.email, success: false, error: data.error });
        }
      } catch (err: any) {
        results.push({ row: i + 1, name: row.name, email: row.email, success: false, error: err.message });
      }
      setImportProgress(i + 1);
      setImportResults([...results]);
    }

    setImporting(false);
    setImportDone(true);
    loadUsers();
  }

  function downloadTemplate() {
    const csv = 'name,email,password,role,hourly_rate\nJohn Smith,john@example.com,TempPass123!,tech,25.00\nJane Doe,jane@example.com,TempPass123!,team_leader,30.00\nBob Jones,bob@example.com,TempPass123!,tech,25.00';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const techCount = users.filter(u => u.role === 'tech').length;
  const leaderCount = users.filter(u => u.role === 'team_leader').length;
  const adminCount = users.filter(u => u.role === 'admin').length;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Users size={22} className="text-primary" /> User Management
        </h2>
        <div className="flex gap-2">
          <button className="btn btn-outline btn-sm" onClick={openCsvUpload}>
            <Upload size={16} /> Bulk CSV Upload
          </button>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            <Plus size={16} /> Add User
          </button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="badge badge-lg gap-1"><Wrench size={14} /> {techCount} Technicians</div>
        <div className="badge badge-lg badge-accent gap-1"><Users size={14} /> {leaderCount} Team Leaders</div>
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
                <span className={`badge badge-sm ${u.role === 'admin' ? 'badge-secondary' : u.role === 'team_leader' ? 'badge-accent' : 'badge-primary'}`}>
                  {u.role === 'admin' ? <><Shield size={10} /> Admin</> : u.role === 'team_leader' ? <><Users size={10} /> Team Leader</> : <><Wrench size={10} /> Tech</>}
                </span>
                <span className="text-xs text-base-content/60">${Number(u.hourly_rate).toFixed(2)}/hr</span>
              </div>
              {u.google_calendar_id && (
                <p className="text-[10px] text-base-content/40 mt-1 truncate" title={u.google_calendar_id}>📅 Calendar linked</p>
              )}
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

      {/* Add/Edit Modal */}
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
                  <option value="team_leader">Team Leader</option>
                  <option value="admin">Admin</option>
                </select>
                <input className="input input-bordered w-full" placeholder="Hourly Rate" type="number" step="0.01"
                  value={form.hourly_rate} onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))} />
              </div>
              <div>
                <label className="label py-0"><span className="label-text text-xs">Google Calendar ID</span></label>
                <input className="input input-bordered input-sm w-full" placeholder="e.g. tech-name@group.calendar.google.com"
                  value={form.google_calendar_id} onChange={e => setForm(f => ({ ...f, google_calendar_id: e.target.value }))} />
                <p className="text-[10px] text-base-content/40 mt-0.5">Found in Google Calendar → Settings → Calendar ID</p>
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

      {/* CSV Upload Modal */}
      {showCsvModal && (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Upload size={20} /> Bulk User Import
              </h3>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setShowCsvModal(false)}><X size={18} /></button>
            </div>

            {!importDone && csvRows.length === 0 && (
              <div className="space-y-4">
                <div className="bg-base-200 rounded-lg p-4">
                  <p className="font-semibold text-sm mb-2">CSV Format Required:</p>
                  <code className="text-xs block bg-base-300 p-3 rounded font-mono">
                    name,email,password,role,hourly_rate<br />
                    John Smith,john@example.com,TempPass123!,tech,25.00<br />
                    Jane Doe,jane@example.com,TempPass123!,tech,30.00
                  </code>
                  <p className="text-xs text-base-content/60 mt-2">
                    • <strong>name</strong> and <strong>email</strong> are required<br />
                    • <strong>password</strong> defaults to "TempPass123!" if blank (techs can change later)<br />
                    • <strong>role</strong> options: tech, team_leader, admin (defaults to "tech")<br />
                    • <strong>hourly_rate</strong> defaults to $25.00 if blank
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
                  <span className="text-sm">Found <strong>{csvRows.length}</strong> user(s) to import</span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="table table-xs">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{r.name}</td>
                          <td className="font-mono text-xs">{r.email}</td>
                          <td><span className={`badge badge-xs ${r.role === 'admin' ? 'badge-secondary' : r.role === 'team_leader' ? 'badge-accent' : 'badge-primary'}`}>{r.role === 'team_leader' ? 'leader' : r.role}</span></td>
                          <td>${parseFloat(r.hourly_rate || '25').toFixed(2)}</td>
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
                    <Upload size={16} /> Import {csvRows.length} Users
                  </button>
                </div>
              </div>
            )}

            {importing && (
              <div className="space-y-4">
                <div className="text-center">
                  <span className="loading loading-spinner loading-lg text-primary"></span>
                  <p className="mt-2 font-semibold">Importing users... {importProgress} / {csvRows.length}</p>
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
                            <tr><th>Name</th><th>Email</th><th>Status</th></tr>
                          </thead>
                          <tbody>
                            {importResults.map((r, i) => (
                              <tr key={i} className={r.success ? '' : 'text-error'}>
                                <td>{r.name}</td>
                                <td className="font-mono text-xs">{r.email}</td>
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
