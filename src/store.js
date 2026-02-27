// src/store.js
// JSON-file-backed store to track which tweets have already been posted.

import { readFileSync, writeFileSync, existsSync } from "fs";

const STORE_PATH = "./posted_memes.json";
const MAX_IDS = 5000; // cap to prevent unbounded growth

/**
 * Load the set of posted tweet IDs from disk.
 * @returns {Set<string>}
 */
function loadStore() {
  if (!existsSync(STORE_PATH)) return new Set();
  try {
    const data = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    return new Set(data);
  } catch {
    return new Set();
  }
}

/**
 * Save the set of posted IDs back to disk, keeping only the most recent MAX_IDS.
 * @param {Set<string>} store
 */
function saveStore(store) {
  const arr = [...store];
  const trimmed = arr.slice(-MAX_IDS); // keep the newest entries
  writeFileSync(STORE_PATH, JSON.stringify(trimmed, null, 2));
}

/**
 * Check if a tweet has already been posted.
 * @param {Set<string>} store
 * @param {string} tweetId
 * @returns {boolean}
 */
export function isPosted(store, tweetId) {
  return store.has(tweetId);
}

/**
 * Mark a tweet as posted and persist.
 * @param {Set<string>} store
 * @param {string} tweetId
 */
export function markPosted(store, tweetId) {
  store.add(tweetId);
  saveStore(store);
}

export { loadStore };
