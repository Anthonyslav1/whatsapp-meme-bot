// src/generator.js
// AI Meme Generator: Uses Gemini (joke writing) + Pollinations.ai (image generation).

import { GoogleGenAI } from "@google/genai";
import { downloadMedia } from "./downloader.js";
import path from "path";
import crypto from "crypto";

const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";

/**
 * Generate an original meme using AI.
 * 1. Gemini writes a meme concept (setup, punchline, image description)
 * 2. Pollinations.ai generates the image from the description
 * @returns {Promise<object|null>} Meme object or null on failure
 */
export async function generateAiMeme() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.log("   ⏭️  Skipping AI meme — no GEMINI_API_KEY set");
        return null;
    }

    try {
        // 1. Generate meme concept with Gemini
        console.log("🤖 Generating AI meme concept...");
        const concept = await generateMemeConcept(apiKey);
        if (!concept) return null;

        console.log(`   💡 Topic: ${concept.topic}`);
        console.log(`   😂 Caption: ${concept.caption}`);

        // 2. Generate image with Pollinations.ai
        console.log("🎨 Generating meme image...");
        const imageUrl = buildPollinationsUrl(concept.imagePrompt);
        const memeId = `ai_${crypto.randomBytes(4).toString("hex")}`;
        const filename = `${memeId}_0.jpg`;

        const filePath = await downloadMedia(imageUrl, filename);

        return {
            tweetId: memeId,
            text: concept.caption,
            account: "🤖 AI Generated",
            media: [{ url: imageUrl, type: "image" }],
            localPath: filePath,
        };
    } catch (err) {
        console.error(`   ❌ AI meme generation failed: ${err.message}`);
        return null;
    }
}

/**
 * Use Gemini to generate a meme concept.
 * @param {string} apiKey
 * @returns {Promise<{topic: string, caption: string, imagePrompt: string}|null>}
 */
async function generateMemeConcept(apiKey) {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are a viral Nigerian meme creator. Your audience is young Nigerians on WhatsApp.

Generate 3 original meme ideas. For each, provide:
- topic: what the meme is about (1-3 words)
- caption: the funny text that goes WITH the image (max 100 chars, use Nigerian slang/pidgin when appropriate like "wahala", "no cap", "e choke", "sapa", etc.)
- imagePrompt: a detailed description of the SCENE to generate as an image (describe the visual, not the text). Make it a funny, exaggerated illustration style. Do NOT include any text in the image description.

Be edgy, relatable, and Gen-Z. Topics can include: Nigerian daily life, NEPA/light issues, Lagos traffic, sapa (being broke), African parents, relationship wahala, exam stress, jollof rice debates, etc.

Return ONLY valid JSON array, no markdown:
[{"topic":"...","caption":"...","imagePrompt":"..."},...]`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: prompt,
        });

        const text = response.text.trim();
        // Strip markdown code blocks if present
        const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
        const ideas = JSON.parse(jsonStr);

        if (!Array.isArray(ideas) || ideas.length === 0) return null;

        // Pick the shortest/punchiest caption (usually the funniest)
        const best = ideas.reduce((a, b) =>
            a.caption.length <= b.caption.length ? a : b
        );

        return best;
    } catch (err) {
        console.error(`   ❌ Gemini error: ${err.message}`);
        return null;
    }
}

/**
 * Build a Pollinations.ai image URL from a prompt.
 * @param {string} prompt
 * @returns {string}
 */
function buildPollinationsUrl(prompt) {
    const encoded = encodeURIComponent(prompt);
    return `${POLLINATIONS_BASE}/${encoded}?width=1024&height=1024&nologo=true`;
}
