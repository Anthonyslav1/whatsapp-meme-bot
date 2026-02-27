// src/downloader.js
// Downloads media files (images & videos) from URLs to a local temp folder.

import { createWriteStream, mkdirSync, existsSync, unlinkSync } from "fs";
import { pipeline } from "stream/promises";
import path from "path";

const TMP_DIR = "./tmp";

/**
 * Ensure the temp directory exists.
 */
function ensureTmpDir() {
    if (!existsSync(TMP_DIR)) {
        mkdirSync(TMP_DIR, { recursive: true });
    }
}

/**
 * Download a file from a URL and save it locally.
 * @param {string} url - The media URL to download.
 * @param {string} filename - Desired filename (e.g., "12345.jpg").
 * @returns {Promise<string>} - Absolute path to the downloaded file.
 */
export async function downloadMedia(url, filename) {
    ensureTmpDir();
    const filePath = path.join(TMP_DIR, filename);

    console.log(`   ⬇️  Downloading: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    }

    const fileStream = createWriteStream(filePath);
    await pipeline(response.body, fileStream);

    console.log(`   💾 Saved to: ${filePath}`);
    return filePath;
}

/**
 * Delete a temporary file after it has been posted.
 * @param {string} filePath
 */
export function cleanupFile(filePath) {
    try {
        if (existsSync(filePath)) {
            unlinkSync(filePath);
        }
    } catch {
        // non-critical, ignore cleanup errors
    }
}

/**
 * Determine a filename from a tweet ID and media type.
 * @param {string} tweetId
 * @param {number} index - media index within the tweet
 * @param {"image" | "video"} type
 * @returns {string}
 */
export function buildFilename(tweetId, index, type) {
    const safeId = tweetId.replace(/[^a-zA-Z0-9_-]/g, "");
    const ext = type === "video" ? "mp4" : "jpg";
    return `${safeId}_${index}.${ext}`;
}
