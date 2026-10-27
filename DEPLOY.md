# Deploying to Railway

The bot runs as one Docker container on [Railway](https://railway.com). Railway builds it from `server/Dockerfile.railway` every time you push to `main`.

## 1. Get free TURN credentials (Metered)

The browser sends and receives audio over WebRTC, which normally uses UDP. Railway doesn't accept inbound UDP, so the audio has to go through a **TURN server** that relays it. Without TURN the page loads, but the call stays on "Connecting" or you hear nothing.

1. Sign up for free at [Metered](https://www.metered.ca/stun-turn).
2. In the dashboard, create a TURN credential.
3. Copy the server addresses, the **username** and the **password** it shows you.

Put these **only** in Railway's variables. Never put them in this repo, and never paste them into a chat.

## 2. Build the `PIPECAT_ICE_SERVERS` value

It's a JSON list: one STUN entry, then the TURN server over UDP, TCP and TLS (port 443). Replace `USERNAME` and `PASSWORD`, and use the exact hostnames from your Metered dashboard if they differ:

```json
[
  {"urls": "stun:stun.relay.metered.ca:80"},
  {"urls": "turn:global.relay.metered.ca:80", "username": "USERNAME", "credential": "PASSWORD"},
  {"urls": "turn:global.relay.metered.ca:80?transport=tcp", "username": "USERNAME", "credential": "PASSWORD"},
  {"urls": "turn:global.relay.metered.ca:443", "username": "USERNAME", "credential": "PASSWORD"},
  {"urls": "turns:global.relay.metered.ca:443?transport=tcp", "username": "USERNAME", "credential": "PASSWORD"}
]
```

Railway's variable box accepts it on one line as well.

## 3. Create the Railway service

1. In Railway: **New Project → Deploy from GitHub repo →** `CallCenterAiByLeen`.
2. Open the service **Settings** and set **Root Directory** to `server`.
3. Open **Variables** and add:

| Variable | Value |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.railway` |
| `PORT` | `7860` |
| `OPENAI_API_KEY` | your OpenAI key |
| `PIPECAT_ICE_SERVERS` | the JSON from step 2 |

4. Open **Settings → Networking → Generate Domain** and set the port to `7860`.
5. Wait for the deploy to finish, then open `https://<your-domain>/client/`.

Useful checks once it's up:
- `https://<your-domain>/status` should answer with JSON.
- `https://<your-domain>/client/` should show the clinic page.

## Build the image locally first (optional, needs Docker)

From the `server` folder. Use `--env-file`, because PowerShell strips the quotes from JSON passed with `-e`:

```powershell
docker build -f Dockerfile.railway -t callcenter-bot .
docker run --rm -p 7861:7860 -e PORT=7860 --env-file .env callcenter-bot
```

Then check http://127.0.0.1:7861/status, http://127.0.0.1:7861/client/ and that the page's call connects. Port 7861 is used so it doesn't clash with a bot already running on 7860.

## Cost

Railway bills by usage (CPU, memory, network). The image is large (roughly 2.5 GB, because of WebRTC and video libraries), and the bot needs more memory than the free plan's limit, so expect to need a paid plan.

## After changing things

- **Knowledge base or bot:** commit and push. Railway redeploys on every push.
- **Web page:** run `npm run build` in `client/` first, then commit the updated `server/ui/` and push.

## Security notes

- **TURN credentials are visible to visitors.** The page gets them from `/start` so the browser can use the relay. Anyone who opens the site can read them. Use a free Metered account, and rotate the credentials if they leak.
- **The code is public** if the repo is public. That's fine, as long as keys only ever live in Railway variables and the git-ignored `server/.env`.
- Anyone with the link can start calls, and every call costs OpenAI usage. Delete the domain or pause the service when you're not demoing.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Page loads but the call stays on "Connecting", or is silent | Wrong or missing `PIPECAT_ICE_SERVERS` (check the JSON, the username and the password) |
| Build fails right away, "Dockerfile not found" | Root Directory isn't `server`, or `RAILWAY_DOCKERFILE_PATH` is missing |
| Deploy crashes with `KeyError: 'OPENAI_API_KEY'` | The `OPENAI_API_KEY` variable isn't set |
| Domain shows "Application failed to respond" | Domain port isn't `7860`, or `PORT` isn't set |
| The first call takes about 10 seconds | Normal: the first connection after a deploy warms up |
