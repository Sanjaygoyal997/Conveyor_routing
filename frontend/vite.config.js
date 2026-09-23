import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: http://localhost:3000 (the origin SmartMES_ReportAPI already allows), /api proxied to the .NET API.
// Build: `npm run build` -> the API's wwwroot (the API serves the UI);
//        `npm run build:iis` -> dist/ for a separate IIS site (API address in dist/config.js).
// base "./": relative asset paths, so the UI also works in an IIS sub-application (http://server/rimvalidation/).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 3000,
    proxy: { "/api": process.env.API_URL || "http://localhost:5080" },
  },
  build: {
    outDir: "../backend/ConveyorRouting.Api/wwwroot",
    emptyOutDir: true,
  },
});
