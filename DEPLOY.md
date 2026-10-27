# Deploying to Railway

> Work in progress. The Railway files (`server/Dockerfile.railway`, `server/.dockerignore`, `server/uv.lock`) are added in the deploy step. This page lists what that step will set up.

## Why a TURN server is needed

The browser sends and receives audio over WebRTC, which normally uses UDP. Railway doesn't accept inbound UDP, so the audio has to be relayed through a **TURN server**. Without one, the page loads but the call stays on "Connecting" and you hear nothing.

A free TURN account from [Metered](https://www.metered.ca/stun-turn) gives you a server URL, a username and a password. Put them **only** in Railway's variables, never in this repo.

## Railway settings

| Setting | Value |
|---|---|
| Root Directory | `server` |
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.railway` |
| `PORT` | `7860` |
| `OPENAI_API_KEY` | your OpenAI key |
| `PIPECAT_ICE_SERVERS` | JSON list with one STUN entry and the TURN entries over UDP, TCP and TLS (port 443) |
| Networking | Generate Domain, port `7860` |

## Things to know

- **Cost:** Railway bills by usage. The bot's image is large (a few GB), so the free plan's memory limit is probably too small.
- **Redeploys:** Railway redeploys on every push. After changing the web page, run `npm run build` in `client/` and commit the updated `server/ui/`.
- **TURN credentials are visible:** the page fetches them from `/start`, so anyone who opens the site can read them. Use a free TURN account, and rotate its credentials if they leak.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Page loads, call stays on "Connecting" or is silent | Wrong or missing TURN settings in `PIPECAT_ICE_SERVERS` |
| Build fails right away | Root Directory isn't set to `server` |
