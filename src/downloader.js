// src/downloader.js
// Downloads media files (images & videos) from URLs to a local temp folder.

import { createWriteStream, mkdirSync, existsSync, unlinkSync } from "fs";
import { pipeline } from "stream/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);
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
 * @returns {Promise<string>} - Path to the downloaded file.
 */
export async function downloadMedia(url, filename) {
    ensureTmpDir();
    const filePath = path.join(TMP_DIR, filename);

    console.log(`   ⬇️  Downloading: ${url}`);

    const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    }

    const fileStream = createWriteStream(filePath);
    await pipeline(response.body, fileStream);

    console.log(`   💾 Saved to: ${filePath}`);
    return filePath;
}

/**
 * Download a Reddit video and merge with its audio track.
 * Falls back to video-only if audio isn't available.
 * @param {string} videoUrl - Video stream URL
 * @param {string} audioUrl - Audio stream URL
 * @param {string} filename - Output filename
 * @returns {Promise<string>} - Path to the merged file.
 */
export async function downloadVideoWithAudio(videoUrl, audioUrl, filename) {
    ensureTmpDir();

    const videoPath = path.join(TMP_DIR, `_vid_${filename}`);
    const audioPath = path.join(TMP_DIR, `_aud_${filename}`);
    const outputPath = path.join(TMP_DIR, filename);

    // 1. Download video
    console.log(`   ⬇️  Downloading video: ${videoUrl}`);
    const vidRes = await fetch(videoUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!vidRes.ok) throw new Error(`Video download failed: HTTP ${vidRes.status}`);
    await pipeline(vidRes.body, createWriteStream(videoPath));

    // 2. Try downloading audio (some posts have no audio)
    let hasAudio = false;
    try {
        console.log(`   🔊 Downloading audio...`);
        const audRes = await fetch(audioUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (audRes.ok) {
            await pipeline(audRes.body, createWriteStream(audioPath));
            hasAudio = true;
        }
    } catch {
        console.log(`   ⚠️  No audio track available (silent video)`);
    }

    // 3. Merge with ffmpeg or use video-only
    if (hasAudio && ffmpegPath) {
        try {
            console.log(`   🔧 Merging video + audio...`);
            await execFileAsync(ffmpegPath, [
                "-i", videoPath,
                "-i", audioPath,
                "-c:v", "copy",
                "-c:a", "aac",
                "-shortest",
                "-y",
                outputPath,
            ], { timeout: 30000 });

            // Clean up temp files
            cleanupFile(videoPath);
            cleanupFile(audioPath);
            console.log(`   💾 Saved (with audio): ${outputPath}`);
            return outputPath;
        } catch (err) {
            console.log(`   ⚠️  Merge failed, using video-only: ${err.message}`);
        }
    }

    // No audio — skip this video (user doesn't want silent videos)
    cleanupFile(videoPath);
    cleanupFile(audioPath);
    console.log(`   ⏭️  Skipping video (no audio track)`);
    return null;
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
