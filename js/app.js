import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  setDoc,
  writeBatch,
  serverTimestamp,
  deleteDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// ── FIREBASE INIT ──────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const authPersistenceReady = setPersistence(auth, browserSessionPersistence).catch((e) => {
  console.warn("Không thể bật session persistence:", e);
});

// ── STATE ──────────────────────────────────────────────────
let currentUser = null;
let currentRole = null; // 'admin' | 'manager' | 'viewer'

// ── ROLE HELPERS ───────────────────────────────────────────
function isAdmin() { return currentRole === "admin"; }
function isManager() { return currentRole === "admin" || currentRole === "manager"; }
function isViewer() { return currentRole === "viewer"; }

async function loadUserRole(user) {
  if (!user) { currentRole = null; return; }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      currentRole = snap.data().role || "viewer";
    } else {
      // First login — auto-create user doc as viewer
      const newUser = {
        email: user.email,
        role: "viewer",
        createdAt: serverTimestamp(),
      };
      await setDoc(doc(db, "users", user.uid), newUser);
      currentRole = "viewer";
    }
  } catch (e) {
    console.warn("Cannot load user role:", e);
    currentRole = "viewer";
  }
}

let TX = [];
let STOCK = [];
let PC = [];
let STORES = [];
let OFFICES = [];
let WAREHOUSES = [];

let currentPage = "dashboard";
let txFilter = "all";
let txPage = 1;
let stockTypeFilter = "all";
let storesBrandFilter = "all";
let storesRegionFilter = "all";
const PAGE_SIZE = 50;

// ── DOM HELPERS ────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function safeTrim(v) {
  return (v ?? "").toString().trim();
}

function keyOf(v) {
  return safeTrim(v).toLowerCase();
}

function matchAssigned(assigned, code, name) {
  const a = keyOf(assigned);
  if (!a) return false;
  const c = keyOf(code);
  const n = keyOf(name);
  return (c && a.includes(c)) || (n && a.includes(n)) || (c && c.includes(a)) || (n && n.includes(a));
}

function toNumber(n, fallback = 0) {
  const x = typeof n === "number" ? n : parseFloat(n);
  return Number.isFinite(x) ? x : fallback;
}

function showToast(msg, type = "success") {
  const el = $("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 3500);
}

function requireAuth(actionLabel = "thao tác này", minRole = "manager") {
  if (!currentUser) {
    showToast(`Vui lòng đăng nhập để ${actionLabel}.`, "error");
    openAuthModal();
    return false;
  }
  if (minRole === "admin" && !isAdmin()) {
    showToast(`Bạn cần quyền Admin để ${actionLabel}.`, "error");
    return false;
  }
  if (minRole === "manager" && !isManager()) {
    showToast(`Bạn chỉ có quyền Viewer — không thể ${actionLabel}.`, "error");
    return false;
  }
  return true;
}

// ── AUTH UI ────────────────────────────────────────────────
function openAuthModal() {
  $("authModal").classList.add("open");
  setTimeout(() => $("authEmailInput").focus(), 100);
}
function closeAuthModal() {
  $("authModal").classList.remove("open");
}

async function doSignIn() {
  await authPersistenceReady;
  const email = safeTrim($("authEmailInput").value);
  const pass = $("authPassInput").value ?? "";
  if (!email || !pass) {
    showToast("Vui lòng nhập email & password.", "error");
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    closeAuthModal();
    showToast("Đăng nhập thành công.", "success");
  } catch (e) {
    showToast(`Đăng nhập thất bại: ${e?.message || e}`, "error");
  }
}

async function doSignOut() {
  try {
    await signOut(auth);
    showToast("Đã đăng xuất.", "success");
  } catch (e) {
    showToast(`Đăng xuất thất bại: ${e?.message || e}`, "error");
  }
}

function refreshAuthUI() {
  const email = currentUser?.email || "";
  $("authEmail").style.display = currentUser ? "inline" : "none";
  const roleLabel = currentRole === "admin" ? "👑 Admin" : currentRole === "manager" ? "⚙ Manager" : currentRole === "viewer" ? "👁 Viewer" : "";
  $("authEmail").textContent = email + (roleLabel ? ` (${roleLabel})` : "");
  $("btnOpenAuth").style.display = currentUser ? "none" : "inline-flex";
  $("btnSignOut").style.display = currentUser ? "inline-flex" : "none";

  // Dim restricted nav items for viewer
  const restricted = ["nav-stock", "nav-stores", "nav-offices", "nav-warehouses", "nav-dashboard"];
  restricted.forEach((id) => {
    const el = $(id);
    if (el) el.style.opacity = isViewer() ? "0.45" : "";
  });
}

// ── SEARCH / NAV ───────────────────────────────────────────
function getSearch() {
  return safeTrim($("globalSearch").value).toLowerCase();
}

function navActivate(page) {
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
  const el = $("nav-" + page);
  if (el) el.classList.add("active");
}

function showPage(page) {
  // Block viewer from restricted pages
  const restricted = ["stock", "stores", "offices", "warehouses", "dashboard"];
  if (isViewer() && restricted.includes(page)) {
    $("main").innerHTML = `
      <div class="empty" style="padding:80px 20px">
        <div class="e-icon" style="font-size:48px">🔒</div>
        <div style="font-size:18px;font-weight:600;margin-top:16px;color:var(--text)">Không có quyền truy cập</div>
        <div style="margin-top:8px;font-size:13px;color:var(--muted)">Chỉ <b>Admin</b> và <b>Manager</b> mới được xem trang này.</div>
        <div style="margin-top:6px;font-size:12px;color:var(--dim)">Tài khoản của bạn: <b>👁 Viewer</b></div>
        <button onclick="showPage('transactions')" style="margin-top:20px;padding:8px 20px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">← Xem Giao dịch</button>
      </div>`;
    navActivate(page);
    return;
  }
  currentPage = page;
  txPage = 1;
  navActivate(page);
  render();
}

function onSearch() {
  txPage = 1;
  render();
}

// ── FIRESTORE LOAD ─────────────────────────────────────────
async function loadCollection(name) {
  try {
    const snap = await getDocs(collection(db, name));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn(`loadCollection("${name}") failed:`, e?.message || e);
    return [];
  }
}

async function loadAll() {
  $("main").innerHTML = `<div class="empty"><div class="e-icon">⟳</div>Đang tải dữ liệu...</div>`;
  try {
    // Viewer: only load transactions
    const canReadAll = isManager() || isAdmin();
    const [tx, stock, pc, stores, offices, warehouses] = await Promise.all([
      loadCollection("transactions"),
      canReadAll ? loadCollection("stock") : Promise.resolve([]),
      canReadAll ? loadCollection("minipc") : Promise.resolve([]),
      canReadAll ? loadCollection("stores") : Promise.resolve([]),
      canReadAll ? loadCollection("offices") : Promise.resolve([]),
      canReadAll ? loadCollection("warehouses") : Promise.resolve([]),
    ]);

    TX = (tx || []).map((t) => ({ ...t, Quantity: toNumber(t.Quantity, 0) }));
    STOCK = (stock || []).map((s) => ({ ...s, Stock: toNumber(s.Stock, 0), TypeDevice: safeTrim(s.TypeDevice) }));
    PC = pc || [];
    STORES = stores || [];
    OFFICES = offices || [];
    WAREHOUSES = warehouses || [];

    $("cnt-tx").textContent = TX.length;
    $("cnt-stock").textContent = STOCK.length;
    $("cnt-stores").textContent = STORES.length;
    $("cnt-offices").textContent = OFFICES.length;
    $("cnt-warehouses").textContent = WAREHOUSES.length;

    buildAutocompleteSources();
    render();
  } catch (e) {
    $("main").innerHTML = `<div class="empty"><div class="e-icon">⚠</div>Không tải được dữ liệu.<div style="margin-top:8px;font-size:12px;color:var(--dim)">${String(e?.message || e)}</div></div>`;
  }
}

// ── HELPERS ────────────────────────────────────────────────
function hl(text, q) {
  if (!q || !text) return text || "";
  const s = String(text);
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return s.replace(re, (m) => `<span class="hl">${m}</span>`);
}

function statusBadge(st) {
  const s = (st || "").toLowerCase().trim();
  if (s.includes("still use") || s.includes("new") || s === "active") return `<span class="badge-status s-active">Still use</span>`;
  if (s.includes("broken")) return `<span class="badge-status s-broken">${st}</span>`;
  if (s.includes("old")) return `<span class="badge-status s-old">${st}</span>`;
  if (s.includes("none") || s.includes("liquidation")) return `<span class="badge-status s-none">${st}</span>`;
  return st ? `<span class="badge-status s-old">${st}</span>` : '<span style="color:var(--dim)">—</span>';
}

// Clean serial: remove trailing annotation labels like (Scan), (Door: scan), etc.
function cleanSN(s) {
  return safeTrim(s).replace(/\s*\([^)]*\)\s*/g, "").trim();
}

// Normalize date display → DD/MM/YYYY
function fmtDate(d) {
  const s = safeTrim(d);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return s;
}

function render() {
  const pages = {
    dashboard: renderDashboard,
    transactions: renderTransactions,
    stock: renderStock,
    stores: renderStores,
    offices: renderOffices,
    warehouses: renderWarehouses,
  };
  (pages[currentPage] || renderDashboard)();
}

