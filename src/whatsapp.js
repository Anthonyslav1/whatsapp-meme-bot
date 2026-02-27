// src/whatsapp.js
// WhatsApp integration using whatsapp-web.js.

import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from "qrcode-terminal";

let client = null;

/**
 * Initialise the WhatsApp Web client.
 * Displays a QR code in the terminal. Scan it with your phone to log in.
 * Uses LocalAuth so the session is persisted between restarts (no re-scan needed).
 * @returns {Promise<object>} - The authenticated client instance.
 */
export function initClient() {
    return new Promise((resolve, reject) => {
        client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: ["--no-sandbox", "--disable-setuid-sandbox"],
            },
        });

        client.on("qr", (qr) => {
            console.log("\n📱 Scan this QR code with WhatsApp to log in:\n");
            qrcode.generate(qr, { small: true });
        });

        client.on("ready", () => {
            console.log("✅ WhatsApp client is ready!\n");
            resolve(client);
        });

        client.on("auth_failure", (msg) => {
            console.error("❌ Authentication failed:", msg);
            reject(new Error("WhatsApp auth failed"));
        });

        client.on("disconnected", (reason) => {
            console.error("❌ WhatsApp disconnected:", reason, "— exiting for restart.");
            process.exit(1); // let pm2/systemd restart the process
        });

        console.log("🔄 Initialising WhatsApp client...");
        client.initialize();
    });
}

/**
 * Send a media file (image or video) to WhatsApp Status.
 * @param {string} filePath - Local path to the media file.
 * @param {string} caption - Status caption text.
 * @returns {Promise<boolean>} - True if posted successfully.
 */
export async function sendMediaToStatus(filePath, caption) {
    try {
        const media = MessageMedia.fromFilePath(filePath);
        await client.sendMessage("status@broadcast", media, { caption });
        console.log(`   📤 Posted to Status: ${caption.slice(0, 60)}...`);
        return true;
    } catch (err) {
        console.error(`   ❌ Failed to post to Status: ${err.message}`);
        return false;
    }
}

/**
 * Find a WhatsApp group by its name.
 * @param {string} groupName - Exact name of the group.
 * @returns {Promise<object|null>} - The chat object or null.
 */
async function findGroup(groupName) {
    const chats = await client.getChats();
    return chats.find(
        (chat) => chat.isGroup && chat.name === groupName
    ) || null;
}

/**
 * Send a media file (image or video) to a WhatsApp group.
 * @param {string} groupName - Name of the target group.
 * @param {string} filePath - Local path to the media file.
 * @param {string} caption - Message caption.
 * @returns {Promise<boolean>} - True if sent successfully.
 */
export async function sendMediaToGroup(groupName, filePath, caption) {
    const group = await findGroup(groupName);
    if (!group) {
        console.error(`❌ Group "${groupName}" not found. Make sure the bot account is a member.`);
        return false;
    }

    try {
        const media = MessageMedia.fromFilePath(filePath);
        await group.sendMessage(media, { caption });
        console.log(`   📤 Sent to "${groupName}": ${caption.slice(0, 60)}...`);
        return true;
    } catch (err) {
        console.error(`   ❌ Failed to send media: ${err.message}`);
        return false;
    }
}

/**
 * Get the underlying client (for advanced use).
 */
export function getClient() {
    return client;
}
