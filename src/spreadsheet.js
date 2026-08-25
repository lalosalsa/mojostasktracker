/* Reads .xlsx and .csv in the browser with no library.
   An .xlsx is a zip of XML, and every modern browser can inflate with
   DecompressionStream, so the whole reader is a few hundred lines. */

/* ------------------------------------------------------------------- zip */
const dv = (buf) => new DataView(buf);

function findEndOfCentralDirectory(buf) {
  const view = dv(buf);
  const min = Math.max(0, buf.byteLength - 66000);
  for (let i = buf.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

async function inflate(bytes, method) {
  if (method === 0) return bytes;                       // stored
  if (method !== 8) throw new Error('Unsupported compression in this file');
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot open .xlsx files — save the schedule as CSV instead.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Returns { 'xl/worksheets/sheet1.xml': Uint8Array, ... } for the parts we need. */
async function readZip(buf, wanted) {
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) throw new Error('That file is not a valid .xlsx workbook');
  const view = dv(buf);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const out = {};
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, offset + 46, nameLen));

    if (wanted(name)) {
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const raw = new Uint8Array(buf, start, compressedSize);
      out[name] = await inflate(raw, method);
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* ------------------------------------------------------------------- xml */
const decode = (bytes) => new TextDecoder().decode(bytes);

const unescapeXml = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, code) => {
    if (code === 'lt') return '<';
    if (code === 'gt') return '>';
    if (code === 'amp') return '&';
    if (code === 'quot') return '"';
    if (code === 'apos') return "'";
    if (code[0] === '#') {
      const n = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return m;
  });

/** Shared strings: one entry per <si>, joining every <t> run inside it. */
function parseSharedStrings(xml) {
  const out = [];
  const items = xml.match(/<si[\s>][\s\S]*?<\/si>|<si\/>/g) || [];
  for (const item of items) {
    const runs = item.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    out.push(runs.map((r) => unescapeXml(r.replace(/<t[^>]*>|<\/t>/g, ''))).join(''));
  }
  return out;
}

const columnIndex = (ref) => {
  const letters = (ref.match(/^[A-Z]+/) || [''])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function parseSheet(xml, shared) {
  const rows = [];
  const rowMatches = xml.match(/<row[\s>][\s\S]*?<\/row>|<row[^>]*\/>/g) || [];

  for (const rowXml of rowMatches) {
    const cells = [];
    const cellMatches = rowXml.match(/<c[\s>][\s\S]*?<\/c>|<c[^>]*\/>/g) || [];
    for (const cellXml of cellMatches) {
      const ref = (cellXml.match(/ r="([A-Z]+\d+)"/) || [])[1];
      const type = (cellXml.match(/ t="([^"]+)"/) || [])[1] || 'n';
      let value = '';

      if (type === 'inlineStr') {
        const runs = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        value = runs.map((r) => unescapeXml(r.replace(/<t[^>]*>|<\/t>/g, ''))).join('');
      } else {
        const raw = (cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1];
        if (raw !== undefined) {
          value = type === 's' ? (shared[Number(raw)] ?? '') : unescapeXml(raw);
        }
      }
      const at = ref ? columnIndex(ref) : cells.length;
      cells[at] = value;
    }
    for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

/* ------------------------------------------------------------------- csv */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/* ------------------------------------------------------------------ entry */

/** Reads a .xlsx or .csv File into a grid of strings. */
export async function readSpreadsheet(file) {
  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
    return parseCsv(await file.text());
  }
  if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
    throw new Error('Upload the schedule as .xlsx or .csv');
  }

  const buf = await file.arrayBuffer();
  const parts = await readZip(buf, (n) =>
    n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));

  const shared = parts['xl/sharedStrings.xml'] ? parseSharedStrings(decode(parts['xl/sharedStrings.xml'])) : [];
  const sheetNames = Object.keys(parts)
    .filter((n) => n.startsWith('xl/worksheets/'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!sheetNames.length) throw new Error('That workbook has no sheets in it');

  return parseSheet(decode(parts[sheetNames[0]]), shared);
}

/* --------------------------------------------------- value interpretation */

/** Excel keeps dates as days since 1899-12-30 (the 1900 leap-year quirk). */
export function excelSerialToDate(serial) {
  const ms = Math.round((Number(serial) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Accepts 2026-08-25, 8/25/2026, 25/08/2026, "Aug 25, 2026", or an Excel serial. */
export function parseDate(value, { dayFirst = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw) && Number(raw) > 20000 && Number(raw) < 80000) {
    return excelSerialToDate(raw);
  }

  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  m = raw.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = String(2000 + Number(y));
    const month = dayFirst ? b : a;
    const day = dayFirst ? a : b;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  m = raw.match(/([A-Za-z]{3,})\.?\s+(\d{1,2})(?:,)?\s*(\d{4})?/);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) {
      const year = m[3] || String(new Date().getFullYear());
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
    }
  }
  return null;
}

/** Accepts 8:00, 08:00:00, "8:00 AM", "8am", "1730", or an Excel day fraction. */
export function parseTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  // Excel stores a time-only cell as a fraction of a day, always with a decimal
  if (/^\d*\.\d+$/.test(raw) && Number(raw) < 2) {
    const frac = Number(raw) % 1;
    const mins = Math.round(frac * 24 * 60);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  let m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i);
  if (m) {
    let hour = Number(m[1]);
    const suffix = (m[4] || '').toLowerCase();
    if (suffix.startsWith('p') && hour < 12) hour += 12;
    if (suffix.startsWith('a') && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${m[2]}`;
  }

  m = raw.match(/^(\d{1,2})\s*([ap])\.?m?\.?$/i);
  if (m) {
    let hour = Number(m[1]);
    if (m[2].toLowerCase() === 'p' && hour < 12) hour += 12;
    if (m[2].toLowerCase() === 'a' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:00`;
  }

  m = raw.match(/^(\d{3,4})$/);
  if (m) {
    const digits = m[1].padStart(4, '0');
    const hour = Number(digits.slice(0, 2));
    if (hour <= 23) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  }

  m = raw.match(/^(\d{1,2})$/);          // a bare hour, e.g. "8"
  if (m && Number(m[1]) <= 23) return `${m[1].padStart(2, '0')}:00`;

  return null;
}

/* ------------------------------------------------- column auto-detection */
const CANDIDATES = {
  name: ['team member', 'employee', 'employee name', 'name', 'staff', 'worker', 'person', 'member'],
  date: ['date', 'shift date', 'work date', 'day', 'scheduled date'],
  start: ['start', 'start time', 'shift start', 'clock in', 'clock-in', 'in', 'from', 'begin'],
  end: ['end', 'end time', 'shift end', 'clock out', 'clock-out', 'out', 'to', 'finish'],
};

/** Guesses which columns hold the name, date and times. */
export function detectColumns(header) {
  const clean = header.map((h) => String(h || '').trim().toLowerCase());
  const picked = {};
  const taken = new Set();

  for (const [key, options] of Object.entries(CANDIDATES)) {
    let best = -1;
    let bestScore = 0;
    clean.forEach((label, i) => {
      if (!label || taken.has(i)) return;
      for (const option of options) {
        // exact header beats a partial match, and earlier options beat later ones
        const score = label === option ? 100 - options.indexOf(option)
          : label.includes(option) ? 50 - options.indexOf(option) : 0;
        if (score > bestScore) { bestScore = score; best = i; }
      }
    });
    if (best >= 0) { picked[key] = best; taken.add(best); }
  }
  return picked;
}

/** Does this row look like a header rather than data? */
export function looksLikeHeader(row) {
  const filled = row.filter((c) => String(c || '').trim() !== '');
  if (!filled.length) return false;
  const detected = detectColumns(row);
  return Object.keys(detected).length >= 2 && filled.every((c) => !/^\d+([.,]\d+)?$/.test(String(c).trim()));
}

/**
 * Turns the grid into shift rows using the chosen column mapping.
 * Returns { shifts, skipped } — skipped rows carry the reason so the manager
 * can see exactly what was ignored instead of silently losing people.
 */
export function rowsToShifts(rows, mapping, { dayFirst = false, headerRow = 0 } = {}) {
  const shifts = [];
  const skipped = [];

  rows.forEach((row, index) => {
    if (index <= headerRow) return;
    const person = String(row[mapping.name] ?? '').trim();
    const dateRaw = row[mapping.date];
    const startRaw = row[mapping.start];
    const endRaw = row[mapping.end];

    if (!person && !String(dateRaw ?? '').trim()) return;   // blank spacer row

    const date = parseDate(dateRaw, { dayFirst });
    const start = parseTime(startRaw);
    const end = parseTime(endRaw);

    if (!person) return skipped.push({ row: index + 1, reason: 'no name', raw: row.join(' | ') });
    if (/^(off|pto|vacation|time off|unavailable)$/i.test(String(startRaw ?? '').trim())) {
      return skipped.push({ row: index + 1, reason: 'marked off', raw: person });
    }
    if (!date) return skipped.push({ row: index + 1, reason: "couldn't read the date", raw: `${person} · ${dateRaw}` });
    if (!start || !end) {
      return skipped.push({ row: index + 1, reason: "couldn't read the times", raw: `${person} · ${startRaw} – ${endRaw}` });
    }
    if (end <= start) {
      return skipped.push({ row: index + 1, reason: 'ends before it starts', raw: `${person} · ${start} – ${end}` });
    }
    shifts.push({ person, date, start, end });
  });

  return { shifts, skipped };
}
