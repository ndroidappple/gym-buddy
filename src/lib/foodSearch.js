import { supabase } from "../supabase-client.js";

/**
 * Searches foods through /api/food (USDA + Open Food Facts). Resolves { results, partial }.
 * Throws an Error whose `kind` is "offline" | "auth" | "unavailable" | "busy".
 */
export async function searchFoods({ q, barcode, signal }) {
  if (!navigator.onLine) throw Object.assign(new Error("offline"), { kind: "offline" });
  const { data } = await supabase.auth.getSession();
  const qs = barcode ? `barcode=${encodeURIComponent(barcode)}` : `q=${encodeURIComponent(q)}`;
  let res;
  try {
    res = await fetch(`/api/food?${qs}`, { headers: { authorization: `Bearer ${data.session?.access_token || ""}` }, signal });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw Object.assign(new Error("offline"), { kind: "offline" });
  }
  if (res.status === 401) throw Object.assign(new Error("auth"), { kind: "auth" });
  if (res.status === 404) throw Object.assign(new Error("unavailable"), { kind: "unavailable" }); // `vite` dev has no /api
  if (!res.ok) throw Object.assign(new Error("busy"), { kind: "busy" });
  return res.json();
}

export const SEARCH_TROUBLE = {
  offline: "No connection. Recent foods and quick add still work.",
  auth: "Sign in again to search foods.",
  unavailable: "Food search runs on the deployed app, not this dev server.",
  busy: "Food search is slow right now. Try again, or use quick add.",
};
