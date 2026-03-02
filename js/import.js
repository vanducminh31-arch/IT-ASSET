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
  doc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

let currentUser = null;
let selectedJson = null;

function log(line) {
  const el = $("log");
  el.textContent += (el.textContent ? "\n" : "") + line;
  el.scrollTop = el.scrollHeight;
}

function setAuthState(text, ok) {
  const el = $("authState");
  el.textContent = text;
  el.className = `pill ${ok ? "ok" : "bad"}`;
}

function keyOf(v) {
  return (v ?? "").toString().trim().toLowerCase();
}

function toNumber(n, fallback = 0) {
  const x = typeof n === "number" ? n : parseFloat(n);
  return Number.isFinite(x) ? x : fallback;
}

function normalizeTx(t) {
  const item = (t.Item ?? "").toString().trim();
  return {
    No: t.No ?? null,
    Item: item,
    itemKey: keyOf(item),
    Description: (t.Description ?? "").toString(),
    Date: (t.Date ?? "").toString(),
    TxType: (t.TxType ?? "").toString(),
    Quantity: toNumber(t.Quantity, 0),
    Unit: (t.Unit ?? "").toString(),
    Assigned: (t.Assigned ?? "").toString(),
    Status: (t.Status ?? "").toString(),
    SN: t.SN == null ? "" : String(t.SN),
    Remark: (t.Remark ?? "").toString(),
  };
}

function normalizeStock(s) {
  const item = (s.Item ?? "").toString().trim();
  return {
    No: s.No ?? null,
    Item: item,
    itemKey: keyOf(item),
    TypeDevice: (s.TypeDevice ?? "").toString().trim(),
    Stock: toNumber(s.Stock, 0),
    Note: (s.Note ?? "").toString(),
    SN: s.SN == null ? "" : String(s.SN),
  };
}

function normalizeStore(s) {
  const code = (s["Store code"] ?? s.store_code ?? "").toString().trim();
  const name = (s["Store name"] ?? s.store_name ?? "").toString().trim();
  return {
    ...s,
    store_code: code,
    store_name: name,
    storeKey: keyOf(code),
  };
}

function normalizeMinipc(p) {
  const code = (p["Asset Code"] ?? p.asset_code ?? "").toString().trim();
  return {
    ...p,
    asset_code: code,
    assetKey: keyOf(code),
  };
}

function normalizeOffice(o) {
  const code = (o.code ?? o["Office code"] ?? "").toString().trim();
  const name = (o.name ?? o["Office name"] ?? "").toString().trim();
  return { ...o, code, name, key: keyOf(code) };
}

function normalizeWarehouse(w) {
  const code = (w.code ?? w["Warehouse code"] ?? "").toString().trim();
  const name = (w.name ?? w["Warehouse name"] ?? "").toString().trim();
  return { ...w, code, name, key: keyOf(code) };
}

function validateRaw(raw) {
  if (!raw || typeof raw !== "object") throw new Error("JSON không hợp lệ (không phải object).");
  const tx = raw.transactions ?? raw.TX ?? [];
  const stock = raw.stock ?? raw.STOCK ?? [];
  const stores = raw.stores ?? raw.STORES ?? [];
  const minipc = raw.minipc ?? raw.PC ?? [];
  const offices = raw.offices ?? raw.OFFICES ?? [];
  const warehouses = raw.warehouses ?? raw.WAREHOUSES ?? [];

  if (!Array.isArray(tx)) throw new Error('"transactions" phải là array');
  if (!Array.isArray(stock)) throw new Error('"stock" phải là array');
  if (!Array.isArray(stores)) throw new Error('"stores" phải là array');
  if (!Array.isArray(minipc)) throw new Error('"minipc" phải là array');
  if (!Array.isArray(offices)) throw new Error('"offices" phải là array (nếu có)');
  if (!Array.isArray(warehouses)) throw new Error('"warehouses" phải là array (nếu có)');

  return { tx, stock, stores, minipc, offices, warehouses };
}

async function signInFlow() {
  const email = prompt("Email đăng nhập Firebase:");
  if (!email) return;
  const pass = prompt("Password:");
  if (!pass) return;
  try {
    await signInWithEmailAndPassword(auth, email.trim(), pass);
    log("✓ Đăng nhập OK");
  } catch (e) {
    log(`✗ Đăng nhập lỗi: ${e?.message || e}`);
  }
}

async function signOutFlow() {
  await signOut(auth);
  log("Đã đăng xuất");
}

function setButtonsEnabled(enabled) {
  $("btnImport").disabled = !enabled;
  $("btnDryRun").disabled = !enabled;
}

// ── EXCEL PARSER ──────────────────────────────────────────

