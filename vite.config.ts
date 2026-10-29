import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

// ffmpeg-static / @ffprobe-installer locate their .exe relative to their own
// package folder, so they must stay external (never bundled).
const mainExternals = ["electron", "node:sqlite", "ffmpeg-static", "@ffprobe-installer/ffprobe"];

export default defineConfig({
  root: ".",
  plugins: [
    react(),
    electron({
      main: {
        entry: "src/main/index.ts",
        vite: {
          build: {
            outDir: "dist-electron/main",
            rollupOptions: { external: mainExternals },
          },
        },
      },
      preload: {
        input: "src/main/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron/preload",
            rollupOptions: {
              output: {
                format: "cjs",
                entryFileNames: "preload.cjs",
                inlineDynamicImports: true,
              },
              external: ["electron"],
            },
          },
        },
      },
    }),
  ],
  build: {
    outDir: "dist",
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
