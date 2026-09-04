import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base path — GitHub Pages serves project sites from a subdirectory
  // (username.github.io/repo-name/), not the domain root, and Vite defaults to
  // assuming root-level serving. Without this, every built asset path 404s once
  // deployed. Relative works regardless of the repo's name or how deep it's
  // served from, and this app has no client-side URL routing to conflict with it.
  base: "./",
  plugins: [react()],
});