// ── DASHBOARD ──────────────────────────────────────────────
function renderDashboard() {
  const totalIn = TX.filter((t) => t.TxType === "in").reduce((s, t) => s + toNumber(t.Quantity, 0), 0);
  const totalOut = TX.filter((t) => t.TxType === "out").reduce((s, t) => s + toNumber(t.Quantity, 0), 0);
  const totalStock = STOCK.reduce((s, t) => s + toNumber(t.Stock, 0), 0);
  const brokenItems = TX.filter((t) => (t.Status || "").toLowerCase().includes("broken")).length;

  const recent = [...TX]
    .sort((a, b) => (safeTrim(b.Date)).localeCompare(safeTrim(a.Date)))
    .slice(0, 8);
  const topStock = [...STOCK].sort((a, b) => toNumber(b.Stock, 0) - toNumber(a.Stock, 0)).slice(0, 5);

  const catMap = {};
  STOCK.forEach((s) => {
    const k = safeTrim(s.TypeDevice) || "Other";
    catMap[k] = (catMap[k] || 0) + toNumber(s.Stock, 0);
  });
  const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxCat = cats[0]?.[1] || 1;

  $("main").innerHTML = `
    <div class="page-header">
      <div class="page-title">Dashboard</div>
      <div class="page-sub">Tổng quan hệ thống quản lý thiết bị IT — ${new Date().toLocaleDateString("vi-VN")}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card c-in">
        <div class="stat-label">↑ Thiết bị Nhập</div>
        <div class="stat-value c-in">${totalIn}</div>
        <div class="stat-sub">${TX.filter((t) => t.TxType === "in").length} giao dịch</div>
      </div>
      <div class="stat-card c-out">
        <div class="stat-label">↓ Thiết bị Xuất</div>
        <div class="stat-value c-out">${totalOut}</div>
        <div class="stat-sub">${TX.filter((t) => t.TxType === "out").length} giao dịch</div>
      </div>
      <div class="stat-card c-stock">
        <div class="stat-label">☰ Tổng tồn kho</div>
        <div class="stat-value c-stock">${totalStock}</div>
        <div class="stat-sub">${STOCK.length} loại thiết bị</div>
      </div>
      <div class="stat-card c-warn">
        <div class="stat-label">⚠ Thiết bị Hỏng</div>
        <div class="stat-value c-warn">${brokenItems}</div>
        <div class="stat-sub">cần xử lý</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
      <div class="table-wrap">
        <div class="table-header"><span class="table-title">Giao dịch gần đây</span></div>
        <table>
          <thead><tr><th>Thiết bị</th><th>Loại</th><th>SL</th><th>Ngày</th></tr></thead>
          <tbody>
            ${recent.map((t) => `
              <tr>
                <td class="ellipsis" style="max-width:160px">${safeTrim(t.Item)}</td>
                <td><span class="badge-tx ${t.TxType === "in" ? "badge-in" : "badge-out"}">${t.TxType === "in" ? "↑ IN" : "↓ OUT"}</span></td>
                <td class="mono">${toNumber(t.Quantity, 0)}</td>
                <td class="mono" style="color:var(--muted);font-size:11px">${fmtDate(safeTrim(t.Date)) || "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="table-wrap">
        <div class="table-header"><span class="table-title">Theo loại thiết bị (top 8)</span></div>
        <div style="padding:16px">
          ${cats.map(([k, v]) => `
            <div style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px">
                <span style="color:var(--text)">${k}</span>
                <span class="mono" style="color:var(--accent)">${v}</span>
              </div>
              <div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${(v / maxCat * 100).toFixed(1)}%;background:var(--accent);border-radius:3px;transition:width .4s"></div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-header"><span class="table-title">Top tồn kho cao nhất</span></div>
      <table>
        <thead><tr><th>#</th><th>Thiết bị</th><th>Loại</th><th>Số lượng</th><th>Ghi chú</th></tr></thead>
        <tbody>
          ${topStock.map((s, i) => `
            <tr>
              <td class="mono" style="color:var(--dim)">${i + 1}</td>
              <td>${safeTrim(s.Item)}</td>
              <td><span style="font-size:11px;color:var(--muted)">${safeTrim(s.TypeDevice) || "—"}</span></td>
              <td><span class="mono" style="color:var(--accent);font-size:18px;font-weight:600">${toNumber(s.Stock, 0)}</span></td>
              <td style="font-size:11px;color:var(--dim)">${safeTrim(s.Note) || "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ── TRANSACTIONS ───────────────────────────────────────────
function renderTransactions() {
  const q = getSearch();
  const list = TX
    .filter((t) => {
      if (txFilter === "in" && t.TxType !== "in") return false;
      if (txFilter === "out" && t.TxType !== "out") return false;
      if (txFilter === "broken" && !(safeTrim(t.Status)).toLowerCase().includes("broken")) return false;
      if (q) {
        const hay = [t.Item, t.Assigned, t.Status, t.SN, t.Description, t.Remark].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => (safeTrim(b.Date)).localeCompare(safeTrim(a.Date)));

  // Group: same item + TxType + assigned → one merged row
  const _grpMap = {};
  list.forEach((t) => {
    const key = [keyOf(safeTrim(t.Item)), t.TxType, keyOf(safeTrim(t.Assigned))].join("|");
    if (!_grpMap[key]) _grpMap[key] = { key, item: safeTrim(t.Item), txType: t.TxType, assigned: safeTrim(t.Assigned), qty: 0, sns: [], rawTxs: [], statuses: new Set(), lastDate: "", firstDate: "9999-99-99", desc: safeTrim(t.Description) || "" };
    _grpMap[key].qty += toNumber(t.Quantity, 0);
    _grpMap[key].rawTxs.push(t);
    if (safeTrim(t.Status)) _grpMap[key].statuses.add(safeTrim(t.Status));
    const _snv = t.SN;
    if (Array.isArray(_snv)) _snv.forEach((s) => { const v = cleanSN(s); if (v) _grpMap[key].sns.push(v); });
    else safeTrim(_snv).split(/[\n,]+/).forEach((s) => { const sv = cleanSN(s); if (sv) _grpMap[key].sns.push(sv); });
    if (safeTrim(t.Date) > _grpMap[key].lastDate) _grpMap[key].lastDate = safeTrim(t.Date);
    if (safeTrim(t.Date) && safeTrim(t.Date) < _grpMap[key].firstDate) _grpMap[key].firstDate = safeTrim(t.Date);
    if (!_grpMap[key].desc && safeTrim(t.Description)) _grpMap[key].desc = safeTrim(t.Description);
  });
  const grouped = Object.values(_grpMap).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  _txGroupedData = grouped;

  const total = grouped.length;
  const pages = Math.ceil(total / PAGE_SIZE) || 1;
  txPage = Math.max(1, Math.min(txPage, pages));
  const paged = grouped.slice((txPage - 1) * PAGE_SIZE, txPage * PAGE_SIZE);
  const _bs = "background:transparent;border:none;cursor:pointer;font-size:13px;padding:2px 5px;border-radius:3px;transition:color .15s";

  $("main").innerHTML = `
    <div class="page-header">
      <div class="page-title">Giao dịch thiết bị</div>
      <div class="page-sub">${total} mục (${TX.length} giao dịch) • ${TX.filter((t) => t.TxType === "in").length} nhập, ${TX.filter((t) => t.TxType === "out").length} xuất</div>
    </div>

    <div class="filters">
      <button class="filter-btn ${txFilter === "all" ? "active" : ""}" onclick="setTxFilter('all')">Tất cả (${TX.length})</button>
      <button class="filter-btn ${txFilter === "in" ? "active" : ""}" onclick="setTxFilter('in')">↑ Nhập (${TX.filter((t) => t.TxType === "in").length})</button>
      <button class="filter-btn ${txFilter === "out" ? "active" : ""}" onclick="setTxFilter('out')">↓ Xuất (${TX.filter((t) => t.TxType === "out").length})</button>
      <button class="filter-btn ${txFilter === "broken" ? "active" : ""}" onclick="setTxFilter('broken')">⚠ Hỏng</button>
      <div class="filter-right">
        <span style="font-size:12px;color:var(--muted)">Hiển thị ${paged.length}/${total}</span>
        <button class="btn-ghost-green" onclick="openModal()">＋ Thêm giao dịch</button>
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Thiết bị</th>
              <th>Loại</th>
              <th>SL</th>
              <th>Giao cho</th>
              <th>Trạng thái</th>
              <th>Serial / S/N</th>
              <th>Ngày</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${paged.length ? paged.map((d) => {
              const _isSingle = d.rawTxs.length === 1;
              const _isExp = expandedTxGroups.has(d.key);
              const _dateDisplay = _isSingle
                ? fmtDate(d.lastDate) || "—"
                : (d.firstDate !== "9999-99-99" && d.firstDate !== d.lastDate
                    ? `${fmtDate(d.firstDate)} → ${fmtDate(d.lastDate)}`
                    : fmtDate(d.lastDate) || "—");
              const _statusArr = [...(d.statuses || [])];
              const _statusDisplay = _statusArr.length ? _statusArr.map(s => statusBadge(s)).join(" ") : statusBadge("");
              const _grpRow = `
                <tr${!_isSingle ? ` style="background:rgba(88,166,255,.03)"` : ""}>
                  <td>
                    <div style="font-weight:500">${hl(d.item, q)}</div>
                    ${d.desc ? `<div style="font-size:11px;color:var(--dim);margin-top:1px">${hl(d.desc, q)}</div>` : ""}
                    ${!_isSingle ? `<div style="font-size:10px;color:var(--accent);margin-top:2px">⊞ ${d.rawTxs.length} giao dịch gộp</div>` : ""}
                  </td>
                  <td><span class="badge-tx ${d.txType === "in" ? "badge-in" : "badge-out"}">${d.txType === "in" ? "↑ IN" : "↓ OUT"}</span></td>
                  <td class="mono" style="font-size:15px;font-weight:600;color:${d.txType === "in" ? "var(--in)" : "var(--out)"}">${d.qty}${!_isSingle ? `<div style="font-size:10px;font-weight:400;color:var(--dim)">tổng</div>` : ""}</td>
                  <td style="font-size:12px;color:var(--muted)">${hl(d.assigned, q) || "—"}</td>
                  <td>${_statusDisplay}</td>
                  <td class="mono" style="font-size:11px;color:var(--dim)">${d.sns.length ? (d.sns.length === 1 ? `<div style="white-space:nowrap">${hl(d.sns[0], q)}</div>` : `<div style="white-space:nowrap">${hl(d.sns[0], q)}</div><div style="color:var(--accent);font-size:10px">+${d.sns.length - 1} serial khác</div>`) : "—"}</td>
                  <td class="mono" style="font-size:11px;color:var(--muted);white-space:nowrap">${_dateDisplay}</td>
                  <td style="white-space:nowrap">
                    <button onclick="showTxGroupDetail('${d.key.replace(/'/g, "\\'")}')" style="${_bs};color:var(--accent);font-weight:500" title="Xem chi tiết">☰</button>
                    ${_isSingle
                      ? `<button onclick="openTxEdit('${d.rawTxs[0].id}')" style="${_bs};color:var(--dim)" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--dim)'" title="Chỉnh sửa">✎</button>
                         <button onclick="deleteTx('${d.rawTxs[0].id}')" style="${_bs};color:var(--dim)" onmouseover="this.style.color='var(--out)'" onmouseout="this.style.color='var(--dim)'" title="Xoá">✕</button>`
                      : ""
                    }
                  </td>
                </tr>`;
              return _grpRow;
            }).join("")
            : `<tr><td colspan="8"><div class="empty"><div class="e-icon">○</div>Không tìm thấy kết quả</div></td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Trang ${txPage}/${pages} — ${total} bản ghi</span>
        <div class="pg-btns">
          <button class="pg-btn" onclick="goPage(1)" ${txPage === 1 ? "disabled" : ""}>«</button>
          <button class="pg-btn" onclick="goPage(${txPage - 1})" ${txPage === 1 ? "disabled" : ""}>‹</button>
          ${Array.from({ length: Math.min(5, pages) }, (_, i) => {
            const pg = Math.max(1, Math.min(txPage - 2, pages - 4)) + i;
            return pg <= pages ? `<button class="pg-btn ${pg === txPage ? "active" : ""}" onclick="goPage(${pg})">${pg}</button>` : "";
          }).join("")}
          <button class="pg-btn" onclick="goPage(${txPage + 1})" ${txPage >= pages ? "disabled" : ""}>›</button>
          <button class="pg-btn" onclick="goPage(${pages})" ${txPage >= pages ? "disabled" : ""}>»</button>
        </div>
      </div>
    </div>
  `;
}
function setTxFilter(f) {
  txFilter = f;
  txPage = 1;
  render();
}
function goPage(p) {
  txPage = p;
  render();
}

// Expose for onclick in templates
window.setTxFilter = setTxFilter;
window.goPage = goPage;

function setStockTypeFilter(v) {
  stockTypeFilter = v;
  render();
}
function setStoresRegionFilter(v) {
  storesRegionFilter = v;
  render();
}
function setStoresBrandFilter(v) {
  storesBrandFilter = v;
  render();
}
window.setStockTypeFilter = setStockTypeFilter;
window.setStoresRegionFilter = setStoresRegionFilter;
window.setStoresBrandFilter = setStoresBrandFilter;

// ── STOCK ──────────────────────────────────────────────────
function renderStock() {
  const q = getSearch();
  const types = ["all", ...new Set(STOCK.map((s) => safeTrim(s.TypeDevice)).filter(Boolean).sort())];

  let list = STOCK.filter((s) => {
    if (stockTypeFilter !== "all" && safeTrim(s.TypeDevice) !== stockTypeFilter) return false;
    if (q) {
      const hay = [s.Item, s.TypeDevice, s.Note, s.SN].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const outOfStock = list.filter((s) => toNumber(s.Stock, 0) === 0).length;

  $("main").innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div class="page-title">Tồn kho thiết bị</div>
          <div class="page-sub">${list.length} thiết bị${outOfStock ? ` — <span style="color:var(--out)">${outOfStock} hết hàng</span>` : ""}</div>
        </div>
        <button class="btn-ghost-green" onclick="openStockModal()">＋ Thêm thiết bị</button>
      </div>
    </div>

    <div class="filters" style="margin-bottom:12px">
      <select class="filter-select" onchange="setStockTypeFilter(this.value)">
        ${types.map((t) => `<option value="${t}" ${stockTypeFilter === t ? "selected" : ""}>${t === "all" ? "Tất cả loại" : t}</option>`).join("")}
      </select>
      <span style="font-size:12px;color:var(--muted);align-self:center;margin-left:4px">${list.length} kết quả</span>
    </div>

    <div class="stock-grid">
      ${list.length
        ? list.map((s) => `
        <div class="stock-card ${toNumber(s.Stock, 0) === 0 ? "out-of-stock" : ""}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px">
            <div class="sc-type">${hl(safeTrim(s.TypeDevice), q) || "—"}</div>
            <div style="display:flex;gap:4px">
              <button onclick="openStockModal('${String(s.id).replace(/'/g, "\\'")}')" style="background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:13px;padding:2px 4px;border-radius:3px;transition:color .15s" title="Chỉnh sửa">✎</button>
              <button onclick="deleteStock('${String(s.id).replace(/'/g, "\\'")}')" style="background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:13px;padding:2px 4px;border-radius:3px;transition:color .15s" title="Xoá">✕</button>
            </div>
          </div>
          <div class="sc-name">${hl(safeTrim(s.Item), q)}</div>
          <div style="display:flex;align-items:baseline;gap:6px;margin-top:8px">
            <div class="sc-qty">${toNumber(s.Stock, 0)}</div>
            <div class="sc-unit">units</div>
          </div>
          ${s.Note ? `<div style="margin-top:8px;font-size:11px;color:var(--dim);line-height:1.3">${safeTrim(s.Note)}</div>` : ""}
          ${s.SN ? `<div style="margin-top:4px;font-size:10px;font-family:'IBM Plex Mono',monospace;color:var(--dim);line-height:1.7">${safeTrim(s.SN).split(/[\n,]+/).filter(Boolean).map((v) => `<div>${v.trim()}</div>`).join("")}</div>` : ""}
          <div style="display:flex;gap:4px;margin-top:10px">
            <button onclick="quickAdjust('${String(s.id).replace(/'/g, "\\'")}',-1)" style="flex:1;padding:4px;background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.2);border-radius:4px;color:var(--out);cursor:pointer;font-size:14px;font-weight:700;transition:all .15s" onmouseover="this.style.background='rgba(248,81,73,.18)'" onmouseout="this.style.background='rgba(248,81,73,.08)'">−</button>
            <button onclick="quickAdjust('${String(s.id).replace(/'/g, "\\'")}',1)" style="flex:1;padding:4px;background:rgba(63,185,80,.08);border:1px solid rgba(63,185,80,.2);border-radius:4px;color:var(--in);cursor:pointer;font-size:14px;font-weight:700;transition:all .15s" onmouseover="this.style.background='rgba(63,185,80,.18)'" onmouseout="this.style.background='rgba(63,185,80,.08)'">＋</button>
          </div>
        </div>
      `).join("")
        : `<div class="empty" style="grid-column:1/-1"><div class="e-icon">○</div>Không có kết quả</div>`}
    </div>
  `;
}

window.openStockModal = openStockModal;
window.deleteStock = deleteStock;
window.quickAdjust = quickAdjust;

// ── STORES ────────────────────────────────────────────────
function renderStores() {
  const q = getSearch();
  const brands = ["all", ...new Set(STORES.map((s) => safeTrim(s.Brand)).filter(Boolean).sort())];
  const vnCount = STORES.filter((s) => s.Region === "VN").length;
  const cbCount = STORES.filter((s) => s.Region === "CB").length;

  let list = STORES.filter((s) => {
    if (storesBrandFilter !== "all" && safeTrim(s.Brand) !== storesBrandFilter) return false;
    if (storesRegionFilter !== "all" && safeTrim(s.Region) !== storesRegionFilter) return false;
    if (q) {
      const hay = Object.values(s).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  $("main").innerHTML = `
    <div class="page-header">
      <div class="page-title">Danh sách Cửa hàng</div>
      <div class="page-sub">${list.length} / ${STORES.length} stores — ${vnCount} VN · ${cbCount} CB · <span style="color:var(--dim);font-size:12px">Bấm vào store để xem thiết bị</span></div>
    </div>

    <div class="filters" style="margin-bottom:10px">
      <button class="filter-btn ${storesRegionFilter === "all" ? "active" : ""}" onclick="setStoresRegionFilter('all')">Tất cả (${STORES.length})</button>
      <button class="filter-btn ${storesRegionFilter === "VN" ? "active" : ""}" onclick="setStoresRegionFilter('VN')">VN (${vnCount})</button>
      <button class="filter-btn ${storesRegionFilter === "CB" ? "active" : ""}" onclick="setStoresRegionFilter('CB')">Cambodia (${cbCount})</button>
    </div>

    <div class="brand-pills">
      ${brands
        .map((b) => `<div class="brand-pill ${storesBrandFilter === b ? "active" : ""}" onclick="setStoresBrandFilter('${b.replace(/'/g, "\\'")}')">${b === "all" ? "Tất cả brands" : b}</div>`)
        .join("")}
    </div>

    <div class="store-grid">
      ${list.length
        ? list
            .map((s) => {
              const code = safeTrim(s["Store code"] || s.store_code);
              const name = safeTrim(s["Store name"] || s.store_name);
              const brand = safeTrim(s.Brand || s.brand);
              const devItems = [
                ...new Set(
                  TX.filter((t) => matchAssigned(t.Assigned, code, name) && t.TxType === "out").map((t) => safeTrim(t.Item))
                ),
              ].filter(Boolean);
              return `
                <div class="store-card store-card-clickable" onclick="renderStoreDetail('${code.replace(/'/g, "\\'")}')">
                  <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                    <div class="sc-code">${hl(code, q)}</div>
                    <span style="font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid ${safeTrim(s.O2O || s.o2o) ? 'rgba(63,185,80,.3);background:rgba(63,185,80,.1);color:var(--in)' : 'var(--border);background:var(--surface2);color:var(--dim)'}">O2O</span>
                    ${safeTrim(s.Type || s.type) ? `<span style="font-size:10px;color:var(--dim)">${safeTrim(s.Type || s.type)}</span>` : ""}
                    <span style="margin-left:auto;font-size:11px;color:var(--accent);font-family:'IBM Plex Mono',monospace">${devItems.length} loại TB</span>
                  </div>
                  <div class="sc-name">${hl(name, q)}</div>
                  <div class="sc-brand">${brand}</div>
                  <div class="sr"><span class="k">Incharge</span><span class="v">${hl(safeTrim(s.Incharge || s.incharge), q) || "—"}</span></div>
                  <div class="sr"><span class="k">Chức vụ</span><span class="v" style="color:var(--muted)">${safeTrim(s.Position || s.position) || "—"}</span></div>
                  ${safeTrim(s.Phone || s.phone)
                    ? `<div class="sr"><span class="k">Phone</span><span class="v"><a href="tel:${safeTrim(
                        s.Phone || s.phone
                      )}" style="color:var(--accent);text-decoration:none" onclick="event.stopPropagation()">${safeTrim(
                        s.Phone || s.phone
                      )}</a></span></div>`
                    : ""}
                  <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
                    <div style="font-size:10px;color:var(--dim);margin-bottom:5px;text-transform:uppercase;letter-spacing:.8px">Thiết bị đang có</div>
                    <div style="display:flex;flex-wrap:wrap;gap:4px">
                      ${devItems.slice(0, 4).map((i) => `<span style="font-size:10px;padding:2px 6px;background:var(--surface2);border-radius:3px;color:var(--muted)">${i}</span>`).join("")}
                      ${devItems.length > 4 ? `<span style="font-size:10px;padding:2px 6px;background:var(--surface2);border-radius:3px;color:var(--accent)">+${devItems.length - 4} khác</span>` : ""}
                      ${devItems.length === 0 ? `<span style="font-size:10px;color:var(--dim)">Chưa có thiết bị</span>` : ""}
                    </div>
                  </div>
                  <div style="margin-top:8px;text-align:right;font-size:11px;color:var(--dim)">Bấm để xem chi tiết →</div>
                </div>
              `;
            })
            .join("")
        : `<div class="empty" style="grid-column:1/-1"><div class="e-icon">○</div>Không có kết quả</div>`}
    </div>
  `;
}

function renderStoreDetail(storeCode) {
  const store = STORES.find((s) => safeTrim(s["Store code"] || s.store_code) === storeCode);
  if (!store) return;

  const storeName = safeTrim(store["Store name"] || store.store_name);
  const storeTx = TX.filter((t) => matchAssigned(t.Assigned, storeCode, storeName));
  const outTx = storeTx.filter((t) => t.TxType === "out");
  const inTx = storeTx.filter((t) => t.TxType === "in");

  const deviceMap = {};
  outTx.forEach((t) => {
    const key = safeTrim(t.Item);
    if (!key) return;
    if (!deviceMap[key]) deviceMap[key] = { item: key, qty: 0, sn: new Set(), assigned: new Set(), lastDate: "" };
    deviceMap[key].qty += toNumber(t.Quantity, 0);
    const _sn = t.SN;
    if (Array.isArray(_sn)) {
      _sn.forEach((s) => { const v = cleanSN(s); if (v) deviceMap[key].sn.add(v); });
    } else {
      safeTrim(_sn).split(/[\n,]+/).forEach((s) => { const sv = cleanSN(s); if (sv) deviceMap[key].sn.add(sv); });
    }
    if (safeTrim(t.Assigned)) deviceMap[key].assigned.add(safeTrim(t.Assigned));
    if (safeTrim(t.Date) > deviceMap[key].lastDate) deviceMap[key].lastDate = safeTrim(t.Date);
  });
  inTx.forEach((t) => {
    const key = safeTrim(t.Item);
    if (deviceMap[key]) deviceMap[key].qty = Math.max(0, deviceMap[key].qty - toNumber(t.Quantity, 0));
  });

  const devices = Object.values(deviceMap).sort((a, b) => b.qty - a.qty);
  const totalDevices = devices.reduce((s, d) => s + d.qty, 0);

  const code = storeCode;
  const name = safeTrim(store["Store name"] || store.store_name);
  const brand = safeTrim(store.Brand || store.brand);

  $("main").innerHTML = `
    <div style="margin-bottom:20px">
      <button onclick="showPage('stores')" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:0;display:flex;align-items:center;gap:6px;margin-bottom:16px;transition:color .15s" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--muted)'">
        ← Quay lại danh sách cửa hàng
      </button>

      <div style="display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--accent);background:rgba(88,166,255,.1);padding:3px 10px;border-radius:4px">${code}</span>
            <button onclick="toggleO2O('${code}')" title="Bấm để bật/tắt O2O" style="font-size:11px;padding:2px 10px;border-radius:4px;cursor:pointer;font-weight:600;letter-spacing:.5px;transition:all .15s;border:1px solid ${safeTrim(store.O2O || store.o2o) ? 'rgba(63,185,80,.4);background:rgba(63,185,80,.15);color:var(--in)' : 'var(--border);background:var(--surface2);color:var(--dim)'}">O2O</button>
            <button onclick="openStoreModal('${store.id}')" title="Chỉnh sửa thông tin cửa hàng" style="font-size:12px;padding:2px 10px;border-radius:4px;cursor:pointer;border:1px solid var(--border);background:var(--surface2);color:var(--muted);transition:all .15s" onmouseover="this.style.color='var(--text)';this.style.borderColor='var(--accent)'" onmouseout="this.style.color='var(--muted)';this.style.borderColor='var(--border)'">✎ Sửa</button>
            <span style="font-size:11px;color:var(--warn);text-transform:uppercase;letter-spacing:.5px">${brand}</span>
          </div>
          <div style="font-size:22px;font-weight:700;margin-bottom:4px">${name}</div>
          <div style="font-size:13px;color:var(--muted)">${safeTrim(store.Type || store.type) || ""} ${safeTrim(store["Type 2"] || store.type2) ? "· " + safeTrim(store["Type 2"] || store.type2) : ""}</div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center;min-width:120px">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Thiết bị</div>
          <div style="font-size:32px;font-weight:700;font-family:'IBM Plex Mono',monospace;color:var(--accent)">${totalDevices}</div>
          <div style="font-size:11px;color:var(--dim)">${devices.length} loại</div>
        </div>
      </div>
    </div>

    <div style="display:flex;gap:24px;flex-wrap:wrap;padding:14px 18px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:20px;font-size:13px">
      ${safeTrim(store.Incharge || store.incharge) ? `<div><span style="color:var(--dim);margin-right:6px">Incharge</span><span style="font-weight:500">${safeTrim(store.Incharge || store.incharge)}</span> <span style="color:var(--muted);font-size:11px">(${safeTrim(store.Position || store.position) || ""})</span></div>` : ""}
      ${safeTrim(store.Phone || store.phone) ? `<div><span style="color:var(--dim);margin-right:6px">Phone</span><a href="tel:${safeTrim(store.Phone || store.phone)}" style="color:var(--accent);text-decoration:none">${safeTrim(store.Phone || store.phone)}</a></div>` : ""}
      ${safeTrim(store.AM || store.am) ? `<div><span style="color:var(--dim);margin-right:6px">AM</span><span>${safeTrim(store.AM || store.am)}</span></div>` : ""}
      ${safeTrim(store["Open date"] || store.open_date) ? `<div><span style="color:var(--dim);margin-right:6px">Mở cửa</span><span style="font-family:'IBM Plex Mono',monospace;font-size:12px">${safeTrim(store["Open date"] || store.open_date)}</span></div>` : ""}
      ${safeTrim(store.TotalArea || store.total_area) ? `<div><span style="color:var(--dim);margin-right:6px">Diện tích</span><span>${safeTrim(store.TotalArea || store.total_area)} m²</span></div>` : ""}
      ${safeTrim(store.Address || store.address) ? `<div style="flex-basis:100%;color:var(--dim);font-size:12px">📍 ${safeTrim(store.Address || store.address)}</div>` : ""}
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.8px">Thiết bị tại cửa hàng</div>
      <span style="font-size:12px;color:var(--dim)">${storeTx.length} giao dịch liên quan</span>
    </div>

    ${devices.length ? `
      <div class="table-wrap" style="margin-bottom:20px">
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Thiết bị</th>
                <th>Số lượng</th>
                <th>Vị trí / Sub</th>
                <th>Serial / S/N</th>
                <th>Ngày gần nhất</th>
              </tr>
            </thead>
            <tbody>
              ${devices.map((d) => `
                <tr>
                  <td style="font-weight:500">${d.item}</td>
                  <td><span style="font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:700;color:var(--accent)">${d.qty}</span></td>
                  <td style="font-size:11px;color:var(--muted)">${[...d.assigned].map((a) => `<span style="background:var(--surface2);padding:1px 6px;border-radius:3px;margin-right:3px">${a}</span>`).join("")}</td>
                  <td style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--dim)">
                    ${d.sn.size ? [...d.sn].map((s) => `<div style="white-space:nowrap">${s}</div>`).join("") : "—"}
                  </td>
                  <td style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)">${fmtDate(d.lastDate) || "—"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    ` : `<div class="empty"><div class="e-icon">📦</div><div>Chưa có thiết bị nào được ghi nhận cho cửa hàng này</div></div>`}

    ${storeTx.length ? `
      <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px">Lịch sử giao dịch</div>
      <div class="table-wrap">
        <div class="table-scroll" style="max-height:300px">
          <table>
            <thead><tr><th>Thiết bị</th><th>Loại</th><th>SL</th><th>Assigned</th><th>Trạng thái</th><th>Ngày</th></tr></thead>
            <tbody>
              ${[...storeTx].sort((a, b) => (safeTrim(b.Date)).localeCompare(safeTrim(a.Date))).map((t) => `
                <tr>
                  <td style="font-weight:500">${safeTrim(t.Item)}${t.Description ? `<div style="font-size:11px;color:var(--dim)">${safeTrim(t.Description)}</div>` : ""}</td>
                  <td><span class="badge-tx ${t.TxType === "in" ? "badge-in" : "badge-out"}">${t.TxType === "in" ? "↑ IN" : "↓ OUT"}</span></td>
                  <td class="mono" style="font-size:15px;font-weight:600;color:${t.TxType === "in" ? "var(--in)" : "var(--out)"}">${toNumber(t.Quantity, 0)}</td>
                  <td style="font-size:11px;color:var(--muted)">${safeTrim(t.Assigned) || "—"}</td>
                  <td>${statusBadge(t.Status)}</td>
                  <td class="mono" style="font-size:11px;color:var(--muted);white-space:nowrap">${fmtDate(safeTrim(t.Date)) || "—"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    ` : ""}
  `;
}

window.showPage = showPage;
window.renderStoreDetail = renderStoreDetail;

function openStoreModal(storeId) {
  if (!requireAuth("chỉnh sửa cửa hàng")) return;
  const store = STORES.find((s) => String(s.id) === String(storeId));
  if (!store) return;
  editingStoreId = storeId;
  const g = (keys) => { for (const k of keys) { const v = safeTrim(store[k]); if (v) return v; } return ""; };
  $("stCode").value        = g(["Store code","store_code"]);
  $("stName").value        = g(["Store name","store_name"]);
  $("stBrand").value       = g(["Brand","brand"]);
  $("stBrand2").value      = g(["Brand2","brand2"]);
  $("stType").value        = g(["Type","type"]);
  $("stType2").value       = g(["Type 2","type2","Type2"]);
  $("stIncharge").value    = g(["Incharge","incharge"]);
  $("stPosition").value    = g(["Position","position"]);
  $("stPhone").value       = g(["Phone","phone"]);
  $("stEmail").value       = g(["Email","email"]);
  $("stAM").value          = g(["AM","am"]);
  $("stOpenDate").value    = g(["Open date","open_date"]);
  $("stTotalArea").value   = store.TotalArea ?? store.total_area ?? "";
  $("stSellArea").value    = store.SellArea ?? store.sell_area ?? "";
  $("stRegion").value      = g(["Region","region"]);
  $("stCostCenter").value  = g(["Cost Center","cost_center","CostCenter"]);
  $("stAddress").value     = g(["Address","address"]);
  $("storeModal").classList.add("open");
  setTimeout(() => $("stName").focus(), 150);
}

function closeStoreModal() {
  $("storeModal").classList.remove("open");
  editingStoreId = null;
}

async function submitStore() {
  if (!editingStoreId) return;
  const store = STORES.find((s) => String(s.id) === String(editingStoreId));
  if (!store) return;
  const code     = safeTrim($("stCode").value);
  const name     = safeTrim($("stName").value);
  if (!code || !name) { showToast("Vui lòng nhập Store code và Store name.", "error"); return; }
  const payload = {
    "Store code":  code,
    "Store name":  name,
    store_code: code, store_name: name, storeKey: code.toLowerCase(),
    Brand:         safeTrim($("stBrand").value),
    Brand2:        safeTrim($("stBrand2").value),
    Type:          safeTrim($("stType").value),
    "Type 2":      safeTrim($("stType2").value),
    Incharge:      safeTrim($("stIncharge").value),
    Position:      safeTrim($("stPosition").value),
    Phone:         safeTrim($("stPhone").value),
    Email:         safeTrim($("stEmail").value),
    AM:            safeTrim($("stAM").value),
    "Open date":   safeTrim($("stOpenDate").value),
    TotalArea:     parseFloat($("stTotalArea").value) || 0,
    SellArea:      parseFloat($("stSellArea").value) || 0,
    Region:        safeTrim($("stRegion").value),
    "Cost Center": safeTrim($("stCostCenter").value),
    Address:       safeTrim($("stAddress").value),
    updatedAt: serverTimestamp(),
  };
  try {
    $("btnSubmitStore").disabled = true;
    await updateDoc(doc(db, "stores", String(editingStoreId)), payload);
    Object.assign(store, payload);
    buildAutocompleteSources();
    showToast(`✓ Đã cập nhật: ${name}`, "success");
    closeStoreModal();
    renderStoreDetail(code);
  } catch (e) {
    showToast(`Lỗi: ${e?.message || e}`, "error");
  } finally {
    $("btnSubmitStore").disabled = false;
  }
}

window.openStoreModal = openStoreModal;

async function toggleO2O(storeCode) {
  const store = STORES.find((s) => safeTrim(s["Store code"] || s.store_code) === storeCode);
  if (!store) return;
  const isOn = !!safeTrim(store.O2O || store.o2o);
  const newVal = isOn ? "" : "O2O";
  store.O2O = newVal;
  if (store.o2o !== undefined) store.o2o = newVal;
  try {
    const ref = doc(db, "stores", store.id);
    await updateDoc(ref, { O2O: newVal, updatedAt: serverTimestamp() });
  } catch (e) {
    console.error("toggleO2O:", e);
  }
  renderStoreDetail(storeCode);
}
window.toggleO2O = toggleO2O;

// ── OFFICES / WAREHOUSES ──────────────────────────────────
function renderOffices() {
  const cards = OFFICES.map((o) => {
    const code = safeTrim(o.code || o.Code || o["Office code"]);
    const name = safeTrim(o.name || o.Name || o["Office name"]);
    const deviceCount = TX.filter((t) => t.TxType === "out" && matchAssigned(t.Assigned, code, name)).length;
    return `
      <div class="store-card store-card-clickable" onclick="renderOfficeDetail('${code.replace(/'/g, "\\'")}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px">
          <div class="sc-code">${code}</div>
          <div style="display:flex;gap:4px" onclick="event.stopPropagation()">
            <button onclick="openOfficeModal('${String(o.id).replace(/'/g, "\\'")}')" style="background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:13px;padding:2px 4px;border-radius:3px;transition:color .15s" title="Chỉnh sửa">✎</button>
            <button onclick="deleteOffice('${String(o.id).replace(/'/g, "\\'")}')" style="background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:13px;padding:2px 4px;border-radius:3px;transition:color .15s" title="Xoá">✕</button>
          </div>
        </div>
        <div class="sc-name">${name}</div>
        <div style="font-size:12px;color:var(--dim);margin-top:4px">📍 ${safeTrim(o.location || o.Location || "")}</div>
        <div style="font-size:12px;color:var(--dim);margin-top:2px">👤 ${safeTrim(o.incharge || o.Incharge || "")}</div>
        <div class="sr" style="margin-top:8px">${deviceCount} thiết bị đang dùng</div>
      </div>`;
  }).join("");

  $("main").innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div>
        <div class="page-title">🏢 Văn phòng</div>
        <div class="page-sub">${OFFICES.length} văn phòng</div>
      </div>
      <button class="btn-primary" onclick="openOfficeModal()">＋ Thêm văn phòng</button>
    </div>
    <div class="store-grid">${cards || '<div class="empty" style="grid-column:1/-1"><div class="e-icon">○</div>Chưa có văn phòng nào.</div>'}</div>
  `;
}

function renderOfficeDetail(code) {
  const office = OFFICES.find((o) => safeTrim(o.code || o.Code || o["Office code"]) === code);
  if (!office) return;
  const officeName = safeTrim(office.name || office.Name || office["Office name"]);
  const assigned = TX.filter((t) => t.TxType === "out" && matchAssigned(t.Assigned, code, officeName));

  $("main").innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <button class="btn-secondary" onclick="showPage('offices')">← Quay lại</button>
      <div>
        <div class="page-title">🏢 ${safeTrim(office.name || office.Name || office["Office name"])}</div>
        <div class="page-sub">${code} · ${safeTrim(office.location || office.Location || "")}</div>
      </div>
    </div>
    <div class="table-wrap">
      <div class="table-scroll" style="max-height:520px">
        <table>
          <thead><tr><th>Ngày</th><th>Thiết bị</th><th>Mô tả</th><th>SL</th><th>Serial</th><th>Trạng thái</th></tr></thead>
          <tbody>
            ${assigned.length ? assigned.sort((a,b)=>safeTrim(b.Date).localeCompare(safeTrim(a.Date))).map((t) => `
              <tr>
                <td class="mono" style="font-size:11px;color:var(--muted)">${fmtDate(safeTrim(t.Date)) || "—"}</td>
                <td style="font-weight:500">${safeTrim(t.Item)}</td>
                <td style="font-size:11px;color:var(--dim)">${safeTrim(t.Description) || "—"}</td>
                <td class="mono" style="font-weight:600">${toNumber(t.Quantity,0)} ${safeTrim(t.Unit)||""}</td>
                <td class="mono" style="font-size:11px;color:var(--dim)">${cleanSN(safeTrim(t.SN)) || "—"}</td>
                <td>${statusBadge(t.Status)}</td>
              </tr>
            `).join("") : `<tr><td colspan="6"><div class="empty"><div class="e-icon">○</div>Không có thiết bị nào</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

let editingStoreId = null;
let editingOfficeId = null;

function openOfficeModal(officeId) {
  if (!requireAuth("thêm/chỉnh sửa văn phòng")) return;
  editingOfficeId = officeId ?? null;
  const isEdit = editingOfficeId != null;

  $("officeModalTitle").textContent = isEdit ? "✎ Chỉnh sửa văn phòng" : "＋ Thêm văn phòng";
  $("btnSubmitOffice").textContent = isEdit ? "Cập nhật" : "Lưu văn phòng";

  if (isEdit) {
    const o = OFFICES.find((x) => String(x.id) === String(editingOfficeId));
    if (!o) return;
    $("ofCode").value = safeTrim(o.code || o.Code || o["Office code"]);
    $("ofName").value = safeTrim(o.name || o.Name || o["Office name"]);
    $("ofLocation").value = safeTrim(o.location || o.Location || "");
    $("ofIncharge").value = safeTrim(o.incharge || o.Incharge || "");
  } else {
    ["ofCode", "ofName", "ofLocation", "ofIncharge"].forEach((id) => ($(id).value = ""));
  }
  $("officeModal").classList.add("open");
  setTimeout(() => $(isEdit ? "ofName" : "ofCode").focus(), 150);
}

function closeOfficeModal() {
  $("officeModal").classList.remove("open");
  editingOfficeId = null;
}

async function submitOffice() {
  const code = safeTrim($("ofCode").value);
  const name = safeTrim($("ofName").value);
  const location = safeTrim($("ofLocation").value);
  const incharge = safeTrim($("ofIncharge").value);
  if (!code || !name) {
    showToast("Vui lòng nhập mã và tên văn phòng.", "error");
    return;
  }
  try {
    $("btnSubmitOffice").disabled = true;
    if (editingOfficeId != null) {
      const ref = doc(db, "offices", String(editingOfficeId));
      await updateDoc(ref, { code, name, location, incharge, updatedAt: serverTimestamp() });
      const o = OFFICES.find((x) => String(x.id) === String(editingOfficeId));
      if (o) { o.code = code; o.name = name; o.location = location; o.incharge = incharge; }
      showToast(`✓ Đã cập nhật văn phòng: ${name}`, "success");
    } else {
      const ref = doc(collection(db, "offices"));
      const batch = writeBatch(db);
      batch.set(ref, { code, name, location, incharge, createdAt: serverTimestamp() });
      await batch.commit();
      OFFICES.push({ id: ref.id, code, name, location, incharge });
      $("cnt-offices").textContent = OFFICES.length;
      showToast(`✓ Đã thêm văn phòng: ${name}`, "success");
    }
    buildAutocompleteSources();
    closeOfficeModal();
    render();
  } catch (e) {
    showToast(`Lỗi: ${e?.message || e}`, "error");
  } finally {
    $("btnSubmitOffice").disabled = false;
  }
}

async function deleteOffice(id) {
  if (!requireAuth("xóa văn phòng", "admin")) return;
  const o = OFFICES.find((x) => String(x.id) === String(id));
  if (!o) return;
  if (!confirm(`Xoá văn phòng "${safeTrim(o.name || o.Name || "")}"?`)) return;
  try {
    await deleteDoc(doc(db, "offices", String(id)));
    OFFICES = OFFICES.filter((x) => String(x.id) !== String(id));
    $("cnt-offices").textContent = OFFICES.length;
    buildAutocompleteSources();
    showToast(`Đã xoá: ${safeTrim(o.name || o.Name || "")}`, "success");
    render();
  } catch (e) {
    showToast(`Lỗi xóa: ${e?.message || e}`, "error");
  }
}

function renderWarehouses() {
  const cards = WAREHOUSES.map((w) => {
    const code = safeTrim(w.code || w.Code || w["Warehouse code"]);
    const name = safeTrim(w.name || w.Name || w["Warehouse name"]);
    const deviceCount = TX.filter((t) => t.TxType === "out" && matchAssigned(t.Assigned, code, name)).length;
    return `
      <div class="store-card store-card-clickable" onclick="renderWarehouseDetail('${code.replace(/'/g, "\\'")}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px">
          <div class="sc-code">${code}</div>
          <div style="display:flex;gap:4px" onclick="event.stopPropagation()">
            <button onclick="openWarehouseModal('${String(w.id).replace(/'/g, "\\'")}')" style="background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:13px;padding:2px 4px;border-radius:3px;transition:color .15s" title="Chỉnh sửa">✎</button>
            <button onclick="deleteWarehouse('${String(w.id).replace(/'/g, "\\'")}')" style="background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:13px;padding:2px 4px;border-radius:3px;transition:color .15s" title="Xoá">✕</button>
          </div>
        </div>
        <div class="sc-name">${name}</div>
        <div style="font-size:12px;color:var(--dim);margin-top:4px">📍 ${safeTrim(w.location || w.Location || "")}</div>
        <div style="font-size:12px;color:var(--dim);margin-top:2px">👤 ${safeTrim(w.incharge || w.Incharge || "")}</div>
        <div class="sr" style="margin-top:8px">${deviceCount} thiết bị trong kho</div>
      </div>`;
  }).join("");

  $("main").innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div>
        <div class="page-title">🏭 Kho</div>
        <div class="page-sub">${WAREHOUSES.length} kho</div>
      </div>
      <button class="btn-primary" onclick="openWarehouseModal()">＋ Thêm kho</button>
    </div>
    <div class="store-grid">${cards || '<div class="empty" style="grid-column:1/-1"><div class="e-icon">○</div>Chưa có kho nào.</div>'}</div>
  `;
}

function renderWarehouseDetail(code) {
  const warehouse = WAREHOUSES.find((w) => safeTrim(w.code || w.Code || w["Warehouse code"]) === code);
  if (!warehouse) return;
  const warehouseName = safeTrim(warehouse.name || warehouse.Name || warehouse["Warehouse name"]);
  const assigned = TX.filter((t) => t.TxType === "out" && matchAssigned(t.Assigned, code, warehouseName));

  // Group by item name: sum quantity, collect all serials
  const itemMap = {};
  assigned.forEach((t) => {
    const key = safeTrim(t.Item);
    if (!key) return;
    if (!itemMap[key]) itemMap[key] = { item: key, qty: 0, sns: [], unit: safeTrim(t.Unit) || "", desc: safeTrim(t.Description) || "", status: t.Status, lastDate: "" };
    itemMap[key].qty += toNumber(t.Quantity, 0);
    // collect serials – support both array and string formats
    const snVal = t.SN;
    if (Array.isArray(snVal)) {
      snVal.forEach((s) => { const v = cleanSN(s); if (v) itemMap[key].sns.push(v); });
    } else {
      const v = safeTrim(snVal);
      if (v) v.split(/[\n,]+/).forEach((s) => { const sv = cleanSN(s); if (sv) itemMap[key].sns.push(sv); });
    }
    if (safeTrim(t.Date) > itemMap[key].lastDate) itemMap[key].lastDate = safeTrim(t.Date);
  });
  const grouped = Object.values(itemMap).sort((a, b) => a.item.localeCompare(b.item));

  $("main").innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <button class="btn-secondary" onclick="showPage('warehouses')">← Quay lại</button>
      <div>
        <div class="page-title">🏭 ${safeTrim(warehouse.name || warehouse.Name || warehouse["Warehouse name"])}</div>
        <div class="page-sub">${code} · ${safeTrim(warehouse.location || warehouse.Location || "")}</div>
      </div>
    </div>
    <div class="table-wrap">
      <div class="table-scroll" style="max-height:520px">
        <table>
          <thead><tr><th>Thiết bị</th><th>Mô tả</th><th>SL</th><th>Serial (${grouped.reduce((s,d)=>s+d.sns.length,0)})</th><th>Ngày</th><th>Trạng thái</th></tr></thead>
          <tbody>
            ${grouped.length ? grouped.map((d) => `
              <tr>
                <td style="font-weight:500">${d.item}</td>
                <td style="font-size:11px;color:var(--dim)">${d.desc || "—"}</td>
                <td class="mono" style="font-weight:600;font-size:15px;color:var(--accent)">${d.qty} <span style="font-size:11px;color:var(--muted)">${d.unit}</span></td>
                <td class="mono" style="font-size:11px;color:var(--dim)">
                  ${d.sns.length
                    ? d.sns.map((s) => `<div style="white-space:nowrap">${s}</div>`).join("")
                    : "—"}
                </td>
                <td class="mono" style="font-size:11px;color:var(--muted)">${fmtDate(d.lastDate) || "—"}</td>
                <td>${statusBadge(d.status)}</td>
              </tr>
            `).join("") : `<tr><td colspan="6"><div class="empty"><div class="e-icon">○</div>Không có thiết bị nào</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

let editingWarehouseId = null;

function openWarehouseModal(warehouseId) {
  if (!requireAuth("thêm/chỉnh sửa kho")) return;
  editingWarehouseId = warehouseId ?? null;
  const isEdit = editingWarehouseId != null;

  $("warehouseModalTitle").textContent = isEdit ? "✎ Chỉnh sửa kho" : "＋ Thêm kho";
  $("btnSubmitWarehouse").textContent = isEdit ? "Cập nhật" : "Lưu kho";

  if (isEdit) {
    const w = WAREHOUSES.find((x) => String(x.id) === String(editingWarehouseId));
    if (!w) return;
    $("whCode").value = safeTrim(w.code || w.Code || w["Warehouse code"]);
    $("whName").value = safeTrim(w.name || w.Name || w["Warehouse name"]);
    $("whLocation").value = safeTrim(w.location || w.Location || "");
    $("whIncharge").value = safeTrim(w.incharge || w.Incharge || "");
  } else {
    ["whCode", "whName", "whLocation", "whIncharge"].forEach((id) => ($(id).value = ""));
  }
  $("warehouseModal").classList.add("open");
  setTimeout(() => $(isEdit ? "whName" : "whCode").focus(), 150);
}

function closeWarehouseModal() {
  $("warehouseModal").classList.remove("open");
  editingWarehouseId = null;
}

async function submitWarehouse() {
  const code = safeTrim($("whCode").value);
  const name = safeTrim($("whName").value);
  const location = safeTrim($("whLocation").value);
  const incharge = safeTrim($("whIncharge").value);
  if (!code || !name) {
    showToast("Vui lòng nhập mã và tên kho.", "error");
    return;
  }
  try {
    $("btnSubmitWarehouse").disabled = true;
    if (editingWarehouseId != null) {
      const ref = doc(db, "warehouses", String(editingWarehouseId));
      await updateDoc(ref, { code, name, location, incharge, updatedAt: serverTimestamp() });
      const w = WAREHOUSES.find((x) => String(x.id) === String(editingWarehouseId));
      if (w) { w.code = code; w.name = name; w.location = location; w.incharge = incharge; }
      showToast(`✓ Đã cập nhật kho: ${name}`, "success");
    } else {
      const ref = doc(collection(db, "warehouses"));
      const batch = writeBatch(db);
      batch.set(ref, { code, name, location, incharge, createdAt: serverTimestamp() });
      await batch.commit();
      WAREHOUSES.push({ id: ref.id, code, name, location, incharge });
      $("cnt-warehouses").textContent = WAREHOUSES.length;
      showToast(`✓ Đã thêm kho: ${name}`, "success");
    }
    buildAutocompleteSources();
    closeWarehouseModal();
    render();
  } catch (e) {
    showToast(`Lỗi: ${e?.message || e}`, "error");
  } finally {
    $("btnSubmitWarehouse").disabled = false;
  }
}

async function deleteWarehouse(id) {
  if (!requireAuth("xóa kho", "admin")) return;
  const w = WAREHOUSES.find((x) => String(x.id) === String(id));
  if (!w) return;
  if (!confirm(`Xoá kho "${safeTrim(w.name || w.Name || "")}"?`)) return;
  try {
    await deleteDoc(doc(db, "warehouses", String(id)));
    WAREHOUSES = WAREHOUSES.filter((x) => String(x.id) !== String(id));
    $("cnt-warehouses").textContent = WAREHOUSES.length;
    buildAutocompleteSources();
    showToast(`Đã xoá: ${safeTrim(w.name || w.Name || "")}`, "success");
    render();
  } catch (e) {
    showToast(`Lỗi xóa: ${e?.message || e}`, "error");
  }
}

window.renderOfficeDetail = renderOfficeDetail;
window.openOfficeModal = openOfficeModal;
window.deleteOffice = deleteOffice;
window.submitOffice = submitOffice;
window.renderWarehouseDetail = renderWarehouseDetail;
window.openWarehouseModal = openWarehouseModal;
window.deleteWarehouse = deleteWarehouse;
window.submitWarehouse = submitWarehouse;
window.openTxEdit = openTxEdit;
window.deleteTx = deleteTx;
window.toggleTxGroup = toggleTxGroup;

// ── AUTOCOMPLETE SOURCES ──────────────────────────────────
let AC_ITEMS = [];
let AC_ASSIGNED = [];
let AC_TYPES = [];
let acIndex = -1;
let acAssignedIndex = -1;
let acTypeIndex = -1;

function buildAutocompleteSources() {
  AC_ITEMS = [...new Map(STOCK.map((s) => [safeTrim(s.Item), { item: safeTrim(s.Item), type: safeTrim(s.TypeDevice) }])).values()].filter((x) => x.item);
  AC_TYPES = [...new Set(STOCK.map((s) => safeTrim(s.TypeDevice)).filter(Boolean))].sort();
  AC_ASSIGNED = [...new Set([
    "Stock IT",
    ...TX.map((t) => safeTrim(t.Assigned)).filter(Boolean),
    ...STORES.map((s) => safeTrim(s["Store code"] || s.store_code)).filter(Boolean),
    ...OFFICES.map((o) => safeTrim(o.code)).filter(Boolean),
    ...WAREHOUSES.map((w) => safeTrim(w.code)).filter(Boolean),
  ])].filter(Boolean).sort();
}

// ── TX MODAL / AUTOCOMPLETE ────────────────────────────────
let newTxType = "in";
let editingTxId = null;
let expandedTxGroups = new Set();
let _txGroupedData = [];

function updateTxSerialFields(qty, prefill = []) {
  const wrapper = $("fSNWrapper");
  const countEl = $("fSNCount");
  if (!wrapper) return;
  const n = Math.max(1, toNumber(qty, 1));
  const existing = [...wrapper.querySelectorAll(".sn-input")].map((i) => i.value);
  wrapper.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "field-input sn-input";
    inp.placeholder = `Serial ${i + 1}`;
    inp.autocomplete = "off";
    inp.value = prefill[i] ?? existing[i] ?? "";
    wrapper.appendChild(inp);
  }
  if (countEl) countEl.textContent = n > 1 ? `(${n} serial)` : "";
}

function getTxSerials() {
  const inputs = document.querySelectorAll("#fSNWrapper .sn-input");
  return [...inputs].map((i) => i.value.trim()).filter(Boolean);
}

function openModal(prefillType) {
  if (!requireAuth("thêm giao dịch")) return;
  editingTxId = null;
  $("modalTitle").textContent = "+ Nhập giao dịch mới";
  $("btnSubmitTx").textContent = "Lưu giao dịch";
  setTxType(prefillType || "in");

  $("fDate").value = new Date().toISOString().split("T")[0];
  ["fItem", "fTypeDevice", "fAssigned", "fDesc"].forEach((id) => ($(id).value = ""));
  $("fQty").value = 1;
  $("fUnit").value = "pcs";
  $("fStatus").value = "";
  updateTxSerialFields(1, []);
  $("txModal").classList.add("open");
  setTimeout(() => $("fItem").focus(), 150);
}

function closeModal() {
  $("txModal").classList.remove("open");
  $("acList").classList.remove("open");
  $("acAssignedList").classList.remove("open");
  editingTxId = null;
}

function setTxType(type) {
  newTxType = type;
  $("btnIn").classList.toggle("active", type === "in");
  $("btnOut").classList.toggle("active", type === "out");
}

function acInput() {
  const q = keyOf($("fItem").value);
  const list = $("acList");
  acIndex = -1;
  if (!q) {
    list.classList.remove("open");
    return;
  }
  const matches = AC_ITEMS.filter((i) => keyOf(i.item).includes(q)).slice(0, 12);
  if (!matches.length) {
    list.classList.remove("open");
    return;
  }
  list.innerHTML = matches
    .map(
      (m) =>
        `<div class="autocomplete-item" data-item="${m.item.replace(/"/g, "&quot;")}" data-type="${m.type.replace(
          /"/g,
          "&quot;"
        )}" onmousedown="acSelect(event)">${m.item}<span class="ac-type">${m.type}</span></div>`
    )
    .join("");
  list.classList.add("open");
}

function acSelect(e) {
  e.preventDefault();
  const item = e.currentTarget.dataset.item || "";
  const type = e.currentTarget.dataset.type || "";
  $("fItem").value = item;
  $("fTypeDevice").value = type;
  $("acList").classList.remove("open");
  $("fQty").focus();
}

function acKey(e) {
  const list = $("acList");
  const items = list.querySelectorAll(".autocomplete-item");
  if (!list.classList.contains("open")) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    acIndex = Math.min(acIndex + 1, items.length - 1);
    acHighlight(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    acIndex = Math.max(acIndex - 1, -1);
    acHighlight(items);
  } else if (e.key === "Enter" && acIndex >= 0) {
    e.preventDefault();
    items[acIndex].dispatchEvent(new MouseEvent("mousedown"));
  } else if (e.key === "Escape") list.classList.remove("open");
}

function acHighlight(items) {
  items.forEach((el, i) => el.classList.toggle("focused", i === acIndex));
  if (acIndex >= 0) items[acIndex].scrollIntoView({ block: "nearest" });
}

function acAssignedInput() {
  const q = keyOf($("fAssigned").value);
  const list = $("acAssignedList");
  acAssignedIndex = -1;
  if (!q) {
    list.classList.remove("open");
    return;
  }
  const matches = AC_ASSIGNED.filter((a) => keyOf(a).includes(q)).slice(0, 10);
  if (!matches.length) {
    list.classList.remove("open");
    return;
  }
  list.innerHTML = matches.map((m) => `<div class="autocomplete-item" onmousedown="acAssignedSelect(event)">${m}</div>`).join("");
  list.classList.add("open");
}

function acAssignedSelect(e) {
  e.preventDefault();
  $("fAssigned").value = e.currentTarget.textContent || "";
  $("acAssignedList").classList.remove("open");
}

function acAssignedKey(e) {
  const list = $("acAssignedList");
  const items = list.querySelectorAll(".autocomplete-item");
  if (!list.classList.contains("open")) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    acAssignedIndex = Math.min(acAssignedIndex + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle("focused", i === acAssignedIndex));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    acAssignedIndex = Math.max(acAssignedIndex - 1, -1);
    items.forEach((el, i) => el.classList.toggle("focused", i === acAssignedIndex));
  } else if (e.key === "Enter" && acAssignedIndex >= 0) {
    e.preventDefault();
    items[acAssignedIndex].dispatchEvent(new MouseEvent("mousedown"));
  } else if (e.key === "Escape") list.classList.remove("open");
}

function openTxEdit(txId) {
  if (!requireAuth("chỉnh sửa giao dịch")) return;
  const t = TX.find((x) => String(x.id) === String(txId));
  if (!t) return;
  editingTxId = txId;
  $("modalTitle").textContent = "✎ Chỉnh sửa giao dịch";
  $("btnSubmitTx").textContent = "Cập nhật";
  setTxType(t.TxType || "out");
  $("fItem").value = safeTrim(t.Item);
  $("fTypeDevice").value = safeTrim(t.TypeDevice || "");
  $("fQty").value = toNumber(t.Quantity, 1);
  $("fDate").value = safeTrim(t.Date);
  $("fDesc").value = safeTrim(t.Description);
  $("fUnit").value = safeTrim(t.Unit) || "pcs";
  $("fAssigned").value = safeTrim(t.Assigned);
  $("fStatus").value = safeTrim(t.Status);
  const _snPrefill = Array.isArray(t.SN) ? t.SN.filter(Boolean) : safeTrim(t.SN).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  updateTxSerialFields(toNumber(t.Quantity, 1), _snPrefill);
  $("txModal").classList.add("open");
  setTimeout(() => $("fItem").focus(), 150);
}

async function deleteTx(txId) {
  if (!requireAuth("xóa giao dịch", "admin")) return;
  const t = TX.find((x) => String(x.id) === String(txId));
  if (!t || !confirm(`Xoá giao dịch "${safeTrim(t.Item)}" (${safeTrim(t.Date)})?`)) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "transactions", String(txId)));

    // Revert stock: IN → subtract back, OUT → add back
    const itemKey = keyOf(safeTrim(t.Item));
    if (itemKey) {
      const stockSnap = await getDocs(query(collection(db, "stock"), where("itemKey", "==", itemKey)));
      if (!stockSnap.empty) {
        const sd = stockSnap.docs[0];
        const revert = t.TxType === "in" ? -toNumber(t.Quantity, 0) : toNumber(t.Quantity, 0);
        const newStock = Math.max(0, toNumber(sd.data().Stock, 0) + revert);
        batch.update(sd.ref, { Stock: newStock, updatedAt: serverTimestamp() });
      }
    }

    await batch.commit();
    TX = TX.filter((x) => String(x.id) !== String(txId));
    $("cnt-tx").textContent = TX.length;

    // Reload stock to keep UI in sync
    STOCK = (await loadCollection("stock")).map((s) => ({ ...s, Stock: toNumber(s.Stock, 0), TypeDevice: safeTrim(s.TypeDevice) }));
    $("cnt-stock").textContent = STOCK.length;
    buildAutocompleteSources();

    showToast("Đã xoá giao dịch & cập nhật tồn kho.", "success");
    render();
  } catch (e) {
    showToast(`Lỗi xóa: ${e?.message || e}`, "error");
  }
}