// Detect if sheet rows look like a store device list
// (has "Hardware Type" or "Model" column, no "TxType" column)
function isStoreDeviceSheet(rows) {
  if (!rows.length) return false;
  const keys = Object.keys(rows[0]).map((k) => k.toLowerCase().trim());
  const hasDeviceCols = keys.some((k) => k.includes("hardware") || k.includes("model"));
  const hasTxCol = keys.some((k) => k === "txtype" || k === "tx type");
  return hasDeviceCols && !hasTxCol;
}

// Convert a store-device-sheet row into a transaction row
// storeCode = sheet name (e.g. "VA19"), date = import date
function storeRowToTx(row, storeCode, date) {
  // Flexible column reading
  const get = (...keys) => {
    for (const k of keys) {
      for (const rk of Object.keys(row)) {
        if (rk.toLowerCase().trim() === k.toLowerCase()) {
          const v = String(row[rk] ?? "").trim();
          if (v) return v;
        }
      }
    }
    return "";
  };
  const model        = get("model", "d", "device");
  const hardwareType = get("hardware type", "hardwaretype", "type", "c");
  const item         = model || hardwareType;
  const sn           = get("s/n", "sn", "serial", "serial number", "f");
  const qty          = parseFloat(get("qty", "quantity", "e")) || 1;
  const category     = get("category", "b");
  const no           = get("no", "a");
  return {
    No:          no,
    Item:        item,
    itemKey:     item.toLowerCase(),
    Description: hardwareType !== item ? hardwareType : category,
    Date:        date,
    TxType:      "out",
    Quantity:    qty,
    Unit:        "cái",
    Assigned:    storeCode,
    Status:      "Still use",
    SN:          sn,
    Remark:      category,
  };
}

function excelToRaw(workbook) {
  const SHEET_MAP = {
    transactions: ["transaction", "tx", "giao dich", "giao_dich"],
    stock:        ["stock", "ton kho", "ton_kho", "inventory"],
    stores:       ["store", "cua hang", "cua_hang", "shop"],
    minipc:       ["minipc", "mini pc", "pc", "computer", "may tinh"],
    offices:      ["office", "van phong", "van_phong"],
    warehouses:   ["warehouse", "kho", "kho hang"],
  };
  const result = { transactions: [], stock: [], stores: [], minipc: [], offices: [], warehouses: [] };
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error("SheetJS chưa tải xong, hãy thử lại.");

  // Use today as default transaction date
  const today = new Date();
  const defaultDate = `${String(today.getDate()).padStart(2,"0")}/${String(today.getMonth()+1).padStart(2,"0")}/${today.getFullYear()}`;

  workbook.SheetNames.forEach((sheetName) => {
    const lower = sheetName.toLowerCase().trim();
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
    let matched = false;

    // 1. Try matching known collection names
    for (const [col, aliases] of Object.entries(SHEET_MAP)) {
      if (aliases.some((a) => lower.includes(a))) {
        result[col].push(...rows);
        matched = true;
        log(`  Sheet "${sheetName}" → collection "${col}" (${rows.length} rows)`);
        break;
      }
    }

    if (!matched) {
      // 2. Detect store-device-list format (sheet name = store code)
      const dataRows = rows.filter((r) => {
        const no = String(Object.values(r)[0] ?? "").trim();
        return no !== "" && no.toLowerCase() !== "no";
      });

      if (dataRows.length > 0 && isStoreDeviceSheet(dataRows)) {
        const storeCode = sheetName.trim();
        const txRows = dataRows.map((r) => storeRowToTx(r, storeCode, defaultDate));
        result.transactions.push(...txRows);
        matched = true;
        log(`  Sheet "${sheetName}" → transactions OUT cho store "${storeCode}" (${txRows.length} thiết bị)`);
      }
    }

    if (!matched) {
      if (workbook.SheetNames.length === 1) {
        result.stores.push(...rows);
        log(`  Sheet "${sheetName}" (1 sheet, không rõ tên) → collection "stores" (${rows.length} rows)`);
      } else {
        log(`  ⚠ Sheet "${sheetName}" không khớp — bỏ qua.`);
      }
    }
  });
  return result;
}

