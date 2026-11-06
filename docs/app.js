/* Quản lý NCS – Khoa Giáo dục, ĐHBK Hà Nội
 * Ứng dụng web tĩnh (chạy trên GitHub Pages). Dữ liệu KHÔNG gửi lên máy chủ:
 *  - luôn lưu trong trình duyệt (IndexedDB), không mất khi tắt máy;
 *  - và (khuyến nghị) tự ghi vào 1 file .json trên máy do người dùng chọn.
 */
'use strict';

// ============================================================ tiện ích chung
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(16).slice(2, 12);
const pad = (n) => String(n).padStart(2, '0');
const nowStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const S = (v) => (v == null ? '' : String(v).replace(/\t/g, ' ').replace(/\s+/g, ' ').trim());

// ============================================================ ngày tháng (chuỗi ISO YYYY-MM-DD)
function isoOf(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isoOf(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') { // số seri ngày của Excel
    if (v < 1 || v > 80000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const s = String(v).trim().replace(/\.+$/, '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,3})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (m) return isoOf(+m[3], +m[2], +m[1]);
  return null;
}
const ymd = (iso) => iso.split('-').map(Number);
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = ymd(iso); return `${pad(d)}/${pad(m)}/${y}`; }
function addMonths(iso, n) {
  const [y, m, d] = ymd(iso);
  const t = (y * 12 + (m - 1)) + n; const ny = Math.floor(t / 12); const nm = t % 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}
function monthsBetween(a, b) {
  const [y1, m1, d1] = ymd(a); const [y2, m2, d2] = ymd(b);
  let n = (y2 - y1) * 12 + (m2 - m1); if (d2 < d1) n -= 1; return n;
}

// ============================================================ chu kỳ báo cáo
function parseCycle(t) {
  if (!t) return [];
  if (Array.isArray(t)) return [...new Set(t.map(Number).filter((x) => x >= 1 && x <= 12))].sort((a, b) => a - b);
  const nums = [...String(t).matchAll(/T\s*(\d{1,2})/gi)].map((x) => +x[1]).filter((x) => x >= 1 && x <= 12);
  return [...new Set(nums)].sort((a, b) => a - b);
}
const cycleLabel = (ms) => (ms && ms.length ? ms.map((m) => 'T' + m).join(' – ') : '');
function studentCycle(st) {
  const c = parseCycle(st.chu_ky_bc); if (c.length) return c;
  if (st.ngay_qd) { const a = ymd(st.ngay_qd)[1]; const b = ((a + 6 - 1) % 12) + 1; return [...new Set([a, b])].sort((x, y) => x - y); }
  return [];
}
function duePeriods(st, today = todayISO()) {
  const months = studentCycle(st); if (!st.ngay_qd || !months.length) return [];
  const [qy, qm] = ymd(st.ngay_qd); const [ty, tm] = ymd(today);
  const out = []; let t = qy * 12 + (qm - 1) + 1; const end = ty * 12 + (tm - 1);
  for (; t <= end; t++) { const y = Math.floor(t / 12); const m = t % 12 + 1; if (months.includes(m)) out.push(`${y}-${pad(m)}`); }
  return out;
}
const periodLabel = (p) => { if (!p) return ''; const [y, m] = p.split('-'); return `T${+m}/${y}`; };

// ============================================================ dữ liệu
const DEFAULT_SETTINGS = {
  groups: ['QLGD', 'PPDH', 'CNGD'],
  statuses: ['Đang đào tạo', 'Gia hạn', 'Tạm dừng', 'Đã bảo vệ cấp cơ sở', 'Đã bảo vệ cấp trường', 'Hết hạn', 'Thôi học'],
  active_statuses: ['Đang đào tạo', 'Gia hạn', 'Đã bảo vệ cấp cơ sở'],
  milestone_types: [
    { name: 'Xét tuyển đầu vào', offset_months: 0 }, { name: 'Học phần tiến sĩ', offset_months: 12 },
    { name: 'Tiểu luận tổng quan', offset_months: 12 }, { name: 'Chuyên đề 1', offset_months: 18 },
    { name: 'Chuyên đề 2', offset_months: 20 }, { name: 'Chuyên đề 3', offset_months: 24 },
    { name: 'Công bố khoa học', offset_months: 30 }, { name: 'Seminar nhóm nhỏ', offset_months: 30 },
    { name: 'Seminar cấp Khoa', offset_months: 32 }, { name: 'Bảo vệ cấp cơ sở', offset_months: 33 },
    { name: 'Phản biện độc lập', offset_months: 34 }, { name: 'Bảo vệ cấp trường', offset_months: 36 },
  ],
  warn_months_before_end: 6,
};
const COLLS = ['students', 'supervisors', 'milestones', 'reports'];
let DB = null;

function emptyDB() { return { app: 'qlsdh-ncs', version: 1, students: [], supervisors: [], milestones: [], reports: [], log: [], settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), updated_at: null }; }
function normalizeDB(d) {
  d = d && typeof d === 'object' ? d : emptyDB();
  COLLS.forEach((c) => { if (!Array.isArray(d[c])) d[c] = []; });
  if (!Array.isArray(d.log)) d.log = [];
  d.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), d.settings || {});
  return d;
}
const getItem = (c, id) => DB[c].find((x) => x.id === id) || null;
function upsert(c, item) {
  const now = nowStr();
  if (!item.id) { item.id = uid(); item.created_at = now; DB[c].push(item); }
  else { const ex = getItem(c, item.id); if (ex) { Object.assign(ex, item); item = ex; } else { item.created_at = now; DB[c].push(item); } }
  item.updated_at = now; return item;
}
const removeItem = (c, id) => { DB[c] = DB[c].filter((x) => x.id !== id); };