function toggleTxGroup(grpKey) {
  if (expandedTxGroups.has(grpKey)) expandedTxGroups.delete(grpKey);
  else expandedTxGroups.add(grpKey);
  render();
}

function showTxGroupDetail(grpKey) {
  const grp = _txGroupedData.find((g) => g.key === grpKey);
  if (!grp) return;
  const _bs = "background:transparent;border:none;cursor:pointer;font-size:13px;padding:2px 5px;border-radius:3px;transition:color .15s";
  const _isSingle = grp.rawTxs.length === 1;
  const box = $("txGroupDetailModal");
  $("txGroupDetailTitle").innerHTML = `<span style="font-weight:600">${grp.item}</span> <span class="badge-tx ${grp.txType === "in" ? "badge-in" : "badge-out"}">${grp.txType === "in" ? "↑ IN" : "↓ OUT"}</span> <span style="color:var(--dim);font-size:13px">— ${_isSingle ? `SL: ${grp.qty}` : `${grp.rawTxs.length} giao dịch, tổng ${grp.qty}`}</span>`;
  $("txGroupDetailBody").innerHTML = grp.rawTxs.map((t, i) => {
    const _tsn = Array.isArray(t.SN) ? t.SN.map(cleanSN).filter(Boolean) : safeTrim(t.SN).split(/[\n,]+/).map(cleanSN).filter(Boolean);
    return `
      <div class="txg-card">
        <div class="txg-card-header">
          ${_isSingle ? "" : `<span class="txg-card-no">#${i + 1}</span>`}
          <span class="mono" style="font-size:12px;color:var(--muted)">${fmtDate(safeTrim(t.Date)) || "—"}</span>
          <div style="margin-left:auto;display:flex;gap:4px">
            <button onclick="openTxEdit('${t.id}');closeTxGroupDetail()" style="${_bs};color:var(--dim)" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--dim)'" title="Chỉnh sửa">✎</button>
            <button onclick="deleteTx('${t.id}');closeTxGroupDetail()" style="${_bs};color:var(--dim)" onmouseover="this.style.color='var(--out)'" onmouseout="this.style.color='var(--dim)'" title="Xoá">✕</button>
          </div>
        </div>
        <div class="txg-card-body">
          <div class="txg-row"><span class="txg-label">Số lượng</span><span class="mono" style="font-weight:600;font-size:16px;color:${t.TxType === "in" ? "var(--in)" : "var(--out)"}">${t.TxType === "in" ? "+" : "-"}${toNumber(t.Quantity, 0)} ${safeTrim(t.Unit) || "pcs"}</span></div>
          <div class="txg-row"><span class="txg-label">Giao cho</span><span>${safeTrim(t.Assigned) || "—"}</span></div>
          <div class="txg-row"><span class="txg-label">Trạng thái</span><span>${statusBadge(t.Status)}</span></div>
          ${_tsn.length ? `<div class="txg-row" style="align-items:flex-start"><span class="txg-label">Serial</span><div class="mono" style="font-size:11px;display:flex;flex-direction:column;gap:3px">${_tsn.map((s, si) => `<div style="display:flex;align-items:center;gap:6px"><span style="color:var(--accent);font-size:9px;min-width:14px">${si + 1}.</span><span>${s}</span></div>`).join("")}</div></div>` : ""}
          ${safeTrim(t.Description) ? `<div class="txg-row"><span class="txg-label">Mô tả</span><span style="font-size:12px;color:var(--dim)">${safeTrim(t.Description)}</span></div>` : ""}
        </div>
      </div>`;
  }).join("");
  box.classList.add("open");
}

function closeTxGroupDetail() {
  $("txGroupDetailModal").classList.remove("open");
}

window.showTxGroupDetail = showTxGroupDetail;
window.closeTxGroupDetail = closeTxGroupDetail;

// expose autocomplete handlers
window.openModal = openModal;
window.acInput = acInput;
window.acSelect = acSelect;
window.acKey = acKey;
window.acAssignedInput = acAssignedInput;
window.acAssignedSelect = acAssignedSelect;
window.acAssignedKey = acAssignedKey;

// ── SUBMIT TX (FIRESTORE) ──────────────────────────────────
async function submitTransaction() {
  if (!requireAuth("lưu giao dịch")) return;

  const item = safeTrim($("fItem").value);
  const qty = toNumber($("fQty").value, 0);
  const date = safeTrim($("fDate").value);
  if (!item || qty <= 0 || !date) {
    showToast("Vui lòng điền đầy đủ thông tin bắt buộc.", "error");
    return;
  }

  try {
    $("btnSubmitTx").disabled = true;

    if (editingTxId != null) {
      // ── EDIT MODE ──────────────────────────────────────
      const oldTx = TX.find((x) => String(x.id) === String(editingTxId));
      if (!oldTx) { showToast("Không tìm thấy giao dịch.", "error"); return; }

      const updatePayload = {
        Item: item,
        itemKey: keyOf(item),
        Description: safeTrim($("fDesc").value),
        Date: date,
        TxType: newTxType,
        Quantity: qty,
        Unit: safeTrim($("fUnit").value) || "pcs",
        Assigned: safeTrim($("fAssigned").value),
        Status: safeTrim($("fStatus").value),
        SN: getTxSerials(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || null,
      };

      const batch = writeBatch(db);
      batch.update(doc(db, "transactions", String(editingTxId)), updatePayload);

      const oldItemKey = keyOf(safeTrim(oldTx.Item));
      const newItemKey = keyOf(item);

      if (oldItemKey === newItemKey) {
        const stockSnap = await getDocs(query(collection(db, "stock"), where("itemKey", "==", newItemKey)));
        if (!stockSnap.empty) {
          const sd = stockSnap.docs[0];
          const revert = oldTx.TxType === "in" ? -toNumber(oldTx.Quantity, 0) : toNumber(oldTx.Quantity, 0);
          const apply  = newTxType === "in" ? qty : -qty;
          batch.update(sd.ref, { Stock: Math.max(0, toNumber(sd.data().Stock, 0) + revert + apply), updatedAt: serverTimestamp() });
        }
      } else {
        const [oldSnap, newSnap] = await Promise.all([
          getDocs(query(collection(db, "stock"), where("itemKey", "==", oldItemKey))),
          getDocs(query(collection(db, "stock"), where("itemKey", "==", newItemKey))),
        ]);
        if (!oldSnap.empty) {
          const od = oldSnap.docs[0];
          const revert = oldTx.TxType === "in" ? -toNumber(oldTx.Quantity, 0) : toNumber(oldTx.Quantity, 0);
          batch.update(od.ref, { Stock: Math.max(0, toNumber(od.data().Stock, 0) + revert), updatedAt: serverTimestamp() });
        }
        if (!newSnap.empty) {
          const nd = newSnap.docs[0];
          const apply = newTxType === "in" ? qty : -qty;
          batch.update(nd.ref, { Stock: Math.max(0, toNumber(nd.data().Stock, 0) + apply), updatedAt: serverTimestamp() });
        }
      }

      await batch.commit();
      const idx = TX.findIndex((x) => String(x.id) === String(editingTxId));
      if (idx >= 0) TX[idx] = { ...TX[idx], ...updatePayload };

      STOCK = (await loadCollection("stock")).map((s) => ({ ...s, Stock: toNumber(s.Stock, 0), TypeDevice: safeTrim(s.TypeDevice) }));
      $("cnt-stock").textContent = STOCK.length;
      buildAutocompleteSources();
      closeModal();
      showToast(`✓ Đã cập nhật: ${item}`, "success");
      render();

    } else {
      // ── ADD MODE ───────────────────────────────────────

      // Check stock availability for OUT transactions
      if (newTxType === "out") {
        const itemKey = keyOf(item);
        const stockSnap = await getDocs(query(collection(db, "stock"), where("itemKey", "==", itemKey)));
        const currentStock = stockSnap.empty ? 0 : toNumber(stockSnap.docs[0].data().Stock, 0);
        if (currentStock <= 0) {
          showToast(`⚠ "${item}" không có trong tồn kho (stock = 0). Không thể xuất.`, "error");
          $("btnSubmitTx").disabled = false;
          return;
        }
        if (qty > currentStock) {
          if (!confirm(`⚠ Tồn kho "${item}" chỉ còn ${currentStock}. Bạn đang xuất ${qty}.\nStock sẽ về 0. Tiếp tục?`)) {
            $("btnSubmitTx").disabled = false;
            return;
          }
        }
      }

      const txRef = doc(collection(db, "transactions"));
      const batch = writeBatch(db);

      const payload = {
        No: TX.length + 1,
        Item: item,
        itemKey: keyOf(item),
        Description: safeTrim($("fDesc").value),
        Date: date,
        TxType: newTxType,
        Quantity: qty,
        Unit: safeTrim($("fUnit").value) || "pcs",
        Assigned: safeTrim($("fAssigned").value),
        Status: safeTrim($("fStatus").value),
        SN: getTxSerials(),
        Remark: "",
        createdAt: serverTimestamp(),
        createdBy: currentUser?.uid || null,
      };
      batch.set(txRef, payload);

      const itemKey = keyOf(item);
      const stockSnap = await getDocs(query(collection(db, "stock"), where("itemKey", "==", itemKey)));
      const typeDevice = safeTrim($("fTypeDevice").value);

      if (!stockSnap.empty) {
        const stockDoc = stockSnap.docs[0];
        const sData = stockDoc.data();
        const next = Math.max(0, toNumber(sData.Stock, 0) + (newTxType === "in" ? qty : -qty));
        batch.update(stockDoc.ref, {
          Item: item, itemKey,
          TypeDevice: safeTrim(sData.TypeDevice) || typeDevice || "Other",
          Stock: next, updatedAt: serverTimestamp(),
        });
      } else if (newTxType === "in") {
        const sRef = doc(collection(db, "stock"));
        batch.set(sRef, {
          No: STOCK.length + 1, Item: item, itemKey,
          TypeDevice: typeDevice || "Other", Stock: qty,
          Note: "", SN: getTxSerials(),
          createdAt: serverTimestamp(), createdBy: currentUser?.uid || null,
        });
      }

      await batch.commit();
      TX.unshift({ id: txRef.id, ...payload, isNew: true });
      $("cnt-tx").textContent = TX.length;

      STOCK = (await loadCollection("stock")).map((s) => ({ ...s, Stock: toNumber(s.Stock, 0), TypeDevice: safeTrim(s.TypeDevice) }));
      $("cnt-stock").textContent = STOCK.length;
      buildAutocompleteSources();
      closeModal();
      showToast(`✓ Đã thêm: ${item} (${newTxType === "in" ? "+" : "-"}${qty} ${payload.Unit})`, "success");
      txFilter = "all";
      txPage = 1;
      showPage("transactions");
    }
  } catch (e) {
    showToast(`Lỗi lưu giao dịch: ${e?.message || e}`, "error");
  } finally {
    $("btnSubmitTx").disabled = false;
  }
}

// ── STOCK MODAL (FIRESTORE) ────────────────────────────────
let editingStockId = null;

function openStockModal(stockId) {
  if (!requireAuth("thêm/chỉnh sửa tồn kho")) return;
  editingStockId = stockId ?? null;
  const isEdit = editingStockId != null;

  $("stockModalTitle").textContent = isEdit ? "✎ Chỉnh sửa thiết bị" : "＋ Thêm thiết bị tồn kho";
  $("btnStockSubmit").textContent = isEdit ? "Cập nhật" : "Lưu thiết bị";
  $("sfReasonWrap").style.display = isEdit ? "block" : "none";

  if (isEdit) {
    const s = STOCK.find((x) => String(x.id) === String(editingStockId));
    if (!s) return;
    $("sfItem").value = safeTrim(s.Item);
    $("sfType").value = safeTrim(s.TypeDevice);
    $("sfStock").value = toNumber(s.Stock, 0);
    $("sfSN").value = safeTrim(s.SN);
    $("sfNote").value = safeTrim(s.Note);
    $("sfReason").value = "";
  } else {
    $("sfItem").value = "";
    $("sfType").value = "";
    $("sfStock").value = "1";
    $("sfSN").value = "";
    $("sfNote").value = "";
    $("sfReason").value = "";
  }

  $("stockModal").classList.add("open");
  setTimeout(() => $("sfItem").focus(), 150);
}

function closeStockModal() {
  $("stockModal").classList.remove("open");
  $("acTypeList").classList.remove("open");
  editingStockId = null;
}

function acTypeInput() {
  const q = keyOf($("sfType").value);
  const list = $("acTypeList");
  acTypeIndex = -1;
  if (!q) {
    list.classList.remove("open");
    return;
  }
  const matches = AC_TYPES.filter((t) => keyOf(t).includes(q)).slice(0, 10);
  if (!matches.length) {
    list.classList.remove("open");
    return;
  }
  list.innerHTML = matches.map((m) => `<div class="autocomplete-item" onmousedown="acTypeSelect('${m.replace(/'/g, "\\'")}')">${m}</div>`).join("");
  list.classList.add("open");
}

