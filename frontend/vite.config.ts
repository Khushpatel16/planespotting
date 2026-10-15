import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Backend runs on :8000 in local dev. Proxy API + WebSocket so the frontend can use
// same-origin relative URLs (which also makes the single-service production build work).
const BACKEND = process.env.VITE_BACKEND ?? "http://127.0.0.1:8000";

// `npm run dev:phone` sets HWL_HTTPS=1: serves HTTPS on the LAN so a phone can use the
// camera/compass (Sky View needs a secure context away from localhost).
const HTTPS = !!process.env.HWL_HTTPS;

export default defineConfig({
  plugins: [react(), ...(HTTPS ? [basicSsl()] : [])],
  server: {
    port: 5173,
    host: HTTPS ? true : undefined,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/uploads": { target: BACKEND, changeOrigin: true },
      "/ws": { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { maplibre: ["maplibre-gl"] },
      },
    },
  },
});
