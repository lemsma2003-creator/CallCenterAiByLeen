# CallCenterAiByLeen

A browser voice agent that answers calls for **Amman Smile Dental** (ابتسامة عمّان), a made-up dental clinic, in **Jordanian Arabic**. You talk to it from a web page; it answers questions about hours, branches, prices and policies, and takes booking details. It only answers from the clinic's knowledge base.

Built for learning with [Pipecat](https://github.com/pipecat-ai/pipecat). All clinic details are invented.

## How it works

| Part | What it does |
|---|---|
| `server/bot.py` | The Pipecat bot. Uses **OpenAI Realtime** (speech in, speech out, one model). Reads `knowledge.md` at the start of every call and serves the web page. |
| `server/knowledge.md` | Everything the bot knows about the clinic, in Jordanian colloquial Arabic. |
| `server/ui/` | The built web page the bot serves at `/client/`. Committed so the bot runs without Node. |
| `client/` | Source of the web page (Vite, vanilla JS, no runtime libraries). |

Browser and bot talk over **WebRTC** (Pipecat's SmallWebRTC transport). The page also gets live text of the conversation over the same connection.

Pages:
- `/client/` is the clinic page (Arabic by default, English toggle, dark/light theme).
- `/classic/` is the original Pipecat playground, kept for comparison.
- `/` redirects to `/client/`.

## Run it locally (Windows PowerShell)

You need [uv](https://docs.astral.sh/uv/) and an OpenAI API key.

1. Install the dependencies:
   ```powershell
   cd server
   uv sync
   ```
2. Create `server/.env` with your key (replace `YOUR_KEY`, keep it on one line):
   ```powershell
   Set-Content .env 'OPENAI_API_KEY=YOUR_KEY' -Encoding ascii
   Get-Content .env
   ```
   `.env` is git-ignored. Never commit it or paste the key anywhere.
3. Start the bot:
   ```powershell
   uv run bot.py -t webrtc --host 127.0.0.1
   ```
4. Wait for `Uvicorn running on http://127.0.0.1:7860`, open **http://127.0.0.1:7860/client/**, click **ابدأ المكالمة** (Start call) and allow the microphone.

The first call after starting the server takes a few seconds to connect.

## Edit the knowledge base

Open `server/knowledge.md` in any editor and change what you like: prices, branches, hours, FAQ. Save it as **UTF-8**. Then end the call and start a new one. The bot re-reads the file for every call, so you don't need to restart or change any code.

If the bot says it doesn't know something, that answer is missing from the file.

## Edit the web page

- Text in both languages (company name, buttons, messages): `client/src/i18n.js`
- Colors for both themes: the tokens at the top of `client/src/style.css`
- The animated orb: `client/src/orb.js`

To preview changes with live reload while the bot is running:
```powershell
cd client
npm install
npm run dev
```
Then open http://127.0.0.1:5173/. When you're done, build the page into `server/ui/` and commit it:
```powershell
npm run build
```

## Deploy

The bot deploys to Railway from `server/Dockerfile.railway`. It needs a TURN server for audio. See [DEPLOY.md](DEPLOY.md).