// ---------------- IndexedDB (key-value)
const idb = (() => {
  let p = null;
  const open = () => p || (p = new Promise((res, rej) => { const r = indexedDB.open('qlsdh-ncs', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('kv', mode); const st = t.objectStore('kv'); const r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
  return { get: (k) => tx('readonly', (s) => s.get(k)), set: (k, v) => tx('readwrite', (s) => s.put(v, k)), del: (k) => tx('readwrite', (s) => s.delete(k)), keys: () => tx('readonly', (s) => s.getAllKeys()) };
})();

// ---------------- file dữ liệu trên máy (File System Access API – Chrome/Edge)
const FS_OK = 'showSaveFilePicker' in window;
let fileHandle = null; let fileOK = false; let lastFileSave = null;

async function writeFile() {
  if (!fileHandle || !fileOK) return false;
  try { const w = await fileHandle.createWritable(); await w.write(JSON.stringify(DB, null, 1)); await w.close(); lastFileSave = nowStr(); return true; }
  catch (e) { fileOK = false; console.error(e); return false; }
}

async function saveDB(message) {
  DB.updated_at = nowStr();
  if (message) { DB.log.push(`[${DB.updated_at}] ${message}`); if (DB.log.length > 1000) DB.log = DB.log.slice(-1000); }
  await idb.set('db', DB);
  const bk = 'backup-' + todayISO();
  if (!(await idb.get(bk))) {
    await idb.set(bk, JSON.parse(JSON.stringify(DB)));
    const keys = (await idb.keys()).filter((k) => String(k).startsWith('backup-')).sort();
    for (const k of keys.slice(0, -30)) await idb.del(k);
  }
  await writeFile();
  renderSaveState();
}

function renderSaveState() {
  const el = document.getElementById('savestate'); if (!el) return;
  if (fileHandle && fileOK) el.innerHTML = `💾 Đang tự lưu vào file<br><b>${esc(fileHandle.name)}</b>${lastFileSave ? `<br>lần cuối ${esc(lastFileSave.slice(11))}` : ''}`;
  else if (fileHandle) el.innerHTML = `⚠️ Chưa kết nối lại file <b>${esc(fileHandle.name)}</b>`;
  else el.innerHTML = `Dữ liệu lưu trong trình duyệt này.<br><a href="#/du-lieu">Chọn file để lưu trên máy</a>`;
  renderBanner();
}
function renderBanner() {
  const b = document.getElementById('banner'); if (!b) return;
  if (fileHandle && !fileOK) {
    b.innerHTML = `<div class="flash warn">File dữ liệu <b>${esc(fileHandle.name)}</b> cần được cho phép lại sau khi mở trình duyệt.
      <button class="btn sm pri" data-click="reconnect">Kết nối lại file</button> <button class="btn sm" data-click="forgetFile">Bỏ liên kết</button></div>`;
  } else b.innerHTML = '';
}

async function useFileHandle(h, mode) {
  if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Chưa được cấp quyền ghi file.');
  fileHandle = h; fileOK = true; await idb.set('fileHandle', h);
  if (mode === 'sync') {
    const text = await (await h.getFile()).text();
    let data = null; try { data = text.trim() ? normalizeDB(JSON.parse(text)) : null; } catch { data = null; }
    if (data && data.updated_at && (!DB.updated_at || data.updated_at > DB.updated_at)) { DB = data; await idb.set('db', DB); }
    else await writeFile();
  } else if (mode === 'load') {
    const text = await (await h.getFile()).text();
    if (text.trim()) {
      const data = normalizeDB(JSON.parse(text));
      if (data.app && data.app !== 'qlsdh-ncs') throw new Error('File này không phải file dữ liệu của ứng dụng.');
      DB = data; await idb.set('db', DB);
    } else await writeFile();
  } else await writeFile();
  renderSaveState();
}

// ============================================================ nghiệp vụ
function endDate(st) {
  if (st.gia_han_den) return st.gia_han_den;
  const y = parseFloat(st.thoi_gian_dao_tao);
  if (!st.ngay_qd || !(y > 0)) return null;
  return addMonths(st.ngay_qd, Math.round(y * 12));
}
const isActive = (st) => DB.settings.active_statuses.includes(st.trang_thai || 'Đang đào tạo');
const supName = (s) => (s ? `${s.hoc_ham_hoc_vi || ''} ${s.ho_ten || ''}`.trim() : '');

function enrich(st, today = todayISO()) {
  const e = Object.assign({}, st);
  e.cbhd1 = getItem('supervisors', st.cbhd1_id); e.cbhd2 = getItem('supervisors', st.cbhd2_id);
  e.end_date = endDate(st); e.months_left = e.end_date ? monthsBetween(today, e.end_date) : null;
  e.active = isActive(st);
  const ms = DB.milestones.filter((m) => m.student_id === st.id);
  ms.sort((a, b) => (a.ngay_thuc_hien || a.ngay_du_kien || '9999').localeCompare(b.ngay_thuc_hien || b.ngay_du_kien || '9999'));
  e.milestones = ms;
  e.done_count = ms.filter((m) => m.ngay_thuc_hien).length;
  const pending = ms.filter((m) => !m.ngay_thuc_hien).sort((a, b) => (a.ngay_du_kien || '9999').localeCompare(b.ngay_du_kien || '9999'));
  e.next_milestone = pending[0] || null;
  e.overdue = pending.filter((m) => m.ngay_du_kien && m.ngay_du_kien < today);
  const done = ms.filter((m) => m.ngay_thuc_hien).sort((a, b) => b.ngay_thuc_hien.localeCompare(a.ngay_thuc_hien));
  e.last_milestone = done[0] || null;
  const periods = duePeriods(st, today);
  const sub = new Set(DB.reports.filter((r) => r.student_id === st.id && r.da_nop).map((r) => r.ky));
  e.cycle = studentCycle(st); e.last_period = periods[periods.length - 1] || null;
  e.last_period_ok = e.last_period ? sub.has(e.last_period) : true;
  return e;
}
function alerts() {
  const warn = +DB.settings.warn_months_before_end || 6;
  const out = { expired: [], ending: [], overdue: [], no_report: [], missing: [] };
  DB.students.forEach((st) => {
    const e = enrich(st); if (!e.active) return;
    if (e.months_left != null) { if (e.months_left < 0) out.expired.push(e); else if (e.months_left <= warn) out.ending.push(e); }
    if (e.overdue.length) out.overdue.push(e);
    if (!e.last_period_ok) out.no_report.push(e);
    if (!st.ngay_qd || !st.ma_ncs || !st.cbhd1_id || !st.thoi_gian_dao_tao) out.missing.push(e);
  });
  out.expired.sort((a, b) => a.months_left - b.months_left); out.ending.sort((a, b) => a.months_left - b.months_left);
  return out;
}
const vnKey = (name) => { const p = S(name).split(' '); return (p[p.length - 1] || '').toLowerCase() + ' ' + S(name).toLowerCase(); };
const byName = (a, b) => vnKey(a.ho_ten).localeCompare(vnKey(b.ho_ten), 'vi');

function generateMilestones(st) {
  if (!st.ngay_qd) return 0;
  const have = new Set(DB.milestones.filter((m) => m.student_id === st.id).map((m) => m.loai));
  let n = 0;
  DB.settings.milestone_types.forEach((t) => {
    if (have.has(t.name)) return;
    upsert('milestones', { student_id: st.id, loai: t.name, ngay_du_kien: addMonths(st.ngay_qd, +t.offset_months || 0), ngay_thuc_hien: null, ket_qua: '', nguoi_danh_gia: '', gv_ngoai: '', dot_thanh_toan: '', da_thanh_toan: false, ghi_chu: '' });
    n++;
  });
  return n;
}

// ============================================================ tên cán bộ
const TITLE_RE = /^\s*((PGS|GS|TSKH|TS|ThS|CN|KS)(?![A-Za-zÀ-ỹ])\s*[.\s]*)+/i;
function splitTitle(full) {
  const s = S(full).replace(/^[,;]+|[,;]+$/g, '');
  const m = s.match(TITLE_RE); if (!m) return ['', s];
  const norm = { gs: 'GS', pgs: 'PGS', tskh: 'TSKH', ts: 'TS', ths: 'ThS', cn: 'CN', ks: 'KS' };
  const parts = m[0].match(/PGS|GS|TSKH|TS|ThS|CN|KS/gi) || [];
  return [parts.map((p) => norm[p.toLowerCase()]).join('.'), s.slice(m[0].length).trim()];
}
function titleRank(t) { t = (t || '').toUpperCase(); if (t.startsWith('GS')) return 4; if (t.startsWith('PGS')) return 3; if (t.includes('TS')) return 2; return t ? 1 : 0; }
const nameKey = (n) => S(n).toLowerCase();

// ============================================================ nhập Excel
const HEADER_ALIASES = { 'stt': 'stt', 'họ tên ncs': 'ho_ten', 'nhóm cm': 'nhom_cm', 'bc 6 tháng': 'chu_ky_bc', 'mã ncs': 'ma_ncs', 'ngày sinh': 'ngay_sinh', 'cơ quan công tác': 'co_quan', 'đề tài': 'de_tai', 'cb hướng dẫn': 'cbhd1', 'cbhd 2': 'cbhd2', 'email': 'email', 'điện thoại': 'dien_thoai', 'số qđ công nhận ncs': 'so_qd', 'ngày qđ công nhận': 'ngay_qd', 'thời gian đào tạo': 'thoi_gian', 'kế hoạch tiếp theo': 'ke_hoach' };
const MILESTONE_RULES = [[/xét tuyển/, 'Xét tuyển đầu vào'], [/tổng quan/, 'Tiểu luận tổng quan'], [/c\.?\s*đề|chuyên đề/, 'Báo cáo chuyên đề'], [/nhóm nhỏ/, 'Seminar nhóm nhỏ'], [/cấp khoa/, 'Seminar cấp Khoa']];

function splitPeople(cell) {
  const s = S(cell); if (!s) return [];
  return s.split(/\s*[,;]\s*(?=(?:PGS|GS|TS|ThS)\b)/).map((ch) => {
    let unit = ''; const m = ch.match(/\(([^)]*)\)/);
    if (m) { unit = m[1].trim(); ch = (ch.slice(0, m.index) + ch.slice(m.index + m[0].length)).trim(); }
    const [title, name] = splitTitle(ch); return name ? { title, name, unit } : null;
  }).filter(Boolean);
}
function supervisorId(p, stats) {
  const k = nameKey(p.name);
  const ex = DB.supervisors.find((s) => nameKey(s.ho_ten) === k);
  if (ex) { if (titleRank(p.title) > titleRank(ex.hoc_ham_hoc_vi)) ex.hoc_ham_hoc_vi = p.title; if (p.unit && !ex.don_vi) ex.don_vi = p.unit; return ex.id; }
  stats.supervisors_added++;
  return upsert('supervisors', { ho_ten: p.name, hoc_ham_hoc_vi: p.title, don_vi: p.unit, ngoai_truong: false, email: '', dien_thoai: '', ghi_chu: '' }).id;
}
function activityMilestones(text, batch) {
  text = S(text); if (!text) return [];
  const out = [];
  text.split(/\s*;\s*|\s+(?=\d{1,2}\/\d{1,2}\/\d{4}\b)/).forEach((seg) => {
    seg = seg.trim(); if (!seg) return;
    const m = seg.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s*/);
    const done = m ? parseDate(m[1]) : null; const body = m ? seg.slice(m[0].length) : seg;
    const i = body.indexOf(':'); const head = (i >= 0 ? body.slice(0, i) : body).toLowerCase();
    let reviewer = i >= 0 ? body.slice(i + 1).trim().replace(/^[;.\s]+|[;.\s]+$/g, '') : '';
    if (/ko có|không có/i.test(reviewer)) reviewer = '';
    let kinds = MILESTONE_RULES.filter(([re]) => re.test(head)).map(([, n]) => n); if (!kinds.length) kinds = ['Hoạt động khác'];
    kinds.forEach((k) => out.push({ loai: k, ngay_du_kien: null, ngay_thuc_hien: done, ket_qua: '', nguoi_danh_gia: '', gv_ngoai: reviewer, dot_thanh_toan: batch, da_thanh_toan: false, ghi_chu: 'Nhập từ Excel: ' + text }));
  });
  return out;
}
function importWorkbook(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  let hr = -1;
  for (let r = 0; r < Math.min(rows.length, 15); r++) if ((rows[r] || []).some((c) => S(c).toLowerCase() === 'họ tên ncs')) { hr = r; break; }
  if (hr < 0) throw new Error("Không tìm thấy dòng tiêu đề có cột 'Họ tên NCS'.");
  const col = {};
  rows[hr].forEach((h, i) => { const k = HEADER_ALIASES[S(h).toLowerCase()]; if (k && !(k in col)) col[k] = i; });
  Object.assign(col, { act1: col.act1 ?? 3, act2: col.act2 ?? 4, flag_n: col.flag_n ?? 13, cycle_alt: col.cycle_alt ?? 20 });
  let batch = '';
  for (let r = 0; r < hr; r++) (rows[r] || []).forEach((c) => { const m = S(c).match(/thanh toán\s*([\d./]+)/i); if (m) batch = m[1].replace(/\.$/, ''); });

  const stats = { added: 0, updated: 0, supervisors_added: 0, milestones_added: 0 }; const warnings = []; let khoa = '';
  const g = (row, k) => (col[k] != null ? row[col[k]] : null);
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r] || []; const first = S(row[0]);
    const mk = first.match(/^NCS\s*(\d{4})$/i); if (mk) { khoa = mk[1]; continue; }
    const name = S(g(row, 'ho_ten')); if (!name) continue;
    const who = `Dòng ${r + 1} (${name})`; const notes = [];
    // email
    const parts = S(g(row, 'email')).split(/[;,\s]+/).filter((p) => p.includes('@'));
    const sis = parts.filter((p) => /sis\.hust/i.test(p)); const other = parts.filter((p) => !sis.includes(p));
    if (other.length > 1) notes.push('Email khác: ' + other.slice(1).join(', '));
    // phone
    let phone = S(g(row, 'dien_thoai'));
    if (phone && /[/.]/.test(phone)) { warnings.push(`${who}: ô Điện thoại có giá trị '${phone}' không giống số điện thoại – đã bỏ trống, ghi vào ghi chú.`); notes.push('SĐT trong file gốc: ' + phone); phone = ''; }
    else if (phone) { phone = phone.replace(/\D/g, ''); if (phone.length === 9 && phone[0] !== '0') phone = '0' + phone; }
    // thời gian
    const tgRaw = g(row, 'thoi_gian'); let tg = null;
    if (S(tgRaw)) { const n = Number(S(tgRaw)); if (Number.isFinite(n)) tg = n; else notes.push('Tiến độ (cột Thời gian đào tạo): ' + S(tgRaw)); }
    const keHoach = S(g(row, 'ke_hoach'));
    const blob = (S(tgRaw) + ' ' + keHoach).toLowerCase();
    const status = blob.includes('đã bảo vệ') ? 'Đã bảo vệ cấp trường' : blob.includes('hết hạn') ? 'Hết hạn' : 'Đang đào tạo';
    // CBHD
    const p1 = splitPeople(g(row, 'cbhd1')); let p2 = splitPeople(g(row, 'cbhd2'));
    if (p1.length > 1 && !p2.length) p2 = p1.slice(1, 2);
    const cbhd1 = p1.length ? supervisorId(p1[0], stats) : ''; const cbhd2 = p2.length ? supervisorId(p2[0], stats) : '';
    if (!p1.length) warnings.push(`${who}: chưa có CB hướng dẫn.`);
    const ngayQd = parseDate(g(row, 'ngay_qd')); if (!ngayQd && S(g(row, 'ngay_qd'))) warnings.push(`${who}: không đọc được Ngày QĐ '${S(g(row, 'ngay_qd'))}'.`);
    const ngaySinh = parseDate(g(row, 'ngay_sinh')); if (!ngaySinh && S(g(row, 'ngay_sinh'))) warnings.push(`${who}: không đọc được Ngày sinh '${S(g(row, 'ngay_sinh'))}'.`);
    const rec = {
      ma_ncs: S(g(row, 'ma_ncs')), ho_ten: name, khoa, nhom_cm: S(g(row, 'nhom_cm')), ngay_sinh: ngaySinh, co_quan: S(g(row, 'co_quan')), de_tai: S(g(row, 'de_tai')),
      cbhd1_id: cbhd1, cbhd2_id: cbhd2, cbhd2_ngoai: S(g(row, 'flag_n')).toLowerCase() === 'x', email_ca_nhan: other[0] || '', email_sis: sis[0] || '', dien_thoai: phone,
      so_qd: S(g(row, 'so_qd')), ngay_qd: ngayQd, thoi_gian_dao_tao: tg, gia_han_den: null, chu_ky_bc: parseCycle(g(row, 'chu_ky_bc')).length ? parseCycle(g(row, 'chu_ky_bc')) : parseCycle(g(row, 'cycle_alt')),
      trang_thai: status, ke_hoach: keHoach, ghi_chu: notes.join('; '),
    };
    let ex = DB.students.find((s) => (rec.ma_ncs ? s.ma_ncs === rec.ma_ncs : nameKey(s.ho_ten) === nameKey(name) && s.khoa === khoa));
    let st;
    if (ex) { Object.entries(rec).forEach(([k, v]) => { if (v != null && v !== '' && v !== false && !(Array.isArray(v) && !v.length)) ex[k] = v; }); st = upsert('students', ex); stats.updated++; }
    else { st = upsert('students', rec); stats.added++; }
    ['act1', 'act2'].forEach((k) => activityMilestones(g(row, k), batch).forEach((m) => {
      if (DB.milestones.some((x) => x.student_id === st.id && x.ghi_chu === m.ghi_chu && x.loai === m.loai)) return;
      m.student_id = st.id; upsert('milestones', m); stats.milestones_added++;
    }));
  }
  return { stats, warnings };
}

