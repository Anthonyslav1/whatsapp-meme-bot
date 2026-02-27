// src/index.js
// Main entry point — connects everything together.

import "dotenv/config";

import cron from "node-cron";
import { readFileSync } from "fs";
import { fetchAllMemes } from "./fetcher.js";
import { downloadMedia, cleanupFile, buildFilename } from "./downloader.js";
import { loadStore, isPosted, markPosted } from "./store.js";
import { initClient, sendMediaToStatus } from "./whatsapp.js";

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
    const newMemes = memes.filter((m) => !isPosted(store, m.tweetId));
    console.log(`\n🆕 ${newMemes.length} new memes found (${memes.length} total fetched)\n`);

    if (newMemes.length === 0) {
        console.log("😴 Nothing new to post. Waiting for next cycle...\n");
        return;
    }

    // 3. Limit to maxPostsPerCheck
    const toPost = newMemes.slice(0, config.maxPostsPerCheck);

    // 4. Download, post, and clean up each meme
    for (const meme of toPost) {
        console.log(`\n🎯 Processing meme ${meme.tweetId} from ${meme.account}`);

        for (let i = 0; i < meme.media.length; i++) {
            const { url, type } = meme.media[i];
            const filename = buildFilename(meme.tweetId, i, type);

            try {
                const filePath = await downloadMedia(url, filename);

                // Build a caption
                const caption = `😂 ${meme.text.slice(0, 200)}`;

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
        markPosted(store, meme.tweetId);
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
    console.log(`   Twitter accounts: ${(config.twitterAccounts || []).map(a => "@" + a).join(", ") || "none"}`);
    console.log(`   Twitter freq    : every ${config.twitterCheckMultiplier || 6} cycles`);
    console.log(`   Check interval  : every ${config.checkIntervalMinutes} minutes`);
    console.log(`   WhatsApp group  : "${config.whatsappGroupName}"`);
    console.log(`   Max posts/check : ${config.maxPostsPerCheck}`);
    console.log(`   Xpoz API key    : ${process.env.XPOZ_API_KEY ? "✅ set" : "❌ not set (Twitter disabled)"}\n`);

    // Load the posted-memes store
    const store = loadStore();
    console.log(`📦 Store loaded: ${store.size} previously posted memes\n`);

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
