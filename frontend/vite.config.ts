import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the Vite server (5173) forwards /api to Flask (5050), so the
// browser sees a single origin and session cookies just work.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:5050", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 900 },
});
