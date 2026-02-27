# 🤖 WhatsApp Meme Bot

A Node.js bot that **automatically fetches memes** (images & videos) from Twitter/X accounts and **posts them to a WhatsApp group** — all at **zero cost**.

## How It Works

1. Bot starts → displays a QR code → you scan it with WhatsApp to log in.
2. Every N minutes (configurable), it checks target Twitter accounts for new posts via Nitter RSS.
3. If a tweet has media (image/video), it downloads it, and sends it to your WhatsApp group.
4. Already-posted memes are tracked in `posted_memes.json` so duplicates are never sent.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Edit config.json — set your group name & accounts
#    (see below for details)

# 3. Test without WhatsApp (dry-run)
npm run dry-run

# 4. Run for real
npm start
#    → Scan the QR code with your phone
```

## Configuration (`config.json`)

| Key | Description | Default |
|---|---|---|
| `nitterInstance` | URL of a working Nitter instance | `https://nitter.privacydev.net` |
| `twitterAccounts` | Array of Twitter handles (no `@`) | `["maboroshi_flora", "NotFunnyAtAII"]` |
| `checkIntervalMinutes` | Minutes between checks | `10` |
| `whatsappGroupName` | Exact group name to post to | `"Meme Zone"` |
| `maxPostsPerCheck` | Max memes per cycle | `3` |

## ⚠️ Important Notes

- **Use a burner WhatsApp number.** Unofficial bots violate WhatsApp ToS; your number could be banned.
- **Nitter instances go down.** If feeds stop working, change `nitterInstance` in config. Check [status.d420.de](https://status.d420.de/) for live instances.

## Project Structure

```
whatsapp-meme-bot/
├── config.json          # Your settings
├── package.json
├── src/
│   ├── index.js         # Main entry point & scheduler
│   ├── fetcher.js       # Nitter RSS feed parser
│   ├── downloader.js    # Media file downloader
│   ├── store.js         # Duplicate tracking (JSON file)
│   └── whatsapp.js      # WhatsApp client wrapper
├── posted_memes.json    # Auto-generated: tracked tweet IDs
└── tmp/                 # Auto-generated: temp media files
```

## License

MIT
