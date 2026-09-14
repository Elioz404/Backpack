import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Served by @convex-dev/static-hosting from the deployment root.
    outDir: "dist",
    sourcemap: false,
  },
});
