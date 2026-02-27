// src/index.js
// Main entry point — connects everything together.

import "dotenv/config";

import cron from "node-cron";
import { readFileSync } from "fs";
import { fetchAllMemes } from "./fetcher.js";
import { downloadMedia, downloadVideoWithAudio, cleanupFile, buildFilename } from "./downloader.js";
import { loadStore, isPosted, markPosted } from "./store.js";
import { initClient, sendMediaToStatus } from "./whatsapp.js";
import { generateAiMeme } from "./generator.js";

// ── Load config ──────────────────────────────────────────────
const config = JSON.parse(readFileSync("./config.json", "utf-8"));

const DRY_RUN = process.argv.includes("--dry-run");

if (DRY_RUN) {
    console.log("🧪 DRY-RUN MODE — will not connect to WhatsApp or send messages.\n");
}

// ── Cycle counter (used to throttle Twitter fetches) ─────────
let cycleCount = 0;

// ── Core meme cycle ──────────────────────────────────────────
async function runMemeCycle(store) {
    console.log(`\n⏰ [${new Date().toLocaleTimeString()}] Starting meme cycle #${cycleCount}...\n`);

    // 1. Fetch memes from all sources (Reddit every cycle, Twitter every Nth)
    const memes = await fetchAllMemes(config, cycleCount);
    cycleCount++;

    // 2. Filter out already-posted memes
    const newMemes = memes.filter((m) => !isPosted(store, m.tweetId, m.media));
    console.log(`\n🆕 ${newMemes.length} new memes found (${memes.length} total fetched)\n`);

    // 3. Add AI-generated meme on configured cycles
    const aiFreq = config.aiMemeFrequency || 3;
    if (config.enableAiMemes && (cycleCount - 1) % aiFreq === 0) {
        const aiMeme = await generateAiMeme();
        if (aiMeme) {
            newMemes.unshift(aiMeme); // AI meme goes first
        }
    }

    if (newMemes.length === 0) {
        console.log("😴 Nothing new to post. Waiting for next cycle...\n");
        return;
    }

    // 4. Limit to maxPostsPerCheck
    const toPost = newMemes.slice(0, config.maxPostsPerCheck);

    // 5. Download, post, and clean up each meme
    for (const meme of toPost) {
        console.log(`\n🎯 Processing meme ${meme.tweetId} from ${meme.account}`);

        // AI memes already have a downloaded image
        if (meme.localPath) {
            try {
                const cleanText = meme.text.replace(/#[^\s#]+/g, "").replace(/\s{2,}/g, " ").trim();
                const caption = `😂 ${cleanText.slice(0, 200)}`;
                if (DRY_RUN) {
                    console.log(`   [DRY-RUN] Would post AI meme to Status: ${caption.slice(0, 80)}...`);
                } else {
                    await sendMediaToStatus(meme.localPath, caption);
                }
                cleanupFile(meme.localPath);
                markPosted(store, meme.tweetId, meme.media);
            } catch (err) {
                console.error(`   ❌ Error posting AI meme: ${err.message}`);
            }
            continue;
        }

        for (let i = 0; i < meme.media.length; i++) {
            const { url, type, audioUrl } = meme.media[i];
            const filename = buildFilename(meme.tweetId, i, type);

            try {
                // Use audio-merging download for Reddit videos with audio
                let filePath;
                if (type === "video" && audioUrl) {
                    filePath = await downloadVideoWithAudio(url, audioUrl, filename);
                    if (!filePath) continue; // skip silent videos
                } else {
                    filePath = await downloadMedia(url, filename);
                }

                // Build a caption without hashtags
                const cleanText = meme.text.replace(/#[^\s#]+/g, "").replace(/\s{2,}/g, " ").trim();
                const caption = `😂 ${cleanText.slice(0, 200)}`;

                if (DRY_RUN) {
                    console.log(`   [DRY-RUN] Would post to Status: ${caption.slice(0, 80)}...`);
                } else {
                    await sendMediaToStatus(filePath, caption);
                }

                // Clean up temp file
                cleanupFile(filePath);
            } catch (err) {
                console.error(`   ❌ Error processing media: ${err.message}`);
            }
        }

        // Mark as posted so we don't send it again
        markPosted(store, meme.tweetId, meme.media);
    }

    console.log(`\n✅ Cycle complete. Posted ${toPost.length} memes.\n`);
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
    console.log("╔═══════════════════════════════════════╗");
    console.log("║     🤖 WhatsApp Meme Bot v2.0.0      ║");
    console.log("╚═══════════════════════════════════════╝\n");
    console.log(`📋 Config:`);
    console.log(`   Reddit subs     : ${(config.redditSubreddits || []).map(s => "r/" + s).join(", ") || "none"}`);
    console.log(`   TikTok keywords : ${(config.tiktokKeywords || []).map(k => '"' + k + '"').join(", ") || "none"}`);
    console.log(`   TikTok freq     : every ${config.tiktokCheckMultiplier || 3} cycles`);
    console.log(`   Check interval  : every ${config.checkIntervalMinutes} minutes`);
    console.log(`   WhatsApp group  : "${config.whatsappGroupName}"`);
    console.log(`   Max posts/check : ${config.maxPostsPerCheck}`);
    console.log(`   Xpoz API key    : ${process.env.XPOZ_API_KEY ? "✅ set" : "❌ not set (Twitter disabled)"}`);
    console.log(`   Gemini API key  : ${process.env.GEMINI_API_KEY ? "✅ set" : "❌ not set (AI memes disabled)"}`);
    console.log(`   AI memes        : ${config.enableAiMemes ? `✅ every ${config.aiMemeFrequency || 3} cycles` : "❌ disabled"}\n`);

    // Load the posted-memes store
    const store = loadStore();
    console.log(`📦 Store loaded: ${store.ids.size} previously posted memes (${store.urls.size} tracked URLs)\n`);

    // Initialise WhatsApp (skip in dry-run)
    if (!DRY_RUN) {
        await initClient();
    }

    // Run once immediately
    await runMemeCycle(store);

    // If dry-run, exit after one cycle
    if (DRY_RUN) {
        console.log("🧪 Dry-run complete. Exiting.");
        process.exit(0);
    }

    // Schedule recurring checks
    const cronExpr = `*/${config.checkIntervalMinutes} * * * *`;
    cron.schedule(cronExpr, () => runMemeCycle(store));

    console.log(`🕐 Scheduler started: checking every ${config.checkIntervalMinutes} minutes.`);
    console.log("   Press Ctrl+C to stop.\n");
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