// ============================================================ xuất Excel
function sheetFrom(headers, rows, widths) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h) => ({ wch: (widths && widths[h]) || Math.max(12, Math.min(45, h.length + 4)) }));
  ws['!autofilter'] = { ref: ws['!ref'] };
  return ws;
}
const ST_HEAD = ['Khoá', 'Mã NCS', 'Họ tên', 'Ngày sinh', 'Nhóm CM', 'Cơ quan công tác', 'Đề tài', 'CBHD 1', 'CBHD 2', 'CBHD2 ngoài trường', 'Email cá nhân', 'Email SIS', 'Điện thoại', 'Số QĐ công nhận', 'Ngày QĐ', 'Thời gian ĐT (năm)', 'Hạn kết thúc', 'Số tháng còn lại', 'Chu kỳ BC 6 tháng', 'Trạng thái', 'Mốc gần nhất đã xong', 'Mốc tiếp theo', 'Kế hoạch tiếp theo', 'Ghi chú'];
const ST_W = { 'Họ tên': 24, 'Đề tài': 50, 'Cơ quan công tác': 30, 'CBHD 1': 26, 'CBHD 2': 26, 'Email cá nhân': 28, 'Email SIS': 30, 'Ghi chú': 40, 'Kế hoạch tiếp theo': 30, 'Mốc tiếp theo': 28 };
const studentRows = (list) => list.map((st) => { const e = enrich(st); const nm = e.next_milestone; return [e.khoa, e.ma_ncs, e.ho_ten, fmtDate(e.ngay_sinh), e.nhom_cm, e.co_quan, e.de_tai, supName(e.cbhd1), supName(e.cbhd2), e.cbhd2_ngoai ? 'x' : '', e.email_ca_nhan, e.email_sis, e.dien_thoai, e.so_qd, fmtDate(e.ngay_qd), e.thoi_gian_dao_tao, fmtDate(e.end_date), e.months_left, cycleLabel(e.cycle), e.trang_thai, e.last_milestone ? e.last_milestone.loai : '', nm ? `${nm.loai} (${fmtDate(nm.ngay_du_kien)})` : '', e.ke_hoach, e.ghi_chu]; });
const MS_HEAD = ['Mã NCS', 'Họ tên NCS', 'Khoá', 'Mốc / hoạt động', 'Hạn dự kiến', 'Ngày thực hiện', 'Kết quả', 'Hội đồng / người đánh giá', 'GV ngoài trường', 'Đợt thanh toán', 'Thanh toán', 'Ghi chú'];
const MS_W = { 'Họ tên NCS': 24, 'Mốc / hoạt động': 24, 'Hội đồng / người đánh giá': 30, 'GV ngoài trường': 32, 'Ghi chú': 45 };
const msRows = (list) => list.map((m) => { const s = getItem('students', m.student_id) || {}; return [s.ma_ncs, s.ho_ten, s.khoa, m.loai, fmtDate(m.ngay_du_kien), fmtDate(m.ngay_thuc_hien), m.ket_qua, m.nguoi_danh_gia, m.gv_ngoai, m.dot_thanh_toan, m.da_thanh_toan ? 'Đã TT' : '', m.ghi_chu]; });
function exportAll(list = DB.students, name) {
  const wb = XLSX.utils.book_new(); const ids = new Set(list.map((s) => s.id));
  XLSX.utils.book_append_sheet(wb, sheetFrom(ST_HEAD, studentRows(list), ST_W), 'NCS');
  XLSX.utils.book_append_sheet(wb, sheetFrom(MS_HEAD, msRows(DB.milestones.filter((m) => ids.has(m.student_id))), MS_W), 'Mốc tiến độ');
  XLSX.utils.book_append_sheet(wb, sheetFrom(['Học hàm/học vị', 'Họ tên', 'Đơn vị', 'Trong/ngoài trường', 'Email', 'Điện thoại', 'Số NCS (HD1)', 'Số NCS (HD2)'],
    DB.supervisors.map((s) => [s.hoc_ham_hoc_vi, s.ho_ten, s.don_vi, s.ngoai_truong ? 'Ngoài trường' : 'Trong trường', s.email, s.dien_thoai, DB.students.filter((x) => x.cbhd1_id === s.id).length, DB.students.filter((x) => x.cbhd2_id === s.id).length]), { 'Họ tên': 26, 'Đơn vị': 30, Email: 28 }), 'Cán bộ hướng dẫn');
  XLSX.writeFile(wb, name || `QLSDH_NCS_${todayISO()}.xlsx`);
}

// ============================================================ router & hiển thị
let FLASH = [];
const flash = (msg, cat = 'ok') => FLASH.push([cat, msg]);
const showError = (msg) => { document.getElementById('flash').innerHTML = `<div class="flash error">${msg}</div>`; window.scrollTo(0, 0); };
function parseHash() {
  const h = location.hash.replace(/^#\/?/, ''); const [path, qs] = h.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || '') };
}
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };

function route() {
  const { parts, q } = parseHash();
  const [a, b, c] = parts; let html;
  document.querySelectorAll('#nav a').forEach((x) => x.classList.toggle('on', x.dataset.r === (a || '') || (a === 'moc' && x.dataset.r === 'ncs')));
  try {
    if (!a) html = vDashboard();
    else if (a === 'ncs' && !b) html = vStudents(q);
    else if (a === 'ncs' && b === 'moi') html = vStudentForm(null);
    else if (a === 'ncs' && c === 'sua') html = vStudentForm(b);
    else if (a === 'ncs') html = vStudentDetail(b);
    else if (a === 'moc' && b === 'moi') html = vMilestoneForm(null, q.get('sid'), q.get('next'));
    else if (a === 'moc') html = vMilestoneForm(b, null, q.get('next'));
    else if (a === 'tien-do') html = vProgress(q);
    else if (a === 'bao-cao') html = vReports(q);
    else if (a === 'thanh-toan') html = vPayments(q);
    else if (a === 'cbhd' && !b) html = vSupervisors();
    else if (a === 'cbhd') html = vSupervisorForm(b === 'moi' ? null : b);
    else if (a === 'du-lieu') html = vData();
    else if (a === 'cai-dat') html = vSettings();
    else if (a === 'nhat-ky') html = vLog();
    else html = notFound();
  } catch (e) { console.error(e); html = `<h1>Lỗi</h1><div class="card">${esc(e.message)}</div>`; }
  document.getElementById('app').innerHTML = html;
  document.getElementById('flash').innerHTML = FLASH.map(([c, m]) => `<div class="flash ${c === 'error' ? 'error' : c}">${m}</div>`).join(''); FLASH = [];
  window.scrollTo(0, 0);
}
const notFound = () => '<h1>Không tìm thấy</h1><div class="card">Bản ghi không tồn tại hoặc đã bị xoá. <a href="#/">Về trang tổng quan</a></div>';

