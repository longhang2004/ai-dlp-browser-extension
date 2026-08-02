import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const isClaudeEntry = process.env.AI_DLP_CONTENT_ENTRY === "claude";

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
        new URL(
          isClaudeEntry
            ? "src/content/claude-index.ts"
            : "src/content/chatgpt-index.ts",
          import.meta.url,
        ),
      ),
      name: isClaudeEntry ? "AiDlpClaudeContentScript" : "AiDlpContentScript",
      formats: ["iife"],
      fileName: () =>
        isClaudeEntry ? "content-claude.js" : "content-script.js",
    },
  },
});