function acTypeSelect(val) {
  $("sfType").value = val;
  $("acTypeList").classList.remove("open");
  $("sfStock").focus();
}

function acTypeKey(e) {
  const list = $("acTypeList");
  const items = list.querySelectorAll(".autocomplete-item");
  if (!list.classList.contains("open")) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    acTypeIndex = Math.min(acTypeIndex + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle("focused", i === acTypeIndex));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    acTypeIndex = Math.max(acTypeIndex - 1, -1);
    items.forEach((el, i) => el.classList.toggle("focused", i === acTypeIndex));
  } else if (e.key === "Enter" && acTypeIndex >= 0) {
    e.preventDefault();
    items[acTypeIndex].dispatchEvent(new MouseEvent("mousedown"));
  } else if (e.key === "Escape") list.classList.remove("open");
}

window.acTypeInput = acTypeInput;
window.acTypeSelect = acTypeSelect;
window.acTypeKey = acTypeKey;

async function submitStock() {
  if (!requireAuth("lưu tồn kho")) return;
  const item = safeTrim($("sfItem").value);
  const type = safeTrim($("sfType").value);
  const stock = toNumber($("sfStock").value, NaN);
  if (!item || !type || !Number.isFinite(stock) || stock < 0) {
    showToast("Vui lòng điền đầy đủ thông tin bắt buộc.", "error");
    return;
  }

  const itemKey = keyOf(item);
  const note = safeTrim($("sfNote").value);
  const sn = safeTrim($("sfSN").value);

  try {
    $("btnStockSubmit").disabled = true;

    if (editingStockId != null) {
      const s = STOCK.find((x) => String(x.id) === String(editingStockId));
      if (!s) throw new Error("Không tìm thấy item để cập nhật.");
      const ref = doc(db, "stock", String(editingStockId));
      const batch = writeBatch(db);
      batch.update(ref, {
        Item: item,
        itemKey,
        TypeDevice: type,
        Stock: stock,
        Note: note,
        SN: sn,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      s.Item = item;
      s.itemKey = itemKey;
      s.TypeDevice = type;
      s.Stock = stock;
      s.Note = note;
      s.SN = sn;
      showToast(`✓ Đã cập nhật: ${item}`, "success");
    } else {
      const exists = await getDocs(query(collection(db, "stock"), where("itemKey", "==", itemKey)));
      if (!exists.empty) {
        showToast(`⚠ "${item}" đã tồn tại trong kho. Hãy chỉnh sửa item đó.`, "error");
        return;
      }
      const ref = doc(collection(db, "stock"));
      const batch = writeBatch(db);
      batch.set(ref, {
        No: STOCK.length + 1,
        Item: item,
        itemKey,
        TypeDevice: type,
        Stock: stock,
        Note: note,
        SN: sn,
        createdAt: serverTimestamp(),
        createdBy: currentUser?.uid || null,
      });
      await batch.commit();
      STOCK.push({ id: ref.id, Item: item, itemKey, TypeDevice: type, Stock: stock, Note: note, SN: sn, isNew: true });
      $("cnt-stock").textContent = STOCK.length;
      showToast(`✓ Đã thêm: ${item} (${stock} units)`, "success");
    }

    if (!AC_TYPES.includes(type)) AC_TYPES.push(type);
    buildAutocompleteSources();

    closeStockModal();
    render();
  } catch (e) {
    showToast(`Lỗi lưu tồn kho: ${e?.message || e}`, "error");
  } finally {
    $("btnStockSubmit").disabled = false;
  }
}

async function deleteStock(id) {
  if (!requireAuth("xóa item tồn kho", "admin")) return;
  const s = STOCK.find((x) => String(x.id) === String(id));
  if (!s) return;
  if (!confirm(`Xoá "${safeTrim(s.Item)}" khỏi tồn kho?`)) return;
  try {
    await deleteDoc(doc(db, "stock", String(id)));
    STOCK = STOCK.filter((x) => String(x.id) !== String(id));
    $("cnt-stock").textContent = STOCK.length;
    buildAutocompleteSources();
    showToast(`Đã xoá: ${safeTrim(s.Item)}`, "success");
    render();
  } catch (e) {
    showToast(`Lỗi xóa: ${e?.message || e}`, "error");
  }
}

async function quickAdjust(id, delta) {
  if (!requireAuth("cập nhật tồn kho")) return;
  const s = STOCK.find((x) => String(x.id) === String(id));
  if (!s) return;
  const newVal = Math.max(0, toNumber(s.Stock, 0) + delta);
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "stock", String(id)), { Stock: newVal, updatedAt: serverTimestamp() });
    await batch.commit();
    s.Stock = newVal;
    showToast(`${safeTrim(s.Item)}: ${delta > 0 ? "+1 →" : "-1 →"} ${newVal} units`, "success");
    render();
  } catch (e) {
    showToast(`Lỗi cập nhật: ${e?.message || e}`, "error");
  }
}

