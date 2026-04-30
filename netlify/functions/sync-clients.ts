import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/* ---------- RFC 4180 CSV Parser ---------- */

function parseCsvRfc4180(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i++;
      } else if (ch === '\r') {
        // Handle \r\n or lone \r
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
        if (i < text.length && text[i] === '\n') {
          i++;
        }
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Push last field/row
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/* ---------- Column Parsing ---------- */

interface ParsedClient {
  account_number: string;
  name: string;
  contact_phone: string;
  contact_email: string;
  contact_name: string;
  address: string;
  ship_address: string;
  service_type: string;
}

function parseSheetRows(csvText: string): ParsedClient[] {
  const allRows = parseCsvRfc4180(csvText);

  // First 3 rows are title/company/blank — skip them
  // Row 4 (index 3) = headers
  // Row 5+ (index 4+) = data
  if (allRows.length < 5) return [];

  const headerRow = allRows[3];
  const headers = headerRow.map(h => h.trim().toLowerCase());

  // Map header names to column indices
  const colIdx: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h.includes('customer full name') || h === 'customer full name') colIdx['customer_full_name'] = i;
    else if (h === 'phone numbers' || h.includes('phone number')) colIdx['phone_numbers'] = i;
    else if (h === 'email') colIdx['email'] = i;
    else if (h === 'full name') colIdx['full_name'] = i;
    else if (h === 'bill address' || h.includes('bill address')) colIdx['bill_address'] = i;
    else if (h === 'ship address' || h.includes('ship address')) colIdx['ship_address'] = i;
  });

  const dataRows = allRows.slice(4);
  const results: ParsedClient[] = [];

  for (const row of dataRows) {
    // Get raw cell values
    const customerFullName = (row[colIdx['customer_full_name']] || '').trim();
    const phoneNumbers = (row[colIdx['phone_numbers']] || '').trim();
    const email = (row[colIdx['email']] || '').trim();
    const fullName = (row[colIdx['full_name']] || '').trim();
    const billAddress = (row[colIdx['bill_address']] || '').trim();
    const shipAddress = (row[colIdx['ship_address']] || '').trim();

    // Parse Customer full name: split on FIRST '-' only
    // Left part = account_number, right part = name
    if (!customerFullName) continue;

    const dashIdx = customerFullName.indexOf('-');
    if (dashIdx < 0) continue; // No dash = can't parse

    const accountNumber = customerFullName.substring(0, dashIdx).trim();
    const clientName = customerFullName.substring(dashIdx + 1).trim();

    if (!accountNumber) continue;

    // Address: replace literal \n with ", "
    const cleanAddress = billAddress.replace(/\n/g, ', ').replace(/\r/g, '');
    const cleanShipAddress = shipAddress.replace(/\n/g, ', ').replace(/\r/g, '');

    results.push({
      account_number: accountNumber,
      name: clientName || accountNumber,
      contact_phone: phoneNumbers,
      contact_email: email,
      contact_name: fullName,
      address: cleanAddress,
      ship_address: cleanShipAddress,
      service_type: 'CLIENT',
    });
  }

  return results;
}

/* ---------- Handler ---------- */

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response('OK', { headers: cors });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // 1. Get the Google Sheet published CSV URL from app_settings
    const { data: setting, error: settingErr } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'google_sheet_url')
      .single();

    if (settingErr || !setting?.value) {
      return jsonResponse({
        error: 'Google Sheet URL not configured. Go to Client Accounts to set it up.',
        added: 0, updated: 0, skipped: 0, errors: 0, total: 0,
      }, 400);
    }

    const csvUrl = setting.value;

    // 2. Fetch the CSV
    const csvRes = await fetch(csvUrl);
    if (!csvRes.ok) {
      return jsonResponse({
        error: `Failed to fetch Google Sheet CSV: ${csvRes.status} ${csvRes.statusText}`,
        added: 0, updated: 0, skipped: 0, errors: 0, total: 0,
      }, 502);
    }

    const csvText = await csvRes.text();

    // 3. Parse the CSV
    const parsed = parseSheetRows(csvText);

    if (parsed.length === 0) {
      return jsonResponse({
        message: 'No valid rows found in the Google Sheet CSV.',
        added: 0, updated: 0, skipped: 0, errors: 0, total: 0,
      });
    }

    // 4. Sync each row into the clients table
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (const client of parsed) {
      if (!client.account_number) {
        skipped++;
        continue;
      }

      try {
        // Check if this account_number already exists (exclude INTERNAL rows)
        const { data: existing } = await supabaseAdmin
          .from('clients')
          .select('id, service_type')
          .eq('account_number', client.account_number)
          .maybeSingle();

        // NEVER touch INTERNAL rows
        if (existing && existing.service_type === 'INTERNAL') {
          skipped++;
          continue;
        }

        const rowData = {
          account_number: client.account_number,
          name: client.name,
          contact_phone: client.contact_phone,
          contact_email: client.contact_email,
          contact_name: client.contact_name,
          address: client.address,
          ship_address: client.ship_address,
          service_type: client.service_type,
        };

        if (existing) {
          // UPDATE existing row
          const { error: updateErr } = await supabaseAdmin
            .from('clients')
            .update(rowData)
            .eq('id', existing.id);

          if (updateErr) {
            errors++;
            errorDetails.push(`Update ${client.account_number}: ${updateErr.message}`);
          } else {
            updated++;
          }
        } else {
          // INSERT new row
          const { error: insertErr } = await supabaseAdmin
            .from('clients')
            .insert(rowData);

          if (insertErr) {
            errors++;
            errorDetails.push(`Insert ${client.account_number}: ${insertErr.message}`);
          } else {
            added++;
          }
        }
      } catch (err: any) {
        errors++;
        errorDetails.push(`${client.account_number}: ${err.message}`);
      }
    }

    return jsonResponse({
      added,
      updated,
      skipped,
      errors,
      total: parsed.length,
      ...(errorDetails.length > 0 ? { errorDetails } : {}),
    });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
};

export const config = {
  path: '/api/sync-clients',
};
