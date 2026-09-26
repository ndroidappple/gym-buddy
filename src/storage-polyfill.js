/**
 * IRONLOG was originally built as a Claude artifact, where `window.storage`
 * is provided by the host (Anthropic-backed key/value storage, scoped
 * privately per user). That API doesn't exist in a plain browser.
 *
 * This polyfill gives `window.storage` the same shape — get/set/delete/list,
 * same {key, value} return format, same async signatures — backed by a
 * Supabase table (`storage_kv`) instead. App.jsx needs zero changes.
 *
 * Every row is scoped to the signed-in user via `user_id` + RLS, so this
 * only works once a Supabase auth session exists (see Auth.jsx, which gates
 * rendering of <App /> until sign-in completes).
 */
import { supabase } from "./supabase-client.js";

if (typeof window !== "undefined" && !window.storage) {
  async function currentUserId() {
    // getSession reads the stored session, so it works offline (getUser needs the network).
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) throw new Error("ironlog storage: no signed-in user");
    return user.id;
  }

  window.storage = {
    async get(key) {
      const user_id = await currentUserId();
      const { data, error } = await supabase
        .from("storage_kv")
        .select("value, updated_at")
        .eq("user_id", user_id)
        .eq("key", key)
        .maybeSingle();
      if (error) throw error; // a failed read must never look like "no data yet"
      if (!data) return null;
      return { key, value: data.value, stamp: data.updated_at, shared: false };
    },

    /** When the row was last written (or null), without downloading it: a cheap "did another device save?" check. */
    async stamp(key) {
      const user_id = await currentUserId();
      const { data, error } = await supabase
        .from("storage_kv")
        .select("updated_at")
        .eq("user_id", user_id)
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return data?.updated_at ?? null;
    },

    async set(key, value) {
      const user_id = await currentUserId();
      const { data, error } = await supabase
        .from("storage_kv")
        .upsert({ user_id, key, value, updated_at: new Date().toISOString() })
        .select("updated_at")
        .single();
      if (error) throw error;
      return { key, value, stamp: data.updated_at, shared: false };
    },

    async delete(key) {
      const user_id = await currentUserId();
      const { error } = await supabase
        .from("storage_kv")
        .delete()
        .eq("user_id", user_id)
        .eq("key", key);
      return { key, deleted: !error, shared: false };
    },

    async list(prefix = "") {
      const user_id = await currentUserId();
      const { data, error } = await supabase
        .from("storage_kv")
        .select("key")
        .eq("user_id", user_id)
        .like("key", `${prefix}%`);
      if (error) return { keys: [], prefix, shared: false };
      return { keys: data.map((r) => r.key), prefix, shared: false };
    },
  };
}
