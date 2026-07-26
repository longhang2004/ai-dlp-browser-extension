import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "chrome102",
    modulePreload: false,
    rolldownOptions: {
      input: {
        popup: fileURLToPath(new URL("popup.html", import.meta.url)),
        options: fileURLToPath(new URL("options.html", import.meta.url)),
        audit: fileURLToPath(new URL("audit.html", import.meta.url)),
        background: fileURLToPath(
          new URL("src/background/bootstrap.ts", import.meta.url),
        ),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background.js"
            : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
