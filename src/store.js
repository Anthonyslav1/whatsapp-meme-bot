// src/store.js
// JSON-file-backed store to track which memes have already been posted.
// Deduplicates by both post ID and media URL to catch crossposts.

import { readFileSync, writeFileSync, existsSync } from "fs";

const STORE_PATH = "./posted_memes.json";
const MAX_IDS = 5000; // cap to prevent unbounded growth

/**
 * Load the store from disk.
 * @returns {{ ids: Set<string>, urls: Set<string> }}
 */
function loadStore() {
  if (!existsSync(STORE_PATH)) return { ids: new Set(), urls: new Set() };
  try {
    const data = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    // Support old format (plain array of IDs)
    if (Array.isArray(data)) {
      return { ids: new Set(data), urls: new Set() };
    }
    return {
      ids: new Set(data.ids || []),
      urls: new Set(data.urls || []),
    };
  } catch {
    return { ids: new Set(), urls: new Set() };
  }
}

/**
 * Save the store to disk, trimming to MAX_IDS.
 * @param {{ ids: Set<string>, urls: Set<string> }} store
 */
function saveStore(store) {
  const ids = [...store.ids].slice(-MAX_IDS);
  const urls = [...store.urls].slice(-MAX_IDS);
  writeFileSync(STORE_PATH, JSON.stringify({ ids, urls }, null, 2));
}

/**
 * Check if a meme has already been posted (by ID or media URL).
 * @param {{ ids: Set<string>, urls: Set<string> }} store
 * @param {string} tweetId
 * @param {{ url: string }[]} [media] - media array to check URLs
 * @returns {boolean}
 */
export function isPosted(store, tweetId, media) {
  if (store.ids.has(tweetId)) return true;
  // Also check if any media URL was already posted (catches crossposts)
  if (media && media.length > 0) {
    for (const m of media) {
      if (store.urls.has(m.url)) return true;
    }
  }
  return false;
}

/**
 * Mark a meme as posted (saves both ID and media URLs).
 * @param {{ ids: Set<string>, urls: Set<string> }} store
 * @param {string} tweetId
 * @param {{ url: string }[]} [media]
 */
export function markPosted(store, tweetId, media) {
  store.ids.add(tweetId);
  if (media) {
    for (const m of media) {
      store.urls.add(m.url);
    }
  }
  saveStore(store);
}

export { loadStore };