function onFileSelected(file) {
  selectedJson = null;
  setButtonsEnabled(false);
  if (!file) return;

  const isExcel = /\.(xlsx|xls)$/i.test(file.name);

  if (isExcel) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const XLSX = window.XLSX;
        if (!XLSX) throw new Error("SheetJS chưa tải — reload trang và thử lại.");
        const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
        log(`Excel: ${wb.SheetNames.length} sheet(s): ${wb.SheetNames.join(", ")}`);
        selectedJson = excelToRaw(wb);
        const { tx, stock, stores, minipc, offices, warehouses } = validateRaw(selectedJson);
        log(`Loaded Excel OK: transactions=${tx.length}, stock=${stock.length}, stores=${stores.length}, minipc=${minipc.length}, offices=${offices.length}, warehouses=${warehouses.length}`);
        setButtonsEnabled(true);
      } catch (e) {
        log(`✗ Excel lỗi: ${e?.message || e}`);
        selectedJson = null;
        setButtonsEnabled(false);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        selectedJson = JSON.parse(reader.result);
        const { tx, stock, stores, minipc, offices, warehouses } = validateRaw(selectedJson);
        log(`Loaded JSON OK: transactions=${tx.length}, stock=${stock.length}, stores=${stores.length}, minipc=${minipc.length}, offices=${offices.length}, warehouses=${warehouses.length}`);
        setButtonsEnabled(true);
      } catch (e) {
        log(`✗ JSON lỗi: ${e?.message || e}`);
        selectedJson = null;
        setButtonsEnabled(false);
      }
    };
    reader.readAsText(file);
  }
}

async function importCollection(colName, rows, normalizer) {
  log(`→ Import "${colName}" (${rows.length} docs)`);
  const CHUNK = 400;
  let done = 0;
  while (done < rows.length) {
    const slice = rows.slice(done, done + CHUNK);
    const batch = writeBatch(db);
    slice.forEach((r) => {
      const ref = doc(collection(db, colName));
      batch.set(ref, {
        ...normalizer(r),
        importedAt: serverTimestamp(),
      });
    });
    await batch.commit();
    done += slice.length;
    log(`  ✓ ${colName}: ${done}/${rows.length}`);
  }
}

async function doDryRun() {
  if (!selectedJson) return;
  const { tx, stock, stores, minipc, offices, warehouses } = validateRaw(selectedJson);
  const sampleTx = tx[0] ? normalizeTx(tx[0]) : null;
  const sampleStock = stock[0] ? normalizeStock(stock[0]) : null;
  log("— Dry-run —");
  log(`transactions: ${tx.length}`);
  log(`stock: ${stock.length}`);
  log(`stores: ${stores.length}`);
  log(`minipc: ${minipc.length}`);
  log(`offices: ${offices.length}`);
  log(`warehouses: ${warehouses.length}`);
  if (sampleTx) log(`sample tx => ${JSON.stringify(sampleTx).slice(0, 220)}...`);
  if (sampleStock) log(`sample stock => ${JSON.stringify(sampleStock).slice(0, 220)}...`);
  log("— End dry-run —");
}

async function doImport() {
  if (!currentUser) {
    log("✗ Bạn cần đăng nhập trước khi import.");
    return;
  }
  if (!selectedJson) return;

  const { tx, stock, stores, minipc, offices, warehouses } = validateRaw(selectedJson);

  $("btnImport").disabled = true;
  $("btnDryRun").disabled = true;
  try {
    log(`Bắt đầu import… uid=${currentUser.uid}`);
    await importCollection("transactions", tx, normalizeTx);
    await importCollection("stock", stock, normalizeStock);
    await importCollection("stores", stores, normalizeStore);
    await importCollection("minipc", minipc, normalizeMinipc);
    if (offices.length) await importCollection("offices", offices, normalizeOffice);
    if (warehouses.length) await importCollection("warehouses", warehouses, normalizeWarehouse);
    log("✓ Import xong.");
    log('Gợi ý: quay về "index.html" và refresh trang.');
  } catch (e) {
    log(`✗ Import lỗi: ${e?.message || e}`);
  } finally {
    $("btnImport").disabled = false;
    $("btnDryRun").disabled = false;
  }
}

// UI bindings
$("fileInput").addEventListener("change", (e) => onFileSelected(e.target.files?.[0]));
$("btnSignIn").addEventListener("click", signInFlow);
$("btnSignOut").addEventListener("click", signOutFlow);
$("btnImport").addEventListener("click", doImport);
$("btnDryRun").addEventListener("click", doDryRun);
$("btnClearLog").addEventListener("click", () => ($("log").textContent = ""));

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;
  if (currentUser) {
    setAuthState(`Auth: ${currentUser.email || currentUser.uid}`, true);
    $("btnSignIn").style.display = "none";
    $("btnSignOut").style.display = "inline-block";
  } else {
    setAuthState("Auth: not signed in", false);
    $("btnSignIn").style.display = "inline-block";
    $("btnSignOut").style.display = "none";
  }
});

log("Tip: Import sẽ tạo docs mới. Nếu đã import trước đó, có thể bị trùng dữ liệu.");

