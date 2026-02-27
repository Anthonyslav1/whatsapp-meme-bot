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
        // Audio is always at the same base path. Use URL object to safely strip filename and query params.
        const urlObj = new URL(videoUrl);
        const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf("/"));
        const baseUrl = `${urlObj.origin}${basePath}`;
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

        // Single keyword search (more reliable than per-account from: queries)
        console.log(`📡 Searching Twitter via Xpoz: "nigeria meme funny"`);
        try {
            const results = await withTimeout(
                client.twitter.searchPosts("nigeria meme funny", {
                    fields: ["id", "text", "authorUsername", "mediaUrls"],
                }),
                20000,
                "meme search"
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
                    account: `@${post.authorUsername || "twitter"}`,
                    media,
                });
            }

            console.log(`   ✅ Found ${allMemes.length} media tweets`);
        } catch (err) {
            console.error(`   ❌ Twitter search failed: ${err.message}`);
        }
    } catch (err) {
        console.error(`   ❌ Xpoz connection error: ${err.message}`);
    } finally {
        try { await client.close(); } catch { /* ignore */ }
    }

    return allMemes;
}

/**
 * Fetch memes from TikTok using a free public scraper API (TikWM).
 * This returns watermark-free videos based on search keywords.
 * @param {string[]} keywords - List of search queries
 * @returns {Promise<object[]>}
 */
export async function fetchTikTokMemes(keywords) {
    const allMemes = [];
    if (!keywords || keywords.length === 0) return allMemes;

    for (const keyword of keywords) {
        console.log(`📡 Searching TikTok: "${keyword}"`);
        try {
            // Unofficial free TikTok search API
            const res = await fetch(`https://tikwm.com/api/feed/search?keywords=${encodeURIComponent(keyword)}&count=10`, {
                headers: { "User-Agent": "Mozilla/5.0" }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const json = await res.json();
            if (json.code !== 0 || !json.data || !json.data.videos) continue;

            for (const video of json.data.videos) {
                // Must have a watermark-free play URL
                if (!video.play) continue;

                // WhatsApp Status has a hard 30-second limit for video. 
                // Let's filter out anything longer than 29 seconds to be safe.
                if (video.duration && video.duration > 29) continue;

                allMemes.push({
                    tweetId: `tiktok_${video.video_id}`,
                    text: video.title || "",
                    account: `@${video.author?.unique_id || "tiktok"}`,
                    media: [
                        { url: video.play, type: "video" }
                    ]
                });
            }
            console.log(`   ✅ Found ${json.data.videos.length} TikToks (kept ${allMemes.length} under 30s)`);
        } catch (err) {
            console.error(`   ❌ Failed to search TikTok for "${keyword}": ${err.message}`);
        }
    }

    return allMemes;
}

/**
 * Fetch memes from all configured sources.
 * @param {object} config - Bot config
 * @param {number} cycleCount - Current cycle number (0-indexed)
 * @returns {Promise<Array>}
 */
export async function fetchAllMemes(config, cycleCount) {
    let allMemes = [];

    // 1. Reddit (Runs every cycle)
    if (config.redditSubreddits?.length > 0) {
        for (const sub of config.redditSubreddits) {
            const memes = await fetchRedditMemes(sub);
            allMemes = allMemes.concat(memes);
        }
    }

    // 2. TikTok (Runs every configured cycle)
    const tiktokFreq = config.tiktokCheckMultiplier || 3;
    if (config.tiktokKeywords?.length > 0 && cycleCount % tiktokFreq === 0) {
        console.log(`\n🎵 TikTok cycle (every ${tiktokFreq} checks)`);
        const tiktokMemes = await fetchTikTokMemes(config.tiktokKeywords);
        allMemes = allMemes.concat(tiktokMemes);
    } else if (config.tiktokKeywords?.length > 0) {
        console.log(`   ⏭️  Skipping TikTok this cycle (next in ${tiktokFreq - (cycleCount % tiktokFreq)} cycles)`);
    }

    // 3. Twitter via Xpoz (every Nth cycle to save credits)
    const twitterMultiplier = config.twitterCheckMultiplier || 6;
    const isTwitterCycle = cycleCount % twitterMultiplier === 0;

    if (config.twitterAccounts?.length > 0) {
        if (isTwitterCycle) {
            console.log(`\n🐦 Twitter cycle (every ${twitterMultiplier} checks)`);
            const memes = await fetchTwitterMemes(config.twitterAccounts);
            allMemes = allMemes.concat(memes);
        } else {
            console.log(`   ⏭️  Skipping Twitter this cycle (next in ${twitterMultiplier - (cycleCount % twitterMultiplier)} cycles)`);
        }
    }

    // Shuffle results so we get a good mix of sources
    return allMemes.sort(() => Math.random() - 0.5);
}