window.submitStock = submitStock;

// ── EVENTS WIRING ─────────────────────────────────────────
function wireEvents() {
  // Sidebar navigation
  document.querySelectorAll(".nav-item[data-page]").forEach((el) => {
    el.addEventListener("click", () => showPage(el.dataset.page));
  });

  // Search
  $("globalSearch").addEventListener("input", onSearch);

  // Floating button / shortcuts
  $("fabAddTx").addEventListener("click", () => openModal());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeStockModal();
      closeOfficeModal();
      closeWarehouseModal();
      closeAuthModal();
    }
    if (e.key.toLowerCase() === "n" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      openModal();
    }
  });

  // Close autocomplete on outside click
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-wrap")) {
      document.querySelectorAll(".autocomplete-list").forEach((l) => l.classList.remove("open"));
    }
  });

  // Tx modal buttons
  $("btnCloseTx").addEventListener("click", closeModal);
  $("btnCancelTx").addEventListener("click", closeModal);
  $("btnIn").addEventListener("click", () => setTxType("in"));
  $("btnOut").addEventListener("click", () => setTxType("out"));
  $("btnSubmitTx").addEventListener("click", submitTransaction);
  $("txModal").addEventListener("click", (e) => {
    if (e.target === $("txModal")) closeModal();
  });

  // Stock modal buttons
  $("btnCloseStock").addEventListener("click", closeStockModal);
  $("btnCancelStock").addEventListener("click", closeStockModal);
  $("btnStockSubmit").addEventListener("click", submitStock);
  $("stockModal").addEventListener("click", (e) => {
    if (e.target === $("stockModal")) closeStockModal();
  });

  // Office modal buttons
  $("btnCloseOffice").addEventListener("click", closeOfficeModal);
  $("btnCancelOffice").addEventListener("click", closeOfficeModal);
  $("btnSubmitOffice").addEventListener("click", submitOffice);
  $("officeModal").addEventListener("click", (e) => {
    if (e.target === $("officeModal")) closeOfficeModal();
  });

  // Store modal buttons
  $("btnCloseStore").addEventListener("click", closeStoreModal);
  $("btnCancelStore").addEventListener("click", closeStoreModal);
  $("btnSubmitStore").addEventListener("click", submitStore);
  $("storeModal").addEventListener("click", (e) => {
    if (e.target === $("storeModal")) closeStoreModal();
  });

  // Warehouse modal buttons
  $("btnCloseWarehouse").addEventListener("click", closeWarehouseModal);
  $("btnCancelWarehouse").addEventListener("click", closeWarehouseModal);
  $("btnSubmitWarehouse").addEventListener("click", submitWarehouse);
  $("warehouseModal").addEventListener("click", (e) => {
    if (e.target === $("warehouseModal")) closeWarehouseModal();
  });

  // Auth modal buttons
  $("btnOpenAuth").addEventListener("click", openAuthModal);
  $("btnCloseAuth").addEventListener("click", closeAuthModal);
  $("btnAuthCancel").addEventListener("click", closeAuthModal);
  $("btnAuthSignIn").addEventListener("click", doSignIn);
  $("btnSignOut").addEventListener("click", doSignOut);
  $("authModal").addEventListener("click", (e) => {
    if (e.target === $("authModal")) closeAuthModal();
  });

  $("authPassInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSignIn();
  });

  // Autocomplete bindings
  $("fQty").addEventListener("input", () => updateTxSerialFields($("fQty").value));
  $("fItem").addEventListener("input", acInput);
  $("fItem").addEventListener("keydown", acKey);
  $("fAssigned").addEventListener("input", acAssignedInput);
  $("fAssigned").addEventListener("keydown", acAssignedKey);
  $("sfType").addEventListener("input", acTypeInput);
  $("sfType").addEventListener("keydown", acTypeKey);
}

