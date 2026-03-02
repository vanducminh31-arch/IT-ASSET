import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  doc,
  writeBatch,
  serverTimestamp,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// ── FIREBASE INIT ──────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ── STATE ──────────────────────────────────────────────────
let currentUser = null;
let editModeEnabled = false;
let currentEditSection = null;
let editModeTimeoutId = null;
const EDIT_PASSWORD = "Minhtom1@";

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

function requireAuth(actionLabel = "thao tác này") {
  if (currentUser) return true;
  showToast(`Vui lòng đăng nhập để ${actionLabel}.`, "error");
  openAuthModal();
  return false;
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
  $("authEmail").textContent = email;
  $("btnOpenAuth").style.display = currentUser ? "none" : "inline-flex";
  $("btnSignOut").style.display = currentUser ? "inline-flex" : "none";
  $("btnToggleEditMode").style.display = currentUser ? "block" : "none";
}

function refreshEditModeUI() {
  const btn = $("btnToggleEditMode");
  if (!btn) return;
  if (editModeEnabled) {
    btn.textContent = "🔓 Chế độ Pro (Đang bật)";
    btn.style.color = "var(--accent)";
    btn.style.borderColor = "var(--accent)";
  } else {
    btn.textContent = "🔒 Mở chế độ Pro";
    btn.style.color = "var(--muted)";
    btn.style.borderColor = "var(--border)";
  }
}

