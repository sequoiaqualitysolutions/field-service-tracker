import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Plus, Search, Edit, Trash2, Building2, X, UserCheck, Upload, Download, CheckCircle, AlertCircle, RefreshCw, Save, ExternalLink } from 'lucide-react';
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

function parseSpreadsheet(data: ArrayBuffer): CsvRow[] {
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
  return raw.map(row => {
    const r: Record<string, string> = {};
    Object.entries(row).forEach(([k, v]) => { r[k.trim().toLowerCase().replace(/[^a-z_]/g, '')] = String(v).trim(); });
    return {
      account_number: r['account_number'] || r['accountnumber'] || r['account'] || r['acct'] || '',
      name: r['name'] || r['company'] || r['company_name'] || r['companyname'] || r['client_name'] || r['clientname'] || '',
      address: r['address'] || r['location'] || '',
      contact_name: r['contact_name'] || r['contact'] || r['contactname'] || '',
      contact_phone: r['contact_phone'] || r['phone'] || r['contactphone'] || '',
      service_type: r['service_type'] || r['service'] || r['servicetype'] || r['type'] || '',
      notes: r['notes'] || r['note'] || '',
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
    contact_phone: '', contact_email: '', service_type: '', ship_address: '', notes: ''
  });
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importDone, setImportDone] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Google Sheets Sync state
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetUrlSaved, setSheetUrlSaved] = useState('');
  const [sheetUrlLoading, setSheetUrlLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ added: number; updated: number; skipped: number; errors: number; total: number } | null>(null);
  const [syncError, setSyncError] = useState('');

  useEffect(() => { loadClients(); loadTechs(); loadSheetUrl(); }, []);

  async function loadSheetUrl() {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'google_sheet_url')
      .maybeSingle();
    if (data?.value) {
      setSheetUrl(data.value);
      setSheetUrlSaved(data.value);
    }
  }

  async function saveSheetUrl() {
    setSheetUrlLoading(true);
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'google_sheet_url', value: sheetUrl, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) {
      setSyncError('Failed to save URL: ' + error.message);
    } else {
      setSheetUrlSaved(sheetUrl);
      setSyncError('');
    }
    setSheetUrlLoading(false);
  }

  async function handleSyncNow() {
    setSyncing(true);
    setSyncResult(null);
    setSyncError('');
    try {
      const res = await fetch('/api/sync-clients');
      const data = await res.json();
      if (data.error) {
        setSyncError(data.error);
      } else {
        setSyncResult(data);
        loadClients(); // Refresh client list
      }
    } catch (err: any) {
      setSyncError('Sync failed: ' + (err.message || 'Network error'));
    }
    setSyncing(false);
  }

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
    setForm({ account_number: '', name: '', address: '', contact_name: '', contact_phone: '', contact_email: '', service_type: '', ship_address: '', notes: '' });
    setSelectedTechIds([]);
    setShowModal(true);
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({
      account_number: c.account_number, name: c.name, address: c.address || '',
      contact_name: c.contact_name || '', contact_phone: c.contact_phone || '',
      contact_email: c.contact_email || '', service_type: c.service_type || '',
      ship_address: c.ship_address || '', notes: c.notes || '',
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
        contact_email: form.contact_email, service_type: form.service_type,
        ship_address: form.ship_address, notes: form.notes,
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
          contact_email: form.contact_email, service_type: form.service_type,
          ship_address: form.ship_address, notes: form.notes,
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
      const data = ev.target?.result as ArrayBuffer;
      const rows = parseSpreadsheet(data);
      setCsvRows(rows);
      setError(rows.length === 0 ? 'No valid rows found. Check your spreadsheet format.' : '');
    };
    reader.readAsArrayBuffer(file);
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
    const wb = XLSX.utils.book_new();
    const data = [
      { account_number: 'ACC-1001', name: 'Acme Corp', address: '123 Main St', contact_name: 'John Smith', contact_phone: '555-0101', service_type: 'HVAC', notes: 'Monthly maintenance' },
      { account_number: 'ACC-1002', name: 'Beta Industries', address: '456 Oak Ave', contact_name: 'Jane Doe', contact_phone: '555-0102', service_type: 'Plumbing', notes: 'Quarterly inspection' },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 25 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Clients');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clients-template.xlsx';
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
            <Upload size={16} /> Bulk Upload (Google Sheets)
          </button>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            <Plus size={16} /> Add Client
          </button>
        </div>
      </div>

      {/* Google Sheets Sync Section */}
      <div className="card bg-base-200">
        <div className="card-body p-4 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            📊 Google Sheets Sync
          </h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="input input-bordered input-sm flex-1"
              placeholder="Published Google Sheet CSV URL..."
              value={sheetUrl}
              onChange={e => setSheetUrl(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="btn btn-sm btn-outline"
                onClick={saveSheetUrl}
                disabled={sheetUrlLoading || sheetUrl === sheetUrlSaved}
              >
                {sheetUrlLoading ? <span className="loading loading-spinner loading-xs"></span> : <Save size={14} />}
                Save
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleSyncNow}
                disabled={syncing || !sheetUrlSaved}
              >
                {syncing ? <span className="loading loading-spinner loading-xs"></span> : <RefreshCw size={14} />}
                Sync Now
              </button>
            </div>
          </div>
          <p className="text-xs text-base-content/50">
            Publish your Google Sheet: File → Share → Publish to web → Select CSV → Publish. Paste the URL here.
            <span className="ml-2 text-base-content/40">Auto-syncs every 24 hours</span>
          </p>
          {syncError && (
            <div className="alert alert-error py-2 text-sm">
              <AlertCircle size={14} />
              <span>{syncError}</span>
            </div>
          )}
          {syncResult && (
            <div className="alert alert-success py-2 text-sm">
              <CheckCircle size={14} />
              <span>
                Synced: <strong>{syncResult.added}</strong> added, <strong>{syncResult.updated}</strong> updated, <strong>{syncResult.skipped}</strong> skipped
                {syncResult.errors > 0 && <>, <strong className="text-error">{syncResult.errors}</strong> errors</>}
                {' '}({syncResult.total} total rows)
              </span>
            </div>
          )}
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
                {c.contact_email && (
                  <p className="text-xs text-base-content/60">✉ {c.contact_email}</p>
                )}
                {c.ship_address && c.ship_address !== c.address && (
                  <p className="text-xs text-base-content/50">Ship: {c.ship_address}</p>
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
              <input className="input input-bordered w-full" placeholder="Contact Email"
                value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} />
              <input className="input input-bordered w-full" placeholder="Ship Address"
                value={form.ship_address} onChange={e => setForm(f => ({ ...f, ship_address: e.target.value }))} />
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

      {/* Spreadsheet Upload Modal */}
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
                  <p className="font-semibold text-sm mb-2">Google Sheets Format Required:</p>
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
                  accept=".xlsx,.xls,.csv"
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
