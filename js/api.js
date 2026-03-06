// API layer for Supabase tables
import { supabase } from "./supabase-client.js";

export async function fetchTable(table) {
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw error;
  return data;
}

export async function insertRow(table, row) {
  const { data, error } = await supabase.from(table).insert([row]).select();
  if (error) throw error;
  return data[0];
}

export async function updateRow(table, id, values) {
  const { data, error } = await supabase.from(table).update(values).eq("id", id).select();
  if (error) throw error;
  return data[0];
}

export async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
}