function handleToggleEditMode() {
  if (editModeEnabled) {
    editModeEnabled = false;
    document.body.classList.remove("edit-mode-enabled");
    clearTimeout(editModeTimeoutId);
    editModeTimeoutId = null;
    refreshEditModeUI();
    showToast("ℹ Đã tắt chế độ chỉnh sửa Pro", "info");
  } else {
    openEditPassword(null);
  }
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
  // Protected pages that require authentication
  const protectedPages = ['transactions', 'stock', 'stores', 'offices', 'warehouses'];
  
  if (protectedPages.includes(page) && !currentUser) {
    showToast('Vui lòng đăng nhập để xem trang này.', 'error');
    openAuthModal();
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
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadAll() {
  $("main").innerHTML = `<div class="empty"><div class="e-icon">⟳</div>Đang tải dữ liệu...</div>`;
  try {
    const [tx, stock, pc, stores, offices, warehouses] = await Promise.all([
      loadCollection("transactions"),
      loadCollection("stock"),
      loadCollection("minipc"),
      loadCollection("stores"),
      loadCollection("offices"),
      loadCollection("warehouses"),
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

function getSerialList(sn) {
  if (!sn) return [];
  if (Array.isArray(sn)) {
    return sn.filter(s => safeTrim(s));
  }
  return String(sn).split('\n').map(s => safeTrim(s)).filter(s => s);
}

function renderSerialDisplay(sn) {
  const serials = getSerialList(sn);
  if (serials.length === 0) return "";
  
  const displayCount = Math.min(3, serials.length);
  const html = serials.slice(0, displayCount).map(s => 
    `<div style="font-family:'IBM Plex Mono',monospace;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s}</div>`
  ).join("");
  
  return `<div style="margin-top:4px;font-size:10px;color:var(--muted)">
    <strong>${serials.length} serial${serials.length !== 1 ? 's' : ''}:</strong>
    ${html}
    ${serials.length > 3 ? `<div style="margin-top:2px;color:var(--dim)">...</div>` : ""}
  </div>`;
}

function statusBadge(st) {
  const s = (st || "").toLowerCase().trim();
  if (s.includes("still use") || s.includes("new")) return `<span class="badge-status s-active">${st || "—"}</span>`;
  if (s.includes("broken")) return `<span class="badge-status s-broken">${st}</span>`;
  if (s.includes("old")) return `<span class="badge-status s-old">${st}</span>`;
  if (s.includes("none") || s.includes("liquidation")) return `<span class="badge-status s-none">${st}</span>`;
  return st ? `<span class="badge-status s-old">${st}</span>` : '<span style="color:var(--dim)">—</span>';
}

function render() {
  // Protected pages that require authentication
  const protectedPages = ['transactions', 'stock', 'stores', 'offices', 'warehouses'];
  
  // Show login message for protected pages if not authenticated
  if (protectedPages.includes(currentPage) && !currentUser) {
    $('main').innerHTML = `<div class="empty"><div class="e-icon">🔒</div>Vui lòng đăng nhập để xem nội dung này.<div style="margin-top:16px"><button class="btn-primary" onclick="openAuthModal()">Đăng nhập</button></div></div>`;
    return;
  }
  
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
                <td class="mono" style="color:var(--muted);font-size:11px">${safeTrim(t.Date) || "—"}</td>
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
  let list = TX
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

  // Separate IN and OUT transactions
  const inList = list.filter(t => t.TxType === "in");
  const outList = list.filter(t => t.TxType === "out");
  const total = list.length;

  const renderTable = (txList, typeLabel, typeKey) => {
    if (txList.length === 0) return "";
    
    return `
      <div style="margin-bottom:32px">
        <div style="font-size:14px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <span style="color:var(--${typeKey === 'in' ? 'in' : 'out'})">${typeLabel}</span>
          <span style="font-size:12px;color:var(--muted);font-weight:400">• ${txList.length} giao dịch</span>
        </div>
        <div class="table-wrap">
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Thiết bị</th>
                  <th>SL</th>
                  <th>Giao cho</th>
                  <th>Trạng thái</th>
                  <th>Serial / S/N</th>
                  <th>Ngày</th>
                </tr>
              </thead>
              <tbody>
                ${txList.map((t) => `
                <tr>
                  <td class="mono" style="color:var(--dim);font-size:11px">${t.No || ""}</td>
                  <td>
                    <div style="font-weight:500">${hl(safeTrim(t.Item), q)}</div>
                    ${t.Description ? `<div style="font-size:11px;color:var(--dim);margin-top:1px">${hl(safeTrim(t.Description), q)}</div>` : ""}
                  </td>
                  <td class="mono" style="font-size:15px;font-weight:600;color:${t.TxType === "in" ? "var(--in)" : "var(--out)"}">${toNumber(t.Quantity, 0)}</td>
                  <td style="font-size:12px;color:var(--muted)">${hl(safeTrim(t.Assigned), q) || "—"}</td>
                  <td>${statusBadge(t.Status)}</td>
                  <td class="mono" style="font-size:11px;color:var(--dim);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${Array.isArray(t.SN) ? t.SN.join(', ') : safeTrim(t.SN)}">${hl(Array.isArray(t.SN) ? t.SN.slice(0, 2).join(', ') + (t.SN.length > 2 ? '...' : '') : safeTrim(t.SN), q) || "—"}</td>
                  <td class="mono" style="font-size:11px;color:var(--muted);white-space:nowrap">${safeTrim(t.Date) || "—"}</td>
                </tr>
              `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  };

  $("main").innerHTML = `
    <div class="page-header">
      <div class="page-title">Giao dịch thiết bị</div>
      <div class="page-sub">${total} giao dịch • ${TX.filter((t) => t.TxType === "in").length} nhập, ${TX.filter((t) => t.TxType === "out").length} xuất</div>
    </div>

    <div class="filters">
      <button class="filter-btn ${txFilter === "all" ? "active" : ""}" onclick="setTxFilter('all')">Tất cả (${TX.length})</button>
      <button class="filter-btn ${txFilter === "in" ? "active" : ""}" onclick="setTxFilter('in')">↑ Nhập (${TX.filter((t) => t.TxType === "in").length})</button>
      <button class="filter-btn ${txFilter === "out" ? "active" : ""}" onclick="setTxFilter('out')">↓ Xuất (${TX.filter((t) => t.TxType === "out").length})</button>
      <button class="filter-btn ${txFilter === "broken" ? "active" : ""}" onclick="setTxFilter('broken')">⚠ Hỏng</button>
      <div class="filter-right">
        <span style="font-size:12px;color:var(--muted)">Tổng ${total}</span>
        <button class="btn-ghost-green" onclick="openModal()">＋ Thêm giao dịch</button>
      </div>
    </div>

    ${(txFilter === "all" || txFilter === "in") && inList.length > 0 ? `
      <div style="margin-bottom:24px">
        <div style="font-size:15px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:6px">
          <span style="color:var(--in)">↑ NHẬP VÀO (IN)</span>
          <span style="font-size:12px;color:var(--muted);font-weight:400">${inList.length} giao dịch</span>
        </div>
        <div class="table-wrap">
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Thiết bị</th>
                  <th>SL</th>
                  <th>Giao cho</th>
                  <th>Trạng thái</th>
                  <th>Serial / S/N</th>
                  <th>Ngày</th>
                </tr>
              </thead>
              <tbody>
                ${inList.map((t) => `
                <tr>
                  <td class="mono" style="color:var(--dim);font-size:11px">${t.No || ""}</td>
                  <td>
                    <div style="font-weight:500">${hl(safeTrim(t.Item), q)}</div>
                    ${t.Description ? `<div style="font-size:11px;color:var(--dim);margin-top:1px">${hl(safeTrim(t.Description), q)}</div>` : ""}
                  </td>
                  <td class="mono" style="font-size:15px;font-weight:600;color:var(--in)">${toNumber(t.Quantity, 0)}</td>
                  <td style="font-size:12px;color:var(--muted)">${hl(safeTrim(t.Assigned), q) || "—"}</td>
                  <td>${statusBadge(t.Status)}</td>
                  <td class="mono" style="font-size:11px;color:var(--dim);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${Array.isArray(t.SN) ? t.SN.join(', ') : safeTrim(t.SN)}">${hl(Array.isArray(t.SN) ? t.SN.slice(0, 2).join(', ') + (t.SN.length > 2 ? '...' : '') : safeTrim(t.SN), q) || "—"}</td>
                  <td class="mono" style="font-size:11px;color:var(--muted);white-space:nowrap">${safeTrim(t.Date) || "—"}</td>
                </tr>
              `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    ` : ""}

    ${(txFilter === "all" || txFilter === "out") && outList.length > 0 ? `
      <div style="margin-bottom:24px">
        <div style="font-size:15px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:6px">
          <span style="color:var(--out)">↓ XUẤT RA (OUT)</span>
          <span style="font-size:12px;color:var(--muted);font-weight:400">${outList.length} giao dịch</span>
        </div>
        <div class="table-wrap">
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Thiết bị</th>
                  <th>SL</th>
                  <th>Giao cho</th>
                  <th>Trạng thái</th>
                  <th>Serial / S/N</th>
                  <th>Ngày</th>
                </tr>
              </thead>
              <tbody>
                ${outList.map((t) => `
                <tr>
                  <td class="mono" style="color:var(--dim);font-size:11px">${t.No || ""}</td>
                  <td>
                    <div style="font-weight:500">${hl(safeTrim(t.Item), q)}</div>
                    ${t.Description ? `<div style="font-size:11px;color:var(--dim);margin-top:1px">${hl(safeTrim(t.Description), q)}</div>` : ""}
                  </td>
                  <td class="mono" style="font-size:15px;font-weight:600;color:var(--out)">${toNumber(t.Quantity, 0)}</td>
                  <td style="font-size:12px;color:var(--muted)">${hl(safeTrim(t.Assigned), q) || "—"}</td>
                  <td>${statusBadge(t.Status)}</td>
                  <td class="mono" style="font-size:11px;color:var(--dim);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${Array.isArray(t.SN) ? t.SN.join(', ') : safeTrim(t.SN)}">${hl(Array.isArray(t.SN) ? t.SN.slice(0, 2).join(', ') + (t.SN.length > 2 ? '...' : '') : safeTrim(t.SN), q) || "—"}</td>
                  <td class="mono" style="font-size:11px;color:var(--muted);white-space:nowrap">${safeTrim(t.Date) || "—"}</td>
                </tr>
              `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    ` : ""}

    ${total === 0 ? `<div class="empty"><div class="e-icon">○</div>Không tìm thấy kết quả</div>` : ""}
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
      let serialStr = "";
      if (Array.isArray(s.SN)) {
        serialStr = s.SN.join(" ");
      } else if (s.SN) {
        serialStr = String(s.SN);
      }
      const hay = [s.Item, s.TypeDevice, s.Note, serialStr].join(" ").toLowerCase();
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
          ${renderSerialDisplay(s.SN)}
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
                  TX.filter((t) => safeTrim(t.Assigned).includes(code) && t.TxType === "out").map((t) => safeTrim(t.Item))
                ),
              ].filter(Boolean);
              return `
                <div class="store-card store-card-clickable" onclick="renderStoreDetail('${code.replace(/'/g, "\\'")}')">
                  <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                    <div class="sc-code">${hl(code, q)}</div>
                    ${safeTrim(s.O2O || s.o2o) ? `<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(63,185,80,.1);color:var(--in);border:1px solid rgba(63,185,80,.2)">O2O</span>` : ""}
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

  const storeTx = TX.filter((t) => safeTrim(t.Assigned).includes(storeCode));
  const outTx = storeTx.filter((t) => t.TxType === "out");
  const inTx = storeTx.filter((t) => t.TxType === "in");

  const deviceMap = {};
  outTx.forEach((t) => {
    const key = safeTrim(t.Item);
    if (!key) return;
    if (!deviceMap[key]) deviceMap[key] = { item: key, qty: 0, sn: new Set(), assigned: new Set(), lastDate: "" };
    deviceMap[key].qty += toNumber(t.Quantity, 0);
    safeTrim(t.SN)
      .split("\n")
      .forEach((s) => s.trim() && deviceMap[key].sn.add(s.trim()));
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
            ${safeTrim(store.O2O || store.o2o) ? `<span style="font-size:11px;padding:2px 8px;border-radius:3px;background:rgba(63,185,80,.1);color:var(--in);border:1px solid rgba(63,185,80,.2)">O2O</span>` : ""}
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
                  <td style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--dim);max-width:180px">
                    ${d.sn.size ? [...d.sn].slice(0, 3).join("<br>") + (d.sn.size > 3 ? `<br><span style="color:var(--accent)">+${d.sn.size - 3} more</span>` : "") : "—"}
                  </td>
                  <td style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)">${d.lastDate || "—"}</td>
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
                  <td class="mono" style="font-size:11px;color:var(--muted);white-space:nowrap">${safeTrim(t.Date) || "—"}</td>
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

// ── OFFICES / WAREHOUSES ──────────────────────────────────
function renderOffices() {
  const cards = OFFICES.map((o) => {
    const code = safeTrim(o.code || o.Code || o["Office code"]);
    const deviceCount = TX.filter((t) => t.TxType === "out" && safeTrim(t.Assigned).includes(code)).length;
    return `
      <div class="store-card store-card-clickable" onclick="renderOfficeDetail('${code.replace(/'/g, "\\'")}')">
        <div class="sc-code">${code}</div>
        <div class="sc-name">${safeTrim(o.name || o.Name || o["Office name"])}</div>
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
  const assigned = TX.filter((t) => t.TxType === "out" && safeTrim(t.Assigned).includes(code));

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
                <td class="mono" style="font-size:11px;color:var(--muted)">${safeTrim(t.Date) || "—"}</td>
                <td style="font-weight:500">${safeTrim(t.Item)}</td>
                <td style="font-size:11px;color:var(--dim)">${safeTrim(t.Description) || "—"}</td>
                <td class="mono" style="font-weight:600">${toNumber(t.Quantity,0)} ${safeTrim(t.Unit)||""}</td>
                <td class="mono" style="font-size:11px;color:var(--dim)">${safeTrim(t.SN) || "—"}</td>
                <td>${statusBadge(t.Status)}</td>
              </tr>
            `).join("") : `<tr><td colspan="6"><div class="empty"><div class="e-icon">○</div>Không có thiết bị nào</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function openOfficeModal() {
  if (!requireAuth("thêm văn phòng")) return;
  const code = prompt("Mã văn phòng (vd: OFF-HCM):");
  if (!code) return;
  const name = prompt("Tên văn phòng:") || "";
  if (!name.trim()) return;
  const location = prompt("Địa chỉ:") || "";
  const incharge = prompt("Người phụ trách:") || "";

  try {
    const batch = writeBatch(db);
    const ref = doc(collection(db, "offices"));
    batch.set(ref, { code: code.trim(), name: name.trim(), location, incharge, createdAt: serverTimestamp() });
    await batch.commit();
    OFFICES.push({ id: ref.id, code: code.trim(), name: name.trim(), location, incharge });
    $("cnt-offices").textContent = OFFICES.length;
    showToast(`✓ Đã thêm văn phòng: ${name.trim()}`, "success");
    render();
  } catch (e) {
    showToast(`Lỗi: ${e?.message || e}`, "error");
  }
}

function renderWarehouses() {
  const cards = WAREHOUSES.map((w) => {
    const code = safeTrim(w.code || w.Code || w["Warehouse code"]);
    const deviceCount = TX.filter((t) => t.TxType === "out" && safeTrim(t.Assigned).includes(code)).length;
    return `
      <div class="store-card store-card-clickable" onclick="renderWarehouseDetail('${code.replace(/'/g, "\\'")}')">
        <div class="sc-code">${code}</div>
        <div class="sc-name">${safeTrim(w.name || w.Name || w["Warehouse name"])}</div>
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
  const assigned = TX.filter((t) => t.TxType === "out" && safeTrim(t.Assigned).includes(code));

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
          <thead><tr><th>Ngày</th><th>Thiết bị</th><th>Mô tả</th><th>SL</th><th>Serial</th><th>Trạng thái</th></tr></thead>
          <tbody>
            ${assigned.length ? assigned.sort((a,b)=>safeTrim(b.Date).localeCompare(safeTrim(a.Date))).map((t) => `
              <tr>
                <td class="mono" style="font-size:11px;color:var(--muted)">${safeTrim(t.Date) || "—"}</td>
                <td style="font-weight:500">${safeTrim(t.Item)}</td>
                <td style="font-size:11px;color:var(--dim)">${safeTrim(t.Description) || "—"}</td>
                <td class="mono" style="font-weight:600">${toNumber(t.Quantity,0)} ${safeTrim(t.Unit)||""}</td>
                <td class="mono" style="font-size:11px;color:var(--dim)">${safeTrim(t.SN) || "—"}</td>
                <td>${statusBadge(t.Status)}</td>
              </tr>
            `).join("") : `<tr><td colspan="6"><div class="empty"><div class="e-icon">○</div>Không có thiết bị nào</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function openWarehouseModal() {
  if (!requireAuth("thêm kho")) return;
  const code = prompt("Mã kho (vd: WH-SGN):");
  if (!code) return;
  const name = prompt("Tên kho:") || "";
  if (!name.trim()) return;
  const location = prompt("Địa chỉ:") || "";
  const incharge = prompt("Người phụ trách:") || "";

  try {
    const batch = writeBatch(db);
    const ref = doc(collection(db, "warehouses"));
    batch.set(ref, { code: code.trim(), name: name.trim(), location, incharge, createdAt: serverTimestamp() });
    await batch.commit();
    WAREHOUSES.push({ id: ref.id, code: code.trim(), name: name.trim(), location, incharge });
    $("cnt-warehouses").textContent = WAREHOUSES.length;
    showToast(`✓ Đã thêm kho: ${name.trim()}`, "success");
    render();
  } catch (e) {
    showToast(`Lỗi: ${e?.message || e}`, "error");
  }
}

window.renderOfficeDetail = renderOfficeDetail;
window.openOfficeModal = openOfficeModal;
window.renderWarehouseDetail = renderWarehouseDetail;
window.openWarehouseModal = openWarehouseModal;

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

function openModal(prefillType) {
  if (!requireAuth("thêm giao dịch")) return;
  if (prefillType) setTxType(prefillType);

  $("fDate").value = new Date().toISOString().split("T")[0];
  ["fItem", "fTypeDevice", "fAssigned", "fDesc"].forEach((id) => ($(id).value = ""));
  $("fQty").value = 1;
  $("fStatus").value = "";
  $("fSNWrapper").innerHTML = "";
  updateTxSerialFields();
  $("txModal").classList.add("open");
  setTimeout(() => $("fItem").focus(), 150);
}

function closeModal() {
  $("txModal").classList.remove("open");
  $("acList").classList.remove("open");
  $("acAssignedList").classList.remove("open");
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
  // gather serials from individual inputs
  const serials = Array.from($("fSNWrapper").querySelectorAll("input"))
    .map(i => safeTrim(i.value))
    .filter(s => s);

  if (!item || qty <= 0 || !date) {
    showToast("Vui lòng điền đầy đủ thông tin bắt buộc.", "error");
    return;
  }

  // Validate serials count matches quantity
  if (serials.length !== qty) {
    showToast(`⚠ Số serial (${serials.length}) phải bằng số lượng (${qty}). Vui lòng điền đủ serial tương ứng.`, "error");
    return;
  }

  // Check if item exists in stock
  const itemKey = keyOf(item);
  const stockSnap = await getDocs(query(collection(db, "stock"), where("itemKey", "==", itemKey)));
  
  if (stockSnap.empty) {
    showToast(`⚠ Thiết bị "${item}" không tồn tại trong kho. Vui lòng thêm vào tồn kho trước.`, "error");
    return;
  }

  const txRef = doc(collection(db, "transactions"));
  const batch = writeBatch(db);

  const payload = {
    No: TX.length + 1,
    Item: item,
    itemKey: itemKey,
    Description: safeTrim($("fDesc").value),
    Date: date,
    TxType: newTxType,
    Quantity: qty,
    Unit: safeTrim($("fUnit").value) || "pcs",
    Assigned: safeTrim($("fAssigned").value),
    Status: safeTrim($("fStatus").value),
    SN: serials,
    Remark: "",
    createdAt: serverTimestamp(),
    createdBy: currentUser?.uid || null,
  };
  batch.set(txRef, payload);

  // Update stock
  const stockDoc = stockSnap.docs[0];
  const sData = stockDoc.data();
  const oldStock = toNumber(sData.Stock, 0);
  const next = Math.max(0, oldStock + (newTxType === "in" ? qty : -qty));
  batch.update(stockDoc.ref, {
    Item: item,
    itemKey,
    TypeDevice: safeTrim(sData.TypeDevice),
    Stock: next,
    updatedAt: serverTimestamp(),
  });

  try {
    $("btnSubmitTx").disabled = true;
    await batch.commit();

    TX.unshift({ id: txRef.id, ...payload, isNew: true });
    $("cnt-tx").textContent = TX.length;

    // Reload stock list (so UI reflects exact persisted value)
    STOCK = (await loadCollection("stock")).map((s) => ({ ...s, Stock: toNumber(s.Stock, 0), TypeDevice: safeTrim(s.TypeDevice) }));
    $("cnt-stock").textContent = STOCK.length;
    buildAutocompleteSources();

    closeModal();
    showToast(`✓ Đã thêm: ${item} (${newTxType === "in" ? "+" : "-"}${qty} ${payload.Unit})`, "success");
    txFilter = "all";
    txPage = 1;
    showPage("transactions");
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
    
    // Handle SN - can be array or string
    let serials = [];
    if (Array.isArray(s.SN)) {
      serials = s.SN;
    } else if (s.SN) {
      serials = String(s.SN).split('\n').filter(x => x.trim());
    }
    $("sfSN").value = serials.join('\n');
    updateSerialCount();
    
    $("sfStock").value = toNumber(s.Stock, 0);
    $("sfNote").value = safeTrim(s.Note);
    $("sfReason").value = "";
  } else {
    $("sfItem").value = "";
    $("sfType").value = "";
    $("sfStock").value = "1";
    $("sfSN").value = "";
    $("sfNote").value = "";
    $("sfReason").value = "";
    updateSerialCount();
  }

  $("stockModal").classList.add("open");
  setTimeout(() => $("sfItem").focus(), 150);
}

function closeStockModal() {
  $("stockModal").classList.remove("open");
  $("acTypeList").classList.remove("open");
  editingStockId = null;
}

function updateSerialCount() {
  const sns = $("sfSN").value.split('\n').filter(x => x.trim()).length;
  $("sfSNCount").textContent = `${sns} serial${sns !== 1 ? 's' : ''}`;
  $("sfStock").value = Math.max(1, sns || 1);
}

function updateTxSerialCount() {
  // count boxes inside wrapper
  const count = $("fSNWrapper").querySelectorAll("input").length;
  $("fSNCount").textContent = `${count} serial${count !== 1 ? 's' : ''}`;
}

function updateTxSerialFields() {
  const qty = toNumber($("fQty").value, 0);
  const container = $("fSNWrapper");
  const existing = Array.from(container.querySelectorAll("input")).map(i => i.value);
  container.innerHTML = "";
  for (let i = 0; i < qty; i++) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "field-input";
    inp.placeholder = "VD: SN123456";
    inp.value = existing[i] || "";
    inp.addEventListener("input", updateTxSerialCount);
    container.appendChild(inp);
  }
  updateTxSerialCount();
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
  
  // Parse serial list
  const serialInputs = $("sfSN").value.split('\n').map(s => safeTrim(s)).filter(s => s);
  const stock = Math.max(serialInputs.length || 1, 1);
  
  if (!item || !type) {
    showToast("Vui lòng điền đầy đủ thông tin bắt buộc.", "error");
    return;
  }

  const itemKey = keyOf(item);
  const note = safeTrim($("sfNote").value);

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
        SN: serialInputs,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      s.Item = item;
      s.itemKey = itemKey;
      s.TypeDevice = type;
      s.Stock = stock;
      s.Note = note;
      s.SN = serialInputs;
      showToast(`✓ Đã cập nhật: ${item} (${stock} units)`, "success");
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
        SN: serialInputs,
        createdAt: serverTimestamp(),
        createdBy: currentUser?.uid || null,
      });
      await batch.commit();
      STOCK.push({ id: ref.id, Item: item, itemKey, TypeDevice: type, Stock: stock, Note: note, SN: serialInputs, isNew: true });
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
  if (!requireAuth("xóa item tồn kho")) return;
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
window.openAuthModal = openAuthModal;
window.openEditPassword = openEditPassword;
window.handleToggleEditMode = handleToggleEditMode;

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
  $("fItem").addEventListener("input", acInput);
  $("fItem").addEventListener("keydown", acKey);
  $("fAssigned").addEventListener("input", acAssignedInput);
  $("fAssigned").addEventListener("keydown", acAssignedKey);
  $("fQty").addEventListener("input", updateTxSerialFields);
  $("sfType").addEventListener("input", acTypeInput);
  $("sfType").addEventListener("keydown", acTypeKey);
  $("sfSN").addEventListener("input", updateSerialCount);

  // Edit Password Modal
  $("btnCloseEditPass").addEventListener("click", closeEditPasswordModal);
  $("btnCancelEditPass").addEventListener("click", closeEditPasswordModal);
  $("btnSubmitEditPass").addEventListener("click", submitEditPassword);
  $("editPassword").addEventListener("keypress", (e) => {
    if (e.key === "Enter") submitEditPassword();
  });
}

function openEditPassword(section) {
  if (editModeEnabled && section) {
    showPage(section);
    return;
  }
  currentEditSection = section;
  $("editPassword").value = "";
  $("editPassError").style.display = "none";
  $("editPassword").focus();
  $("editPasswordModal").classList.add("open");
}

function closeEditPasswordModal() {
  $("editPasswordModal").classList.remove("open");
  currentEditSection = null;
  $("editPassword").value = "";
  $("editPassError").style.display = "none";
}

function submitEditPassword() {
  const password = $("editPassword").value;
  if (password === EDIT_PASSWORD) {
    editModeEnabled = true;
    document.body.classList.add("edit-mode-enabled");
    closeEditPasswordModal();
    refreshEditModeUI();
    showToast("✓ Bạn đã mở chế độ chỉnh sửa Pro", "success");
    if (currentEditSection) {
      showPage(currentEditSection);
    }
    // After 30 minutes, disable edit mode
    clearTimeout(editModeTimeoutId);
    editModeTimeoutId = setTimeout(() => {
      editModeEnabled = false;
      editModeTimeoutId = null;
      document.body.classList.remove("edit-mode-enabled");
      refreshEditModeUI();
      showToast("ℹ Chế độ chỉnh sửa đã hết hạn", "info");
    }, 30 * 60 * 1000); // 30 minutes
  } else {
    $("editPassError").textContent = "Mật khẩu không đúng";
    $("editPassError").style.display = "block";
    $("editPassword").value = "";
  }
}

// ── INIT ──────────────────────────────────────────────────
wireEvents();

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;
  if (!currentUser && editModeEnabled) {
    editModeEnabled = false;
    clearTimeout(editModeTimeoutId);
    editModeTimeoutId = null;
    document.body.classList.remove("edit-mode-enabled");
  }
  refreshAuthUI();
  refreshEditModeUI();
  
  // Load data only after authentication state is determined
  if (currentUser) {
    loadAll();
  } else {
    // Show login prompt if not logged in
    $('main').innerHTML = `<div class="empty"><div class="e-icon">🔒</div>Vui lòng đăng nhập để xem dữ liệu chi tiết.<div style="margin-top:16px"><button class="btn-primary" onclick="openAuthModal()">Đăng nhập</button></div></div>`;
  }
});

