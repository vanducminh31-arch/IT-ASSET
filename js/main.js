// Entry point: load data, handle navigation, auth
import { fetchTable } from "./api.js";
import { setTX, setSTOCK, setSTORES, setOFFICES, setWAREHOUSES, setDEVICES } from "./state.js";
import { renderDashboard, renderTransactions, renderStock, renderStores, renderOffices, renderWarehouses } from "./ui.js";
import { getCurrentUser, getUserRole } from "./auth.js";

async function loadAllData() {
  setTX(await fetchTable("transactions"));
  setSTOCK(await fetchTable("stock"));
  setSTORES(await fetchTable("stores"));
  setOFFICES(await fetchTable("offices"));
  setWAREHOUSES(await fetchTable("warehouses"));
  setDEVICES(await fetchTable("devices"));
}

async function main() {
  const user = await getCurrentUser();
  if (!user) {
    // show login UI
    return;
  }
  const role = await getUserRole(user.id);
  await loadAllData();
  // default page
  renderDashboard();
}

main();
