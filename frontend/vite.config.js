import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Only for `npm run dev`. In Docker, Kong serves both the app and /api on one origin.
  server: { proxy: { '/api': 'http://localhost:8000' } },
});
