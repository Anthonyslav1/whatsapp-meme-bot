import 'dotenv/config';
import { generateAiMeme } from './src/generator.js';

async function test() {
    console.log("Testing AI Meme Generation with Gemini 2.5 Flash...");
    const meme = await generateAiMeme();
    if (meme) {
        console.log("\n✅ SUCCESS!");
        console.log("─────────────────────────────");
        console.log("Caption:", meme.text);
        console.log("Image URL:", meme.media[0].url);
        console.log("Local Path:", meme.localPath);
    } else {
        console.log("\n❌ FAILED to generate meme.");
    }
}

test();
