import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: http://localhost:3000 (the origin SmartMES_ReportAPI already allows), /api proxied to the .NET API.
// Build: output goes straight into the API's wwwroot, so the API serves the UI.
export default defineConfig({
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
