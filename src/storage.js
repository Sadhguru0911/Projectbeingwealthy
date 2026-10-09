// Genuine on-device storage: everything lives in this browser's localStorage,
// on this machine only. Nothing is sent anywhere, and there is no Claude
// account or network dependency involved in storing your data.
//
// Demo mode (backlog #39) reads a plain, unprefixed flag here - checked once, at
// module load, exactly like every other page-load-time decision this app makes -
// and routes EVERY get/set/delete/list through a completely separate localStorage
// namespace instead. This is the whole mechanism: nothing else in this file
// changes, and nothing in App.jsx needs to know demo mode exists at the storage
// layer at all. Writes made while browsing the demo can never reach real data,
// because they're never even directed at the same keys - not because of a runtime
// check on every call, but because the prefix itself is different. See
// src/demo/demoStorage.js for how the flag gets set and the demo data seeded
// before a reload; this file only needs to honour it once it exists.
const DEMO_FLAG = "being-wealthy-demo-active";
const PREFIX = (typeof window !== "undefined" && window.localStorage.getItem(DEMO_FLAG) === "1")
  ? "being-wealthy-demo:"
  : "being-wealthy:";

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