// ---------- mẩu giao diện
const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label ?? v)}</option>`;
const tag = (t, cls = '') => `<span class="tag ${cls}">${esc(t)}</span>`;
function monthsTag(e) {
  if (!e.active || e.months_left == null) return '';
  if (e.months_left < 0) return tag(`quá hạn ${-e.months_left} tháng`, 'bad');
  if (e.months_left <= DB.settings.warn_months_before_end) return tag(`còn ${e.months_left} tháng`, 'warn');
  return `<span class="small">còn ${e.months_left} tháng</span>`;
}
const stLink = (e) => `<a href="#/ncs/${e.id}">${esc(e.ho_ten)}</a>`;

// ---------- Tổng quan
function vDashboard() {
  const al = alerts(); const s = DB.settings;
  const active = DB.students.filter(isActive);
  const count = (arr, f) => { const m = {}; arr.forEach((x) => { const k = f(x); m[k] = (m[k] || 0) + 1; }); return Object.entries(m); };
  const unpaid = DB.milestones.filter((m) => m.dot_thanh_toan && !m.da_thanh_toan).length;
  const li = (arr, f) => arr.length ? `<ul class="alert-list">${arr.map(f).join('')}</ul>` : '';
  if (!DB.students.length) return `<h1>Tổng quan</h1><div class="card"><b>Chưa có dữ liệu.</b><br><br>
    1. Vào <a href="#/du-lieu">Dữ liệu</a> → <b>Chọn / tạo file dữ liệu</b> để dữ liệu được tự lưu vào một file trên máy (khuyến nghị).<br>
    2. Sau đó <b>Nhập từ Excel</b> file theo dõi NCS hiện có, hoặc <a href="#/ncs/moi">thêm NCS mới</a>.</div>`;
  return `<h1>Tổng quan</h1><p class="sub">Hôm nay ${fmtDate(todayISO())} · cảnh báo hết hạn trước ${s.warn_months_before_end} tháng</p>
  <div class="grid g4">
    <div class="stat"><b>${active.length}</b><span>NCS đang theo dõi (tổng ${DB.students.length})</span></div>
    <div class="stat ${al.expired.length ? 'bad' : ''}"><b>${al.expired.length}</b><span>Đã quá hạn đào tạo</span></div>
    <div class="stat ${al.ending.length ? 'warn' : ''}"><b>${al.ending.length}</b><span>Sắp hết hạn</span></div>
    <div class="stat ${al.overdue.length ? 'warn' : ''}"><b>${al.overdue.length}</b><span>Có mốc trễ hạn</span></div>
    <div class="stat ${al.no_report.length ? 'warn' : ''}"><b>${al.no_report.length}</b><span>Chưa nộp BC 6 tháng kỳ gần nhất</span></div>
    <div class="stat"><b>${unpaid}</b><span><a href="#/thanh-toan">Hoạt động chưa thanh toán</a></span></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h2 style="margin-top:0">Cảnh báo hạn đào tạo</h2>
      ${!al.expired.length && !al.ending.length ? '<p class="small">Không có NCS nào sắp hoặc đã hết hạn.</p>' : ''}
      ${li([...al.expired, ...al.ending], (e) => `<li>${stLink(e)} <span class="small">(${esc(e.khoa)})</span> ${monthsTag(e)} <span class="small">hạn ${fmtDate(e.end_date)}</span></li>`)}</div>
    <div class="card"><h2 style="margin-top:0">Mốc tiến độ trễ hạn</h2>
      ${al.overdue.length ? li(al.overdue, (e) => `<li>${stLink(e)}: ${e.overdue.map((m) => tag(`${m.loai} (${fmtDate(m.ngay_du_kien)})`, 'bad')).join(' ')}</li>`) : '<p class="small">Không có mốc nào trễ hạn.</p>'}</div>
    <div class="card"><h2 style="margin-top:0">Chưa nộp báo cáo 6 tháng (kỳ gần nhất)</h2>
      ${al.no_report.length ? li(al.no_report, (e) => `<li>${stLink(e)} <a class="tag warn" href="#/bao-cao?ky=${e.last_period}">kỳ ${periodLabel(e.last_period)}</a></li>`) : '<p class="small">Tất cả đã nộp.</p>'}</div>
    <div class="card"><h2 style="margin-top:0">Hồ sơ thiếu thông tin</h2><p class="small">Thiếu Mã NCS, Ngày QĐ, thời gian đào tạo hoặc CBHD 1.</p>
      ${li(al.missing, (e) => `<li><a href="#/ncs/${e.id}/sua">${esc(e.ho_ten)}</a> <span class="small">(${esc(e.khoa)})</span> ${!e.ma_ncs ? tag('thiếu mã') : ''} ${!e.ngay_qd ? tag('thiếu ngày QĐ') : ''} ${!e.cbhd1_id ? tag('thiếu CBHD') : ''} ${!e.thoi_gian_dao_tao ? tag('thiếu thời gian ĐT') : ''}</li>`)}</div>
  </div>
  <div class="grid g2">
    <div class="card"><h2 style="margin-top:0">NCS đang theo dõi theo khoá</h2>
      ${count(active, (x) => x.khoa || '?').sort((a, b) => b[0].localeCompare(a[0])).map(([k, n]) => `<div class="kv"><a href="#/ncs?khoa=${esc(k)}">NCS ${esc(k)}</a><b>${n}</b></div>`).join('')}</div>
    <div class="card"><h2 style="margin-top:0">Theo nhóm chuyên môn / trạng thái</h2>
      ${count(active, (x) => x.nhom_cm || 'Chưa phân nhóm').sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="kv"><span>${esc(k)}</span><b>${n}</b></div>`).join('')}
      <div style="height:10px"></div>
      ${count(DB.students, (x) => x.trang_thai || 'Đang đào tạo').sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="kv"><a href="#/ncs?tt=${encodeURIComponent(k)}">${esc(k)}</a><b>${n}</b></div>`).join('')}</div>
  </div>`;
}

// ---------- Danh sách NCS
function filterStudents(q) {
  const kw = (q.get('q') || '').toLowerCase(); const showAll = q.get('all') === '1'; const tt = q.get('tt') || '';
  return DB.students.filter((st) => {
    if (!showAll && !tt && !isActive(st)) return false;
    if (kw && !['ho_ten', 'ma_ncs', 'de_tai', 'co_quan', 'email_ca_nhan', 'email_sis'].map((k) => st[k] || '').join(' ').toLowerCase().includes(kw)) return false;
    if (q.get('khoa') && st.khoa !== q.get('khoa')) return false;
    if (q.get('nhom') && (st.nhom_cm || '') !== q.get('nhom')) return false;
    if (q.get('cbhd') && ![st.cbhd1_id, st.cbhd2_id].includes(q.get('cbhd'))) return false;
    if (tt && (st.trang_thai || 'Đang đào tạo') !== tt) return false;
    return true;
  }).sort((a, b) => (+(b.khoa) || 0) - (+(a.khoa) || 0) || byName(a, b));
}
function vStudents(q) {
  const list = filterStudents(q); const s = DB.settings;
  const khoas = [...new Set(DB.students.map((x) => x.khoa).filter(Boolean))].sort().reverse();
  const sups = [...DB.supervisors].sort(byName);
  const rows = list.map((st) => { const e = enrich(st); return `<tr>
    <td>${esc(e.khoa)}</td><td class="nowrap">${esc(e.ma_ncs)}</td>
    <td><a href="#/ncs/${e.id}"><b>${esc(e.ho_ten)}</b></a><div class="small">${esc(e.co_quan)}</div></td>
    <td>${esc(e.nhom_cm)}</td><td style="max-width:340px">${esc(e.de_tai)}</td>
    <td class="small" style="min-width:150px">${esc(supName(e.cbhd1))}${e.cbhd2 ? '<br>' + esc(supName(e.cbhd2)) + (e.cbhd2_ngoai ? ' ' + tag('ngoài') : '') : ''}</td>
    <td class="nowrap">${fmtDate(e.end_date)}<br>${monthsTag(e)}</td>
    <td class="small" style="min-width:150px">${e.last_milestone ? '✔ ' + esc(e.last_milestone.loai) + '<br>' : ''}${e.next_milestone ? '→ ' + esc(e.next_milestone.loai) + (e.next_milestone.ngay_du_kien ? ` (${fmtDate(e.next_milestone.ngay_du_kien)})` : '') : ''}${e.overdue.length ? '<br>' + tag(e.overdue.length + ' mốc trễ', 'bad') : ''}</td>
    <td class="nowrap">${cycleLabel(e.cycle)}${e.active && e.last_period ? '<br>' + (e.last_period_ok ? tag('đã nộp', 'ok') : tag('chưa nộp', 'warn')) : ''}</td>
    <td>${tag(e.trang_thai || 'Đang đào tạo', e.active ? 'blue' : '')}</td></tr>`; }).join('');
  return `<div class="bar"><h1 class="grow">Hồ sơ NCS <span class="small">(${list.length})</span></h1>
    <button class="btn" data-click="exportList">Xuất Excel danh sách này</button><a class="btn pri" href="#/ncs/moi">+ Thêm NCS</a></div>
  <form class="bar" data-action="filterStudents">
    <input type="search" name="q" value="${esc(q.get('q') || '')}" placeholder="Tìm tên, mã, đề tài, cơ quan, email…" style="min-width:260px">
    <select name="khoa"><option value="">Mọi khoá</option>${khoas.map((k) => opt(k, k, q.get('khoa') === k)).join('')}</select>
    <select name="nhom"><option value="">Mọi nhóm CM</option>${s.groups.map((g) => opt(g, g, q.get('nhom') === g)).join('')}</select>
    <select name="cbhd"><option value="">Mọi CBHD</option>${sups.map((x) => opt(x.id, x.ho_ten, q.get('cbhd') === x.id)).join('')}</select>
    <select name="tt"><option value="">Trạng thái: đang theo dõi</option>${s.statuses.map((t) => opt(t, t, q.get('tt') === t)).join('')}</select>
    <label class="inline"><input type="checkbox" name="all" value="1" ${q.get('all') === '1' ? 'checked' : ''}> Gồm cả đã bảo vệ / hết hạn</label>
    <button class="btn">Lọc</button> <a href="#/ncs" class="small">Xoá lọc</a></form>
  <div class="tbl"><table><thead><tr><th>Khoá</th><th>Mã NCS</th><th>Họ tên</th><th>Nhóm</th><th>Đề tài</th><th>CBHD</th><th>Hạn kết thúc</th><th>Mốc gần nhất / tiếp theo</th><th>BC 6T</th><th>Trạng thái</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="10" class="small">Không có NCS nào khớp điều kiện lọc.</td></tr>'}</tbody></table></div>`;
}

// ---------- Form NCS
function vStudentForm(id) {
  const st = id ? getItem('students', id) : { trang_thai: 'Đang đào tạo', thoi_gian_dao_tao: 3, chu_ky_bc: [] };
  if (!st) return notFound();
  const s = DB.settings; const sups = [...DB.supervisors].sort(byName); const cyc = st.chu_ky_bc || [];
  const v = (k) => esc(st[k] ?? '');
  return `<h1>${id ? 'Sửa hồ sơ: ' + esc(st.ho_ten) : 'Thêm NCS mới'}</h1><p class="sub">Trường có dấu * là bắt buộc.</p>
  <div class="card"><form class="f" data-action="saveStudent" data-id="${id || ''}">
    <div><label>Họ tên NCS *</label><input type="text" name="ho_ten" value="${v('ho_ten')}" required></div>
    <div><label>Mã NCS</label><input type="text" name="ma_ncs" value="${v('ma_ncs')}" placeholder="VD: 20250105D"></div>
    <div><label>Khoá (năm)</label><input type="text" name="khoa" value="${v('khoa')}" placeholder="VD: 2025"></div>
    <div><label>Nhóm chuyên môn</label><select name="nhom_cm"><option value="">—</option>${s.groups.map((g) => opt(g, g, st.nhom_cm === g)).join('')}</select></div>
    <div><label>Ngày sinh</label><input type="date" name="ngay_sinh" value="${v('ngay_sinh')}"></div>
    <div><label>Cơ quan công tác</label><input type="text" name="co_quan" value="${v('co_quan')}"></div>
    <div class="full"><label>Đề tài</label><textarea name="de_tai">${v('de_tai')}</textarea></div>
    <div><label>Cán bộ hướng dẫn 1</label><select name="cbhd1_id"><option value="">—</option>${sups.map((x) => opt(x.id, supName(x), st.cbhd1_id === x.id)).join('')}</select></div>
    <div><label>Cán bộ hướng dẫn 2</label><select name="cbhd2_id"><option value="">—</option>${sups.map((x) => opt(x.id, supName(x), st.cbhd2_id === x.id)).join('')}</select>
      <label class="inline" style="margin-top:6px"><input type="checkbox" name="cbhd2_ngoai" ${st.cbhd2_ngoai ? 'checked' : ''}> CBHD 2 ngoài trường (cột N)</label></div>
    <div class="small" style="align-self:end">Chưa có cán bộ trong danh sách? Lưu hồ sơ trước, vào <a href="#/cbhd/moi">Thêm cán bộ</a>, rồi quay lại sửa.</div>
    <div><label>Email cá nhân</label><input type="text" name="email_ca_nhan" value="${v('email_ca_nhan')}"></div>
    <div><label>Email SIS</label><input type="text" name="email_sis" value="${v('email_sis')}"></div>
    <div><label>Điện thoại</label><input type="text" name="dien_thoai" value="${v('dien_thoai')}"></div>
    <div><label>Số QĐ công nhận NCS</label><input type="text" name="so_qd" value="${v('so_qd')}"></div>
    <div><label>Ngày QĐ công nhận</label><input type="date" name="ngay_qd" value="${v('ngay_qd')}"></div>
    <div><label>Thời gian đào tạo (năm)</label><input type="number" step="0.5" min="0" name="thoi_gian_dao_tao" value="${v('thoi_gian_dao_tao')}"></div>
    <div><label>Gia hạn đến (nếu có)</label><input type="date" name="gia_han_den" value="${v('gia_han_den')}"><div class="small">Nếu nhập, ngày này thay cho hạn tính từ QĐ.</div></div>
    <div><label>Trạng thái</label><select name="trang_thai">${s.statuses.map((t) => opt(t, t, (st.trang_thai || 'Đang đào tạo') === t)).join('')}</select></div>
    <div class="full"><label>Chu kỳ báo cáo 6 tháng (chọn 2 tháng)</label>
      ${Array.from({ length: 12 }, (_, i) => i + 1).map((m) => `<label class="inline"><input type="checkbox" name="chu_ky_bc" value="${m}" ${cyc.includes(m) ? 'checked' : ''}> T${m}</label>`).join('')}
      <div class="small">Bỏ trống: tự lấy tháng của ngày QĐ và 6 tháng sau đó.</div></div>
    <div class="full"><label>Kế hoạch tiếp theo</label><input type="text" name="ke_hoach" value="${v('ke_hoach')}"></div>
    <div class="full"><label>Ghi chú</label><textarea name="ghi_chu">${v('ghi_chu')}</textarea></div>
    ${id ? '' : '<div class="full"><label class="inline"><input type="checkbox" name="tao_lo_trinh" checked> Tự tạo lộ trình mốc chuẩn (theo Cài đặt) từ ngày QĐ</label></div>'}
    <div class="full"><button class="btn pri">Lưu</button> <a class="btn" href="${id ? '#/ncs/' + id : '#/ncs'}">Huỷ</a></div>
  </form></div>`;
}

