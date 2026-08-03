import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  publicDir: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    target: "chrome102",
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(
        new URL("src/content/bootstrap.ts", import.meta.url),
      ),
      name: "AiDlpContentScript",
      formats: ["iife"],
      fileName: () => "content-script.js",
    },
  },
});
