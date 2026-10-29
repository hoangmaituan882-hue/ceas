import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { fixtures } from "./vite.fixtures";

/* 私人素材必须由本机显式指定；公开仓库和首次运行不绑定作者的目录。 */
const FIXTURES_DIR = process.env.CEAS_FIXTURES;

export default defineConfig({
  plugins: [react(), fixtures(FIXTURES_DIR)],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: true },
});
