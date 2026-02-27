// src/fetcher.js
// Dual-source meme fetcher: Reddit JSON API (free, unlimited) + Xpoz Twitter (free tier, rate-limited).

import { XpozClient } from "@xpoz/xpoz";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Reddit JSON API (primary source) ────────────────────────

/**
 * Extract media URLs from a Reddit JSON post object.
 * @param {object} post - Reddit post data (from JSON API)
 * @returns {{ url: string, type: "image" | "video" }[]}
 */
function extractRedditMedia(post) {
    const media = [];

    const url = post.url || "";

    // Direct image links (i.redd.it, i.imgur.com, etc.)
    if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url)) {
        media.push({ url, type: "image" });
    }

    // Direct video links
    if (/\.(mp4|webm)(\?.*)?$/i.test(url)) {
        media.push({ url, type: "video" });
    }

    // Reddit-hosted video (video-only, audio is separate)
    if (post.is_video && post.media?.reddit_video?.fallback_url) {
        const videoUrl = post.media.reddit_video.fallback_url;
        // Audio is always at the same base path
        const baseUrl = videoUrl.replace(/\/DASH_\d+\.mp4.*/, "");
        const audioUrl = `${baseUrl}/DASH_AUDIO_128.mp4`;
        media.push({ url: videoUrl, type: "video", audioUrl });
    }

    // Reddit preview images (fallback if no direct link)
    if (media.length === 0 && post.preview?.images?.length > 0) {
        const source = post.preview.images[0].source;
        if (source?.url) {
            // Reddit HTML-encodes the URL in preview
            const cleanUrl = source.url.replace(/&amp;/g, "&");
            media.push({ url: cleanUrl, type: "image" });
        }
    }

    // Reddit gallery (multiple images)
    if (post.is_gallery && post.media_metadata) {
        for (const [, meta] of Object.entries(post.media_metadata)) {
            if (meta.status === "valid" && meta.s?.u) {
                const cleanUrl = meta.s.u.replace(/&amp;/g, "&");
                media.push({ url: cleanUrl, type: "image" });
            }
        }
    }

    // Deduplicate by URL
    const seen = new Set();
    return media.filter(m => {
        if (seen.has(m.url)) return false;
        seen.add(m.url);
        return true;
    });
}

/**
 * Fetch memes from a subreddit via Reddit's public JSON API.
 * @param {string} subreddit - Subreddit name without r/ prefix
 * @returns {Promise<Array>}
 */
export async function fetchRedditMemes(subreddit) {
    const apiUrl = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25`;
    console.log(`📡 Fetching Reddit JSON: r/${subreddit}`);

    try {
        const response = await fetch(apiUrl, {
            headers: { "User-Agent": USER_AGENT },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const json = await response.json();
        const posts = json.data?.children || [];
        const results = [];

        for (const { data: post } of posts) {
            // Skip stickied/pinned posts (usually mod announcements)
            if (post.stickied) continue;

            const media = extractRedditMedia(post);
            if (media.length === 0) continue; // skip text-only posts

            results.push({
                tweetId: `reddit_${post.id}`,
                text: post.title || "",
                account: `r/${subreddit}`,
                media,
            });
        }

        console.log(`   ✅ Found ${results.length} media posts from r/${subreddit}`);
        return results;
    } catch (err) {
        console.error(`   ❌ Failed to fetch r/${subreddit}: ${err.message}`);
        return [];
    }
}

// ── Xpoz Twitter (secondary source) ─────────────────────────

/**
 * Fetch memes from Twitter accounts via Xpoz SDK.
 * Requires XPOZ_API_KEY env var.
 * @param {string[]} accounts - Twitter handles without @
 * @returns {Promise<Array>}
 */
export async function fetchTwitterMemes(accounts) {
    const apiKey = process.env.XPOZ_API_KEY;
    if (!apiKey) {
        console.log("   ⏭️  Skipping Twitter — no XPOZ_API_KEY set");
        return [];
    }

    const client = new XpozClient({ apiKey });
    const allMemes = [];

    // Helper: race a promise against a timeout
    const withTimeout = (promise, ms, label) =>
        Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout after ${ms / 1000}s: ${label}`)), ms)
            ),
        ]);

    try {
        await withTimeout(client.connect(), 30000, "Xpoz connect");

        for (const account of accounts) {
            console.log(`📡 Fetching Twitter via Xpoz: @${account}`);
            try {
                const results = await withTimeout(
                    client.twitter.searchPosts(`from:${account}`, {
                        fields: ["id", "text", "authorUsername", "mediaUrls"],
                    }),
                    15000,
                    `@${account}`
                );

                for (const post of results.data) {
                    if (!post.mediaUrls || post.mediaUrls.length === 0) continue;

                    const media = post.mediaUrls.map(url => ({
                        url,
                        type: /\.(mp4|webm)/i.test(url) ? "video" : "image",
                    }));

                    allMemes.push({
                        tweetId: `twitter_${post.id}`,
                        text: post.text || "",
                        account: `@${post.authorUsername || account}`,
                        media,
                    });
                }

                console.log(`   ✅ Found ${allMemes.length} media tweets from @${account}`);
            } catch (err) {
                console.error(`   ❌ Failed to fetch @${account}: ${err.message}`);
            }
        }
    } catch (err) {
        console.error(`   ❌ Xpoz connection error: ${err.message}`);
    } finally {
        try { await client.close(); } catch { /* ignore */ }
    }

    return allMemes;
}

// ── Combined fetcher ─────────────────────────────────────────

/**
 * Fetch memes from all configured sources.
 * Reddit runs every cycle; Twitter only on every Nth cycle to conserve credits.
 * @param {object} config - Bot config
 * @param {number} cycleCount - Current cycle number (0-indexed)
 * @returns {Promise<Array>}
 */
export async function fetchAllMemes(config, cycleCount) {
    const allMemes = [];

    // 1. Reddit (every cycle)
    if (config.redditSubreddits && config.redditSubreddits.length > 0) {
        for (const sub of config.redditSubreddits) {
            const memes = await fetchRedditMemes(sub);
            allMemes.push(...memes);
        }
    }

    // 2. Twitter via Xpoz (every Nth cycle to save credits)
    const multiplier = config.twitterCheckMultiplier || 6;
    const isTwitterCycle = cycleCount % multiplier === 0;

    if (config.twitterAccounts && config.twitterAccounts.length > 0) {
        if (isTwitterCycle) {
            console.log(`\n🐦 Twitter cycle (every ${multiplier} checks)`);
            const memes = await fetchTwitterMemes(config.twitterAccounts);
            allMemes.push(...memes);
        } else {
            console.log(`   ⏭️  Skipping Twitter this cycle (next in ${multiplier - (cycleCount % multiplier)} cycles)`);
        }
    }

    return allMemes;
}