// ── INACTIVITY AUTO-LOGOUT ────────────────────────────────
const IDLE_MS = 30 * 60 * 1000; // 30 minutes
let _idleTimer = null;

function _resetIdleTimer() {
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(async () => {
    showToast("Phiên làm việc hết hạn do không hoạt động.", "info");
    await signOut(auth);
  }, IDLE_MS);
}

function startInactivityTimer() {
  ["mousemove", "keydown", "click", "touchstart", "scroll"].forEach((ev) =>
    document.addEventListener(ev, _resetIdleTimer, { passive: true })
  );
  _resetIdleTimer();
}

function stopInactivityTimer() {
  clearTimeout(_idleTimer);
  _idleTimer = null;
  ["mousemove", "keydown", "click", "touchstart", "scroll"].forEach((ev) =>
    document.removeEventListener(ev, _resetIdleTimer)
  );
}

// ── INIT ──────────────────────────────────────────────────
wireEvents();

let _prevAuthUser = undefined; // undefined = first call not yet received
onAuthStateChanged(auth, async (user) => {
  const wasLoggedIn = _prevAuthUser !== undefined && _prevAuthUser !== null;
  _prevAuthUser = user || null;
  currentUser = user || null;
  if (user) {
    await loadUserRole(user);
    startInactivityTimer();
    refreshAuthUI();
    // Reload data with correct permissions, redirect viewer
    await loadAll();
    if (isViewer()) showPage("transactions");
  } else {
    currentRole = null;
    stopInactivityTimer();
    refreshAuthUI();
    if (wasLoggedIn) {
      if (typeof window.showIntroScreen === "function") {
        window.showIntroScreen();
      }
    }
  }
});

// Initial data load
loadAll();

