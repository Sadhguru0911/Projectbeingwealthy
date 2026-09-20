import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));

export default defineConfig({
  // Relative base path — GitHub Pages serves project sites from a subdirectory
  // (username.github.io/repo-name/), not the domain root, and Vite defaults to
  // assuming root-level serving. Without this, every built asset path 404s once
  // deployed. Relative works regardless of the repo's name or how deep it's
  // served from, and this app has no client-side URL routing to conflict with it.
  base: "./",
  plugins: [react()],
  define: {
    // Read directly from package.json at build time, so the version shown in the
    // app header can never drift from what's actually being shipped.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // Explicit, not just relying on Vite's default: a source map would ship a
    // fully readable, unminified copy of the original source alongside the
    // production build, visible to anyone in browser dev tools. This is
    // already Vite's default, but stated here so a future config change can't
    // silently re-enable it without someone noticing what it trades away.
    sourcemap: false,
  },
});
