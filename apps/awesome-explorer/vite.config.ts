import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The UI lives in src/web and builds to dist/web, which the server serves in
// production. Paths are absolute so the server can load this file from any cwd.
export default defineConfig({
  root: `${import.meta.dirname}/src/web`,
  plugins: [react()],
  build: {
    outDir: `${import.meta.dirname}/dist/web`,
    emptyOutDir: true,
  },
});
