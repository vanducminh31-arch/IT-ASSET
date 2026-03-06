// Business logic for transactions and stock
import { insertRow, updateRow, fetchTable } from "./api.js";
import { setTX, setSTOCK } from "./state.js";

// Transaction IN
export async function transactionIN(device) {
  // 1. Create transaction
  const tx = await insertRow("transactions", { type: "IN", created_by: device.created_by, note: device.note });
  // 2. Insert device
  const dev = await insertRow("devices", { ...device, status: "in_stock", location_type: "stock" });
  // 3. Update stock
  let stock = await fetchTable("stock");
  let stockItem = stock.find(s => s.device_type_id === device.device_type_id);
  if (stockItem) {
    await updateRow("stock", stockItem.id, { quantity: stockItem.quantity + 1 });
  } else {
    await insertRow("stock", { device_type_id: device.device_type_id, device_name: device.device_name, quantity: 1 });
  }
  // 4. Update state
  setTX(await fetchTable("transactions"));
  setSTOCK(await fetchTable("stock"));
}

// Transaction OUT
export async function transactionOUT(device_id, assignment) {
  // 1. Create transaction
  const tx = await insertRow("transactions", { type: "OUT", created_by: assignment.created_by, note: assignment.note });
  // 2. Update device status
  await updateRow("devices", device_id, { status: "assigned", location_type: assignment.location_type, location_id: assignment.location_id });
  // 3. Create assignment
  await insertRow("assignments", { device_id, ...assignment });
  // 4. Update stock
  let device = (await fetchTable("devices")).find(d => d.id === device_id);
  let stock = await fetchTable("stock");
  let stockItem = stock.find(s => s.device_type_id === device.device_type_id);
  if (stockItem) {
    await updateRow("stock", stockItem.id, { quantity: Math.max(0, stockItem.quantity - 1) });
  }
  // 5. Update state
  setTX(await fetchTable("transactions"));
  setSTOCK(await fetchTable("stock"));
}
