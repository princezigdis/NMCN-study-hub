import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// BASE: "/" on a custom domain; "/nmcn-study-hub/" on the free GitHub project address.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          supabase: ["@supabase/supabase-js"],
          markdown: ["marked", "dompurify"],
        },
      },
    },
  },
});