// ---------- Chi tiết NCS
function vStudentDetail(id) {
  const st = getItem('students', id); if (!st) return notFound();
  const e = enrich(st); const today = todayISO();
  const reps = {}; DB.reports.filter((r) => r.student_id === id).forEach((r) => { reps[r.ky] = r; });
  const periods = duePeriods(st).reverse();
  const ms = e.milestones.map((m) => {
    const late = !m.ngay_thuc_hien && m.ngay_du_kien && m.ngay_du_kien < today;
    return `<li><span class="dot ${m.ngay_thuc_hien ? 'done' : late ? 'late' : ''}"></span>
      <div><b>${esc(m.loai)}</b> ${m.ngay_thuc_hien ? tag('xong ' + fmtDate(m.ngay_thuc_hien), 'ok') : late ? tag('trễ – hạn ' + fmtDate(m.ngay_du_kien), 'bad') : m.ngay_du_kien ? `<span class="small">hạn dự kiến ${fmtDate(m.ngay_du_kien)}</span>` : ''} ${m.ket_qua ? tag(m.ket_qua, 'blue') : ''}
        <div class="small">${m.nguoi_danh_gia ? 'Hội đồng/đánh giá: ' + esc(m.nguoi_danh_gia) + '. ' : ''}${m.gv_ngoai ? 'GV ngoài: ' + esc(m.gv_ngoai) + '. ' : ''}${m.dot_thanh_toan ? `Thanh toán đợt ${esc(m.dot_thanh_toan)}: ${m.da_thanh_toan ? 'đã TT' : 'chưa TT'}. ` : ''}${m.ghi_chu ? '<br>' + esc(m.ghi_chu) : ''}</div></div>
      <div class="nowrap">${m.ngay_thuc_hien ? '' : `<button class="btn sm" data-click="msDone" data-id="${m.id}">✔ Xong</button>`} <a class="btn sm" href="#/moc/${m.id}">Sửa</a></div></li>`;
  }).join('');
  return `<div class="bar"><div class="grow"><h1>${esc(e.ho_ten)}</h1>${tag(e.trang_thai || 'Đang đào tạo', e.active ? 'blue' : '')}
      <span class="small">Mã ${esc(e.ma_ncs || '—')} · Khoá ${esc(e.khoa || '—')} · ${esc(e.nhom_cm || 'chưa phân nhóm')}</span></div>
    <a class="btn" href="#/ncs/${id}/sua">Sửa hồ sơ</a><button class="btn danger" data-click="delStudent" data-id="${id}">Xoá</button></div>
  <div class="grid g2">
    <div class="card"><dl class="info">
      <dt>Đề tài</dt><dd><b>${esc(e.de_tai || '—')}</b></dd>
      <dt>CBHD 1</dt><dd>${e.cbhd1 ? `<a href="#/cbhd/${e.cbhd1.id}">${esc(supName(e.cbhd1))}</a>` : '—'}</dd>
      <dt>CBHD 2</dt><dd>${e.cbhd2 ? `<a href="#/cbhd/${e.cbhd2.id}">${esc(supName(e.cbhd2))}</a>${e.cbhd2_ngoai ? ' ' + tag('ngoài trường') : ''}` : '—'}</dd>
      <dt>Ngày sinh</dt><dd>${fmtDate(e.ngay_sinh) || '—'}</dd><dt>Cơ quan công tác</dt><dd>${esc(e.co_quan || '—')}</dd>
      <dt>Email</dt><dd>${esc(e.email_ca_nhan || '')}${e.email_sis ? '<br>' + esc(e.email_sis) : ''}</dd><dt>Điện thoại</dt><dd>${esc(e.dien_thoai || '—')}</dd>
    </dl></div>
    <div class="card"><dl class="info">
      <dt>QĐ công nhận</dt><dd>${esc(e.so_qd || '—')} ${e.ngay_qd ? 'ngày ' + fmtDate(e.ngay_qd) : ''}</dd>
      <dt>Thời gian đào tạo</dt><dd>${esc(e.thoi_gian_dao_tao ?? '—')} năm</dd>
      <dt>Hạn kết thúc</dt><dd>${fmtDate(e.end_date) || '—'} ${e.gia_han_den ? tag('đã gia hạn') : ''} ${monthsTag(e)}</dd>
      <dt>Chu kỳ BC 6 tháng</dt><dd>${cycleLabel(e.cycle) || '—'}</dd>
      <dt>Kế hoạch tiếp theo</dt><dd>${esc(e.ke_hoach || '—')}</dd><dt>Ghi chú</dt><dd style="white-space:pre-wrap">${esc(e.ghi_chu || '—')}</dd>
    </dl></div>
  </div>
  <div class="card"><div class="bar"><h2 class="grow" style="margin:0">Tiến độ theo mốc <span class="small">(${e.done_count}/${e.milestones.length} đã xong)</span></h2>
    <button class="btn" data-click="genMilestones" data-id="${id}">Tạo lộ trình mốc chuẩn</button><a class="btn pri" href="#/moc/moi?sid=${id}">+ Thêm mốc / hoạt động</a></div>
    ${e.milestones.length ? '' : '<p class="small">Chưa có mốc nào. Bấm “Tạo lộ trình mốc chuẩn” để sinh tự động.</p>'}
    <ul class="timeline">${ms}</ul></div>
  <div class="card"><h2 style="margin-top:0">Báo cáo 6 tháng</h2>
    ${periods.length ? `<table><thead><tr><th>Kỳ</th><th>Tình trạng</th><th>Ngày nộp</th><th>Ghi chú</th></tr></thead><tbody>
      ${periods.map((p) => { const r = reps[p] || {}; return `<tr><td><a href="#/bao-cao?ky=${p}">${periodLabel(p)}</a></td><td>${r.da_nop ? tag('đã nộp', 'ok') : tag('chưa ghi nhận', 'warn')}</td><td>${fmtDate(r.ngay_nop)}</td><td>${esc(r.ghi_chu || '')}</td></tr>`; }).join('')}
    </tbody></table>` : '<p class="small">Chưa đến kỳ báo cáo nào (hoặc thiếu ngày QĐ / chu kỳ).</p>'}</div>`;
}

// ---------- Form mốc
function vMilestoneForm(id, sid, next) {
  const m = id ? getItem('milestones', id) : {}; if (id && !m) return notFound();
  const st = getItem('students', id ? m.student_id : sid); if (!st) return notFound();
  const types = DB.settings.milestone_types.map((t) => t.name); const v = (k) => esc(m[k] ?? '');
  return `<h1>${id ? 'Sửa mốc: ' + esc(m.loai) : 'Thêm mốc / hoạt động'}</h1><p class="sub">NCS: <a href="#/ncs/${st.id}">${esc(st.ho_ten)}</a> (${esc(st.ma_ncs || 'chưa có mã')})</p>
  <div class="card"><form class="f" data-action="saveMilestone" data-id="${id || ''}" data-sid="${st.id}" data-next="${esc(next || '')}">
    <div><label>Loại mốc</label><select name="loai"><option value="">— chọn —</option>${types.map((t) => opt(t, t, m.loai === t)).join('')}${m.loai && !types.includes(m.loai) ? opt(m.loai, m.loai, true) : ''}</select></div>
    <div><label>…hoặc nhập tên khác</label><input type="text" name="loai_khac" placeholder="VD: Hội thảo quốc tế"></div>
    <div><label>Hạn dự kiến</label><input type="date" name="ngay_du_kien" value="${v('ngay_du_kien')}"></div>
    <div><label>Ngày thực hiện (bỏ trống = chưa xong)</label><input type="date" name="ngay_thuc_hien" value="${v('ngay_thuc_hien')}"></div>
    <div><label>Kết quả</label><input type="text" name="ket_qua" value="${v('ket_qua')}" placeholder="Đạt / Đạt có chỉnh sửa / Không đạt"></div>
    <div class="full"><label>Hội đồng / người đánh giá</label><input type="text" name="nguoi_danh_gia" value="${v('nguoi_danh_gia')}"></div>
    <div class="full"><label>GV ngoài trường tham gia</label><input type="text" name="gv_ngoai" value="${v('gv_ngoai')}" placeholder="Họ tên, đơn vị"></div>
    <div><label>Đợt thanh toán</label><input type="text" name="dot_thanh_toan" value="${v('dot_thanh_toan')}" placeholder="VD: 9.2026"></div>
    <div style="align-self:end"><label class="inline"><input type="checkbox" name="da_thanh_toan" ${m.da_thanh_toan ? 'checked' : ''}> Đã thanh toán</label></div>
    <div class="full"><label>Ghi chú</label><textarea name="ghi_chu">${v('ghi_chu')}</textarea></div>
    <div class="full"><button class="btn pri">Lưu</button> <a class="btn" href="${esc(next || '#/ncs/' + st.id)}">Huỷ</a>
      ${id ? `<button type="button" class="btn danger" style="float:right" data-click="delMilestone" data-id="${id}">Xoá mốc</button>` : ''}</div>
  </form></div>`;
}

