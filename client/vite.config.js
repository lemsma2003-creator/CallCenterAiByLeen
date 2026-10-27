import { defineConfig } from "vite";

// The bot (Pipecat runner) serves this build at /client/.
// `npm run dev` proxies the bot's endpoints so you can work on the UI with hot reload.
const BOT = "http://127.0.0.1:7860";

export default defineConfig({
  base: "./",
  build: {
    outDir: "../server/ui",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/start": BOT,
      "/status": BOT,
      "/sessions": BOT,
      "/api": BOT,
    },
  },
});
