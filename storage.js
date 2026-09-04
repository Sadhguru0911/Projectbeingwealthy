// Genuine on-device storage: everything lives in this browser's localStorage,
// on this machine only. Nothing is sent anywhere, and there is no Claude
// account or network dependency involved in storing your data.
const PREFIX = "being-wealthy:";

export const storage = {
  async get(key) {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) throw new Error(`No value for "${key}"`);
    return { key, value: raw, shared: false };
  },
  async set(key, value) {
    window.localStorage.setItem(PREFIX + key, value);
    return { key, value, shared: false };
  },
  async delete(key) {
    window.localStorage.removeItem(PREFIX + key);
    return { key, deleted: true, shared: false };
  },
  async list(prefix = "") {
    const keys = Object.keys(window.localStorage)
      .filter((k) => k.startsWith(PREFIX + prefix))
      .map((k) => k.slice(PREFIX.length));
    return { keys, shared: false };
  },
};