// ---------- Bảng tiến độ
function vProgress(q) {
  const types = DB.settings.milestone_types.map((t) => t.name); const fk = q.get('khoa') || ''; const today = todayISO();
  const khoas = [...new Set(DB.students.map((x) => x.khoa).filter(Boolean))].sort().reverse();
  const list = DB.students.filter((s) => isActive(s) && (!fk || s.khoa === fk)).sort((a, b) => (a.khoa || '').localeCompare(b.khoa || '') || byName(a, b));
  const back = encodeURIComponent(location.hash);
  const rows = list.map((st) => { const e = enrich(st); const cells = {};
    e.milestones.forEach((m) => { const p = cells[m.loai]; if (!p || (m.ngay_thuc_hien && !p.ngay_thuc_hien)) cells[m.loai] = m; });
    return `<tr><td class="nowrap"><a href="#/ncs/${e.id}"><b>${esc(e.ho_ten)}</b></a><div class="small">${esc(e.khoa)} · ${esc(e.nhom_cm)}</div></td>
      ${types.map((t) => { const m = cells[t]; if (!m) return '<td></td>'; const late = !m.ngay_thuc_hien && m.ngay_du_kien && m.ngay_du_kien < today;
        return `<td class="nowrap ${m.ngay_thuc_hien ? 'cell-done' : late ? 'cell-late' : 'cell-plan'}"><a style="color:inherit" href="#/moc/${m.id}?next=${back}">${fmtDate(m.ngay_thuc_hien || m.ngay_du_kien) || '✓'}</a></td>`; }).join('')}
      <td class="small">${e.milestones.filter((m) => !types.includes(m.loai)).map((m) => esc(m.loai) + (m.ngay_thuc_hien ? ' ✔' : '')).join('<br>')}</td></tr>`; }).join('');
  return `<div class="bar"><h1 class="grow">Bảng tiến độ theo mốc</h1>
    <select data-change="progressKhoa"><option value="">Mọi khoá</option>${khoas.map((k) => opt(k, k, fk === k)).join('')}</select></div>
  <p class="sub">${tag('ngày', 'ok')} đã xong · ${tag('ngày', 'bad')} trễ hạn · ${tag('ngày')} hạn dự kiến. Bấm vào ô để sửa mốc.</p>
  <div class="tbl progress"><table><thead><tr><th>NCS</th>${types.map((t) => `<th>${esc(t)}</th>`).join('')}<th>Khác</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="${types.length + 2}" class="small">Không có NCS đang theo dõi.</td></tr>`}</tbody></table></div>`;
}

// ---------- Báo cáo 6 tháng
function reportRows(period) {
  const [y, m] = period.split('-').map(Number); const pStart = y * 12 + m - 1;
  return DB.students.filter((st) => {
    if (!isActive(st) || !studentCycle(st).includes(m) || !st.ngay_qd) return false;
    const [qy, qm] = ymd(st.ngay_qd); return qy * 12 + qm - 1 < pStart;
  }).sort((a, b) => (a.khoa || '').localeCompare(b.khoa || '') || byName(a, b))
    .map((st) => ({ st, rep: DB.reports.find((r) => r.student_id === st.id && r.ky === period) || {} }));
}
function vReports(q) {
  const t = todayISO(); const period = q.get('ky') || t.slice(0, 7);
  const rows = reportRows(period); const done = rows.filter((r) => r.rep.da_nop).length;
  const months = []; let [cy, cm] = ymd(t); let k = cy * 12 + cm - 1 + 3;
  for (let i = 0; i < 30; i++, k--) months.push(`${Math.floor(k / 12)}-${pad(k % 12 + 1)}`);
  return `<div class="bar"><h1 class="grow">Báo cáo 6 tháng – kỳ ${periodLabel(period)}</h1>
    <select data-change="reportPeriod">${months.map((p) => opt(p, periodLabel(p), p === period)).join('')}</select>
    <button class="btn" data-click="exportReports" data-ky="${period}">Xuất Excel</button></div>
  <p class="sub">NCS đang theo dõi có chu kỳ báo cáo rơi vào tháng ${+period.split('-')[1]}. Đã nộp: <b>${done}/${rows.length}</b>.</p>
  ${rows.length ? `<form data-action="saveReports" data-ky="${period}"><div class="tbl"><table>
    <thead><tr><th>Khoá</th><th>Họ tên</th><th>CBHD 1</th><th>Đã nộp</th><th>Ngày nộp</th><th>Ghi chú</th></tr></thead><tbody>
    ${rows.map(({ st, rep }) => `<tr><td>${esc(st.khoa)}</td><td><a href="#/ncs/${st.id}">${esc(st.ho_ten)}</a></td><td class="small">${esc(supName(getItem('supervisors', st.cbhd1_id)))}</td>
      <td><input type="checkbox" name="nop_${st.id}" ${rep.da_nop ? 'checked' : ''}></td>
      <td><input type="date" name="ngay_${st.id}" value="${esc(rep.ngay_nop || '')}" style="width:150px"></td>
      <td><input type="text" name="note_${st.id}" value="${esc(rep.ghi_chu || '')}"></td></tr>`).join('')}
    </tbody></table></div><p><button class="btn pri">Lưu kỳ ${periodLabel(period)}</button> <span class="small">Tích “Đã nộp” mà để trống ngày thì lấy ngày hôm nay.</span></p></form>`
    : '<div class="card small">Không có NCS nào phải báo cáo trong kỳ này.</div>'}`;
}

// ---------- Thanh toán
function batchesList() {
  const key = (b) => { const n = b.split(/[./]/).map(Number); return (n[1] || 0) * 100 + (n[0] || 0); };
  return [...new Set(DB.milestones.map((m) => m.dot_thanh_toan).filter(Boolean))].sort((a, b) => key(b) - key(a));
}
function paymentRows(batch, unpaidOnly) {
  return DB.milestones.filter((m) => (m.dot_thanh_toan || '') === batch && (!unpaidOnly || !m.da_thanh_toan))
    .sort((a, b) => { const sa = getItem('students', a.student_id) || {}; const sb = getItem('students', b.student_id) || {}; return (sa.khoa || '').localeCompare(sb.khoa || '') || byName(sa, sb); });
}
function vPayments(q) {
  const batches = batchesList(); const batch = q.get('dot') ?? (batches[0] || ''); const unpaid = q.get('chua') === '1';
  const ms = paymentRows(batch, unpaid); const back = encodeURIComponent(location.hash);
  return `<div class="bar"><h1 class="grow">Hội đồng & thanh toán${batch ? ' – đợt ' + esc(batch) : ''}</h1>
    <select data-change="payBatch">${batches.length ? batches.map((b) => opt(b, b, b === batch)).join('') : '<option value="">(chưa có đợt nào)</option>'}</select>
    <label class="inline"><input type="checkbox" data-change="payUnpaid" ${unpaid ? 'checked' : ''}> Chỉ mục chưa thanh toán</label>
    <button class="btn" data-click="exportPayments">Xuất Excel</button></div>
  <p class="sub">Các mốc / hoạt động có “Đợt thanh toán”. Gán đợt cho hoạt động trong màn hình sửa mốc của NCS.</p>
  ${ms.length ? `<form data-action="savePayments"><div class="tbl"><table>
    <thead><tr><th>Khoá</th><th>NCS</th><th>Hoạt động</th><th>Ngày</th><th>Hội đồng / GV ngoài</th><th>Ghi chú</th><th>Đã TT</th><th></th></tr></thead><tbody>
    ${ms.map((m) => { const st = getItem('students', m.student_id) || {}; return `<tr><td>${esc(st.khoa)}</td><td><a href="#/ncs/${m.student_id}">${esc(st.ho_ten)}</a></td><td>${esc(m.loai)}</td>
      <td class="nowrap">${fmtDate(m.ngay_thuc_hien || m.ngay_du_kien)}</td><td class="small">${esc(m.nguoi_danh_gia)}${m.nguoi_danh_gia && m.gv_ngoai ? '<br>' : ''}${esc(m.gv_ngoai)}</td>
      <td class="small" style="max-width:300px">${esc(m.ghi_chu)}</td><td><input type="checkbox" name="paid_${m.id}" ${m.da_thanh_toan ? 'checked' : ''}></td>
      <td><a class="btn sm" href="#/moc/${m.id}?next=${back}">Sửa</a></td></tr>`; }).join('')}
    </tbody></table></div><p><button class="btn pri">Lưu trạng thái thanh toán</button> <span class="small">${ms.filter((m) => m.da_thanh_toan).length}/${ms.length} đã thanh toán</span></p></form>`
    : '<div class="card small">Không có mục nào.</div>'}`;
}

// ---------- Cán bộ
function vSupervisors() {
  const items = DB.supervisors.map((s) => { const hd1 = DB.students.filter((x) => x.cbhd1_id === s.id); const hd2 = DB.students.filter((x) => x.cbhd2_id === s.id);
    return { s, hd1: hd1.length, hd2: hd2.length, active: [...hd1, ...hd2].filter(isActive).length }; })
    .sort((a, b) => b.active - a.active || byName(a.s, b.s));
  const sorted = [...DB.supervisors].sort(byName);
  return `<div class="bar"><h1 class="grow">Cán bộ hướng dẫn <span class="small">(${items.length})</span></h1><a class="btn pri" href="#/cbhd/moi">+ Thêm cán bộ</a></div>
  <div class="tbl"><table><thead><tr><th>Họ tên</th><th>Đơn vị</th><th>Trong/ngoài</th><th class="num">HD chính</th><th class="num">HD phụ</th><th class="num">Đang HD</th><th>Liên hệ</th></tr></thead><tbody>
  ${items.map((i) => `<tr><td><a href="#/cbhd/${i.s.id}"><b>${esc(supName(i.s))}</b></a></td><td>${esc(i.s.don_vi)}</td><td>${i.s.ngoai_truong ? tag('ngoài trường') : ''}</td>
    <td class="num"><a href="#/ncs?cbhd=${i.s.id}&all=1">${i.hd1}</a></td><td class="num">${i.hd2}</td><td class="num"><b>${i.active}</b></td><td class="small">${esc(i.s.email)} ${esc(i.s.dien_thoai)}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="card" style="margin-top:18px"><h2 style="margin-top:0">Gộp cán bộ trùng tên</h2>
    <p class="small">Dùng khi một người bị ghi thành 2 bản ghi. Các NCS của bản ghi bị gộp sẽ chuyển sang bản ghi giữ lại.</p>
    <form class="bar" data-action="mergeSup">Giữ lại <select name="keep">${sorted.map((s) => opt(s.id, supName(s))).join('')}</select>
      gộp bản ghi <select name="drop">${sorted.map((s) => opt(s.id, supName(s))).join('')}</select><button class="btn">Gộp</button></form></div>`;
}
function vSupervisorForm(id) {
  const s = id ? getItem('supervisors', id) : {}; if (id && !s) return notFound();
  const v = (k) => esc(s[k] ?? '');
  const studs = id ? DB.students.filter((x) => [x.cbhd1_id, x.cbhd2_id].includes(id)).map((x) => enrich(x)) : [];
  return `<h1>${id ? esc(supName(s)) : 'Thêm cán bộ'}</h1>
  <div class="card"><form class="f" data-action="saveSup" data-id="${id || ''}">
    <div><label>Học hàm / học vị</label><input type="text" name="hoc_ham_hoc_vi" value="${v('hoc_ham_hoc_vi')}" placeholder="PGS.TS"></div>
    <div><label>Họ tên *</label><input type="text" name="ho_ten" value="${v('ho_ten')}" required></div>
    <div><label>Đơn vị</label><input type="text" name="don_vi" value="${v('don_vi')}"></div>
    <div><label>Email</label><input type="text" name="email" value="${v('email')}"></div>
    <div><label>Điện thoại</label><input type="text" name="dien_thoai" value="${v('dien_thoai')}"></div>
    <div style="align-self:end"><label class="inline"><input type="checkbox" name="ngoai_truong" ${s.ngoai_truong ? 'checked' : ''}> Ngoài trường</label></div>
    <div class="full"><label>Ghi chú</label><textarea name="ghi_chu">${v('ghi_chu')}</textarea></div>
    <div class="full"><button class="btn pri">Lưu</button> <a class="btn" href="#/cbhd">Huỷ</a>
      ${id ? `<button type="button" class="btn danger" style="float:right" data-click="delSup" data-id="${id}">Xoá cán bộ</button>` : ''}</div>
  </form></div>
  ${studs.length ? `<h2>NCS đang / đã hướng dẫn (${studs.length})</h2><div class="tbl"><table><thead><tr><th>Khoá</th><th>Họ tên</th><th>Vai trò</th><th>Đề tài</th><th>Trạng thái</th></tr></thead><tbody>
    ${studs.map((e) => `<tr><td>${esc(e.khoa)}</td><td>${stLink(e)}</td><td>${e.cbhd1_id === id ? 'HD chính' : 'HD phụ'}</td><td>${esc(e.de_tai)}</td><td>${tag(e.trang_thai || 'Đang đào tạo', e.active ? 'blue' : '')}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

// ---------- Dữ liệu
function vData() {
  const c = (k) => DB[k].length;
  return `<h1>Dữ liệu: nhập / xuất / lưu file</h1>
  <p class="sub">Hiện có ${c('students')} NCS · ${c('supervisors')} cán bộ · ${c('milestones')} mốc · ${c('reports')} báo cáo. Dữ liệu <b>không</b> được gửi lên mạng.</p>
  <div class="grid g2">
  <div class="card"><h2 style="margin-top:0">1. File dữ liệu trên máy (khuyến nghị)</h2>
    ${FS_OK ? `<p class="small">Chọn một file <code>.json</code> – ứng dụng sẽ <b>tự ghi</b> vào file này sau mỗi thay đổi. Nên đặt file trong thư mục OneDrive/Google Drive để có bản sao an toàn và dùng được trên máy khác.</p>
      ${fileHandle ? `<p>Đang liên kết: <b>${esc(fileHandle.name)}</b> ${fileOK ? tag('đang tự lưu', 'ok') : tag('cần kết nối lại', 'warn')}</p>` : ''}
      <p><button class="btn pri" data-click="newFile">Tạo file dữ liệu mới (lưu dữ liệu hiện tại)</button></p>
      <p><button class="btn" data-click="openFile">Mở file dữ liệu có sẵn</button> <span class="small">(thay dữ liệu đang có bằng nội dung file)</span></p>
      ${fileHandle ? '<p><button class="btn sm" data-click="forgetFile">Bỏ liên kết file</button></p>' : ''}`
    : `<p class="small">Trình duyệt này không hỗ trợ tự ghi file (hãy dùng <b>Chrome</b> hoặc <b>Edge</b> để có tính năng này). Bạn vẫn có thể tải file dữ liệu về và mở lại:</p>`}
    <p><button class="btn" data-click="downloadJson">Tải file dữ liệu (.json)</button>
       <label class="btn">Mở file .json…<input type="file" accept=".json,application/json" data-change="uploadJson" hidden></label></p>
  </div>
  <div class="card"><h2 style="margin-top:0">2. Nhập từ Excel</h2>
    <p class="small">File theo mẫu “Theo dõi tiến độ NCS” (dòng nhóm “NCS 2025”, dòng tiêu đề có “Họ tên NCS”). Nhập lại nhiều lần được: NCS trùng mã sẽ được cập nhật, không nhân đôi.</p>
    <label class="btn pri">Chọn file Excel và nhập…<input type="file" accept=".xlsx,.xlsm,.xls" data-change="importExcel" hidden></label>
    <div id="importResult"></div>
    <h2>3. Xuất</h2>
    <p><button class="btn" data-click="exportAll">Xuất toàn bộ ra Excel</button></p>
    <h2>4. Bản sao lưu tự động trong trình duyệt</h2>
    <p class="small">Mỗi ngày giữ 1 bản (30 ngày gần nhất).</p><div id="backupList" class="small">Đang tải…</div>
  </div></div>`;
}
async function fillBackups() {
  const el = document.getElementById('backupList'); if (!el) return;
  const keys = (await idb.keys()).filter((k) => String(k).startsWith('backup-')).sort().reverse();
  el.innerHTML = keys.length ? keys.map((k) => `${esc(k.slice(7))} <button class="btn sm" data-click="restoreBackup" data-k="${esc(k)}">Khôi phục</button> <button class="btn sm" data-click="downloadBackup" data-k="${esc(k)}">Tải về</button>`).join('<br>') : 'Chưa có.';
}

// ---------- Cài đặt, Nhật ký
function vSettings() {
  const s = DB.settings;
  return `<h1>Cài đặt</h1><p class="sub">Danh mục dùng chung. Mỗi dòng một giá trị.</p>
  <div class="card"><form class="f" data-action="saveSettings">
    <div class="full"><label>Lộ trình mốc chuẩn – định dạng: <code>Tên mốc | số tháng sau ngày QĐ</code></label>
      <textarea name="milestone_types" style="min-height:280px;font-family:Consolas,monospace">${esc(s.milestone_types.map((t) => `${t.name} | ${t.offset_months}`).join('\n'))}</textarea>
      <div class="small">Hãy chỉnh cho khớp quy định đào tạo tiến sĩ hiện hành của Trường. Thứ tự dòng = thứ tự cột trên Bảng tiến độ.</div></div>
    <div><label>Nhóm chuyên môn</label><textarea name="groups" style="min-height:120px">${esc(s.groups.join('\n'))}</textarea></div>
    <div><label>Trạng thái NCS</label><textarea name="statuses" style="min-height:180px">${esc(s.statuses.join('\n'))}</textarea></div>
    <div><label>Trạng thái được theo dõi & cảnh báo</label>${s.statuses.map((t) => `<label class="inline" style="display:flex"><input type="checkbox" name="active_statuses" value="${esc(t)}" ${s.active_statuses.includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
    <div><label>Cảnh báo sắp hết hạn trước (tháng)</label><input type="number" min="1" name="warn_months_before_end" value="${esc(s.warn_months_before_end)}"></div>
    <div class="full"><button class="btn pri">Lưu cài đặt</button></div></form></div>`;
}
const vLog = () => `<h1>Nhật ký thay đổi</h1><p class="sub">300 thao tác gần nhất.</p><pre class="log">${esc([...DB.log].reverse().slice(0, 300).join('\n')) || 'Chưa có thao tác nào.'}</pre>`;

// ============================================================ xử lý form
const fd = (form) => new FormData(form);
const val = (f, k) => S(f.get(k));
const ACTIONS = {
  filterStudents(form) { const p = new URLSearchParams(); for (const [k, v] of fd(form)) if (v) p.set(k, v); go('#/ncs' + (p.toString() ? '?' + p : '')); },
  async saveStudent(form) {
    const f = fd(form); const id = form.dataset.id || null; const ex = id ? getItem('students', id) : null;
    const tg = val(f, 'thoi_gian_dao_tao').replace(',', '.');
    const d = Object.assign({}, ex || {}, {
      ho_ten: val(f, 'ho_ten'), ma_ncs: val(f, 'ma_ncs'), khoa: val(f, 'khoa'), nhom_cm: val(f, 'nhom_cm'), ngay_sinh: parseDate(f.get('ngay_sinh')), co_quan: val(f, 'co_quan'),
      de_tai: val(f, 'de_tai'), cbhd1_id: f.get('cbhd1_id') || '', cbhd2_id: f.get('cbhd2_id') || '', cbhd2_ngoai: f.get('cbhd2_ngoai') === 'on', email_ca_nhan: val(f, 'email_ca_nhan'),
      email_sis: val(f, 'email_sis'), dien_thoai: val(f, 'dien_thoai'), so_qd: val(f, 'so_qd'), ngay_qd: parseDate(f.get('ngay_qd')), thoi_gian_dao_tao: tg && Number.isFinite(+tg) ? +tg : null,
      gia_han_den: parseDate(f.get('gia_han_den')), chu_ky_bc: f.getAll('chu_ky_bc').map(Number), trang_thai: f.get('trang_thai') || 'Đang đào tạo', ke_hoach: val(f, 'ke_hoach'), ghi_chu: S(f.get('ghi_chu')),
    });
    if (!d.ho_ten) return showError('Vui lòng nhập Họ tên NCS.');
    if (d.ma_ncs && DB.students.some((s) => s.ma_ncs === d.ma_ncs && s.id !== id)) return showError(`Mã NCS ${esc(d.ma_ncs)} đã tồn tại.`);
    const item = upsert('students', d); let msg = `${id ? 'Sửa' : 'Thêm'} NCS: ${item.ho_ten} (${item.ma_ncs || ''})`;
    if (!id && f.get('tao_lo_trinh') && item.ngay_qd) msg += `; tạo ${generateMilestones(item)} mốc chuẩn`;
    await saveDB(msg); flash('Đã lưu.'); go('#/ncs/' + item.id);
  },
  async saveMilestone(form) {
    const f = fd(form); const id = form.dataset.id || null; const loai = val(f, 'loai_khac') || val(f, 'loai');
    if (!loai) return showError('Vui lòng chọn hoặc nhập tên mốc.');
    const st = getItem('students', form.dataset.sid);
    upsert('milestones', Object.assign({}, id ? getItem('milestones', id) : {}, { student_id: form.dataset.sid, loai, ngay_du_kien: parseDate(f.get('ngay_du_kien')), ngay_thuc_hien: parseDate(f.get('ngay_thuc_hien')),
      ket_qua: val(f, 'ket_qua'), nguoi_danh_gia: val(f, 'nguoi_danh_gia'), gv_ngoai: val(f, 'gv_ngoai'), dot_thanh_toan: val(f, 'dot_thanh_toan'), da_thanh_toan: f.get('da_thanh_toan') === 'on', ghi_chu: S(f.get('ghi_chu')) }));
    await saveDB(`${id ? 'Sửa' : 'Thêm'} mốc '${loai}' – ${st ? st.ho_ten : ''}`); flash('Đã lưu mốc.');
    go(form.dataset.next || '#/ncs/' + form.dataset.sid);
  },
  async saveReports(form) {
    const f = fd(form); const ky = form.dataset.ky; let n = 0;
    reportRows(ky).forEach(({ st, rep }) => {
      const nop = f.get('nop_' + st.id) === 'on'; let ngay = parseDate(f.get('ngay_' + st.id)); const note = S(f.get('note_' + st.id));
      if (!rep.id && !nop && !note) return;
      if (rep.id && !!rep.da_nop === nop && (rep.ghi_chu || '') === note && (rep.ngay_nop || null) === ngay) return;
      if (nop && !ngay) ngay = todayISO();
      upsert('reports', Object.assign({}, rep, { student_id: st.id, ky, da_nop: nop, ngay_nop: nop ? ngay : null, ghi_chu: note })); n++;
    });
    await saveDB(`Cập nhật báo cáo 6 tháng kỳ ${periodLabel(ky)}: ${n} NCS`); flash(`Đã lưu ${n} thay đổi cho kỳ ${periodLabel(ky)}.`); route();
  },
  async savePayments(form) {
    const f = fd(form); const { q } = parseHash(); const batches = batchesList(); const batch = q.get('dot') ?? (batches[0] || ''); let n = 0;
    paymentRows(batch, q.get('chua') === '1').forEach((m) => { const paid = f.get('paid_' + m.id) === 'on'; if (!!m.da_thanh_toan !== paid) { m.da_thanh_toan = paid; upsert('milestones', m); n++; } });
    await saveDB(`Cập nhật thanh toán đợt ${batch}: ${n} mục`); flash(`Đã cập nhật ${n} mục.`); route();
  },
  async saveSup(form) {
    const f = fd(form); const id = form.dataset.id || null;
    const d = Object.assign({}, id ? getItem('supervisors', id) : {}, { ho_ten: val(f, 'ho_ten'), hoc_ham_hoc_vi: val(f, 'hoc_ham_hoc_vi'), don_vi: val(f, 'don_vi'), email: val(f, 'email'), dien_thoai: val(f, 'dien_thoai'), ghi_chu: S(f.get('ghi_chu')), ngoai_truong: f.get('ngoai_truong') === 'on' });
    if (!d.ho_ten) return showError('Vui lòng nhập họ tên.');
    const it = upsert('supervisors', d); await saveDB(`${id ? 'Sửa' : 'Thêm'} cán bộ: ${it.ho_ten}`); flash('Đã lưu.'); go('#/cbhd');
  },
  async mergeSup(form) {
    const f = fd(form); const keep = f.get('keep'); const drop = f.get('drop'); const a = getItem('supervisors', keep); const b = getItem('supervisors', drop);
    if (!a || !b || keep === drop) { flash('Chọn 2 cán bộ khác nhau để gộp.', 'error'); return route(); }
    if (!confirm(`Gộp “${supName(b)}” vào “${supName(a)}”?`)) return;
    DB.students.forEach((x) => { if (x.cbhd1_id === drop) x.cbhd1_id = keep; if (x.cbhd2_id === drop) x.cbhd2_id = keep; });
    ['hoc_ham_hoc_vi', 'don_vi', 'email', 'dien_thoai'].forEach((k) => { if (!a[k] && b[k]) a[k] = b[k]; });
    removeItem('supervisors', drop); await saveDB(`Gộp cán bộ '${b.ho_ten}' vào '${a.ho_ten}'`); flash('Đã gộp.'); route();
  },
  async saveSettings(form) {
    const f = fd(form); const lines = (k) => String(f.get(k) || '').split('\n').map((x) => x.trim()).filter(Boolean); const s = DB.settings;
    s.milestone_types = lines('milestone_types').map((l) => { const i = l.lastIndexOf('|'); return i >= 0 ? { name: l.slice(0, i).trim(), offset_months: parseInt(l.slice(i + 1), 10) || 0 } : { name: l, offset_months: 0 }; });
    s.groups = lines('groups'); s.statuses = lines('statuses').length ? lines('statuses') : s.statuses;
    s.active_statuses = f.getAll('active_statuses').filter((x) => s.statuses.includes(x));
    s.warn_months_before_end = parseInt(f.get('warn_months_before_end'), 10) || 6;
    await saveDB('Cập nhật cài đặt'); flash('Đã lưu cài đặt.'); route();
  },
};
const CLICKS = {
  async reconnect() { try { await useFileHandle(fileHandle, 'sync'); flash('Đã kết nối lại file dữ liệu.'); route(); } catch (e) { alert(e.message); } },
  async forgetFile() { if (!confirm('Bỏ liên kết với file dữ liệu? (Dữ liệu trong trình duyệt vẫn còn.)')) return; fileHandle = null; fileOK = false; await idb.del('fileHandle'); renderSaveState(); route(); },
  async newFile() { try { const h = await showSaveFilePicker({ suggestedName: 'qlsdh-ncs-du-lieu.json', types: [{ description: 'Dữ liệu QLSDH', accept: { 'application/json': ['.json'] } }] }); await useFileHandle(h, 'save'); await saveDB('Liên kết file dữ liệu ' + h.name); flash(`Đã tạo file <b>${esc(h.name)}</b>. Từ giờ mọi thay đổi được tự lưu vào file này.`); route(); } catch (e) { if (e.name !== 'AbortError') alert(e.message); } },
  async openFile() {
    try { const [h] = await showOpenFilePicker({ types: [{ description: 'Dữ liệu QLSDH', accept: { 'application/json': ['.json'] } }] });
      if (DB.students.length && !confirm('Dữ liệu hiện có trong trình duyệt sẽ được thay bằng nội dung file. Tiếp tục?')) return;
      await useFileHandle(h, 'load'); DB.log.push(`[${nowStr()}] Mở file dữ liệu ${h.name}`); await idb.set('db', DB); flash(`Đã mở file <b>${esc(h.name)}</b>.`); route();
    } catch (e) { if (e.name !== 'AbortError') alert(e.message); }
  },
  downloadJson() { download(new Blob([JSON.stringify(DB, null, 1)], { type: 'application/json' }), `qlsdh-ncs-du-lieu_${todayISO()}.json`); },
  exportAll() { exportAll(); },
  exportList() { exportAll(filterStudents(parseHash().q), `DanhSachNCS_${todayISO()}.xlsx`); },
  exportReports(btn) {
    const ky = btn.dataset.ky; const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(['Mã NCS', 'Họ tên', 'Khoá', 'CBHD 1', 'Đã nộp', 'Ngày nộp', 'Ghi chú'], reportRows(ky).map(({ st, rep }) => [st.ma_ncs, st.ho_ten, st.khoa, supName(getItem('supervisors', st.cbhd1_id)), rep.da_nop ? 'x' : '', fmtDate(rep.ngay_nop), rep.ghi_chu]), { 'Họ tên': 24, 'CBHD 1': 26, 'Ghi chú': 40 }), 'BC 6 thang ' + ky);
    XLSX.writeFile(wb, `BaoCao6Thang_${ky}.xlsx`);
  },
  exportPayments() {
    const { q } = parseHash(); const b = batchesList(); const batch = q.get('dot') ?? (b[0] || ''); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(MS_HEAD, msRows(paymentRows(batch, q.get('chua') === '1')), MS_W), ('Thanh toan ' + batch).slice(0, 31)); XLSX.writeFile(wb, `ThanhToan_${batch || 'all'}.xlsx`);
  },
  async msDone(btn) { const m = getItem('milestones', btn.dataset.id); m.ngay_thuc_hien = todayISO(); upsert('milestones', m); const st = getItem('students', m.student_id) || {}; await saveDB(`Hoàn thành mốc '${m.loai}' – ${st.ho_ten}`); route(); },
  async genMilestones(btn) { const st = getItem('students', btn.dataset.id); if (!st.ngay_qd) { flash('NCS chưa có Ngày QĐ công nhận nên chưa tính được hạn dự kiến.', 'error'); return route(); } const n = generateMilestones(st); await saveDB(`Tạo ${n} mốc chuẩn cho ${st.ho_ten}`); flash(`Đã thêm ${n} mốc chuẩn (bỏ qua các mốc đã có).`); route(); },
  async delStudent(btn) { const st = getItem('students', btn.dataset.id); if (!confirm(`Xoá NCS ${st.ho_ten} cùng toàn bộ mốc và báo cáo?`)) return; removeItem('students', st.id); DB.milestones = DB.milestones.filter((m) => m.student_id !== st.id); DB.reports = DB.reports.filter((r) => r.student_id !== st.id); await saveDB(`Xoá NCS: ${st.ho_ten} (${st.ma_ncs || ''})`); flash('Đã xoá NCS ' + esc(st.ho_ten) + '.'); go('#/ncs'); },
  async delMilestone(btn) { const m = getItem('milestones', btn.dataset.id); if (!confirm('Xoá mốc này?')) return; removeItem('milestones', m.id); const st = getItem('students', m.student_id) || {}; await saveDB(`Xoá mốc '${m.loai}' – ${st.ho_ten}`); flash('Đã xoá mốc.'); go('#/ncs/' + m.student_id); },
  async delSup(btn) { const id = btn.dataset.id; const s = getItem('supervisors', id); const used = DB.students.filter((x) => [x.cbhd1_id, x.cbhd2_id].includes(id)); if (used.length) { flash(`Không xoá được: cán bộ đang hướng dẫn ${used.length} NCS. Hãy đổi CBHD của các NCS này trước.`, 'error'); return route(); } if (!confirm('Xoá cán bộ này?')) return; removeItem('supervisors', id); await saveDB('Xoá cán bộ: ' + s.ho_ten); flash('Đã xoá.'); go('#/cbhd'); },
  async restoreBackup(btn) { if (!confirm(`Khôi phục dữ liệu về bản ${btn.dataset.k.slice(7)}? Dữ liệu hiện tại sẽ bị thay thế.`)) return; DB = normalizeDB(await idb.get(btn.dataset.k)); await saveDB('Khôi phục bản sao lưu ' + btn.dataset.k.slice(7)); flash('Đã khôi phục.'); route(); },
  async downloadBackup(btn) { download(new Blob([JSON.stringify(await idb.get(btn.dataset.k), null, 1)], { type: 'application/json' }), `qlsdh-ncs-${btn.dataset.k}.json`); },
};
const CHANGES = {
  progressKhoa(el) { go('#/tien-do' + (el.value ? '?khoa=' + encodeURIComponent(el.value) : '')); },
  reportPeriod(el) { go('#/bao-cao?ky=' + el.value); },
  payBatch(el) { const { q } = parseHash(); go(`#/thanh-toan?dot=${encodeURIComponent(el.value)}${q.get('chua') === '1' ? '&chua=1' : ''}`); },
  payUnpaid(el) { const { q } = parseHash(); const b = q.get('dot') ?? (batchesList()[0] || ''); go(`#/thanh-toan?dot=${encodeURIComponent(b)}${el.checked ? '&chua=1' : ''}`); },
  async importExcel(el) {
    const file = el.files[0]; if (!file) return;
    if (typeof XLSX === 'undefined') { alert('Chưa tải được thư viện đọc Excel (cần Internet).'); return; }
    try {
      await idb.set('backup-' + todayISO() + ' (trước khi nhập ' + nowStr().slice(11) + ')', JSON.parse(JSON.stringify(DB)));
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const { stats, warnings } = importWorkbook(wb);
      await saveDB(`Nhập Excel '${file.name}': thêm ${stats.added}, cập nhật ${stats.updated} NCS; ${stats.supervisors_added} cán bộ; ${stats.milestones_added} mốc`);
      route();
      document.getElementById('importResult').innerHTML = `<div class="flash ok" style="margin-top:12px">Đã nhập “${esc(file.name)}”: thêm mới <b>${stats.added}</b> NCS · cập nhật <b>${stats.updated}</b> · thêm <b>${stats.supervisors_added}</b> cán bộ · <b>${stats.milestones_added}</b> mốc/hoạt động.</div>
        ${warnings.length ? `<b>Cần kiểm tra lại (${warnings.length}):</b><ul class="alert-list">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <p><a class="btn pri" href="#/">Xem tổng quan</a> <a class="btn" href="#/cbhd">Rà soát danh sách cán bộ</a></p>`;
    } catch (e) { console.error(e); alert('Không nhập được file: ' + e.message); }
  },
  async uploadJson(el) {
    const file = el.files[0]; if (!file) return;
    try { const data = normalizeDB(JSON.parse(await file.text())); if (DB.students.length && !confirm('Thay dữ liệu hiện có bằng nội dung file?')) return;
      DB = data; await saveDB('Mở file dữ liệu ' + file.name); flash('Đã mở file ' + esc(file.name) + '.'); route();
    } catch (e) { alert('File không hợp lệ: ' + e.message); }
  },
};
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }

document.addEventListener('submit', (ev) => { const f = ev.target.closest('form[data-action]'); if (!f) return; ev.preventDefault(); Promise.resolve(ACTIONS[f.dataset.action](f)).catch((e) => { console.error(e); alert(e.message); }); });
document.addEventListener('click', (ev) => { const b = ev.target.closest('[data-click]'); if (!b) return; ev.preventDefault(); Promise.resolve(CLICKS[b.dataset.click](b)).catch((e) => { console.error(e); alert(e.message); }); });
document.addEventListener('change', (ev) => { const el = ev.target.closest('[data-change]'); if (!el) return; Promise.resolve(CHANGES[el.dataset.change](el)).catch((e) => { console.error(e); alert(e.message); }); });
window.addEventListener('hashchange', () => { route(); if (location.hash.startsWith('#/du-lieu')) fillBackups(); });

// ============================================================ khởi động
(async function init() {
  try {
    DB = normalizeDB(await idb.get('db'));
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (FS_OK) {
      const h = await idb.get('fileHandle');
      if (h) { fileHandle = h; try { fileOK = (await h.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch { fileOK = false; } }
    }
  } catch (e) { console.error(e); DB = emptyDB(); flash('Không đọc được dữ liệu trong trình duyệt: ' + esc(e.message), 'error'); }
  renderSaveState(); route(); if (location.hash.startsWith('#/du-lieu')) fillBackups();
})();
