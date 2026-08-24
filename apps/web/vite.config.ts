import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: resolve(import.meta.dirname, "../../redesign-v2/assets"),
  server: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/api": process.env.API_TARGET ?? "http://127.0.0.1:4100",
    },
  },
});
