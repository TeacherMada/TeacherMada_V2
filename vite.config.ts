
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, (process as any).cwd(), '');

  // Prioritize VITE_GOOGLE_API_KEY (from Render/User) or fallback to API_KEY
  const apiKey = env.GEMINI_API_KEY || env.VITE_GOOGLE_API_KEY || env.API_KEY || '';

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['logo.svg', 'logo.png'],
        manifest: {
          name: "TeacherMada AI",
          short_name: "TeacherMada",
          description: "Apprenez les langues intelligemment avec votre professeur IA personnel.",
          theme_color: "#4f46e5",
          background_color: "#0f172a",
          display: "standalone",
          orientation: "portrait",
          icons: [
            {
              src: "/logo.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any maskable"
            },
            {
              src: "/logo.png",
              sizes: "512x512",
              type: "image/png"
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          navigateFallback: '/index.html',
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // Network Only for API and Supabase to ensure fresh data
              urlPattern: ({ url }) => url.hostname.includes('supabase.co') || url.pathname.includes('/api/'),
              handler: 'NetworkOnly',
            },
            {
              // Cache external images (e.g., flags, avatars)
              urlPattern: ({ url }) => url.hostname.includes('flagcdn.com') || url.hostname.includes('dicebear.com') || url.hostname.includes('ibb.co'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'external-images',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 30 // 30 Days
                }
              }
            }
          ]
        }
      })
    ],
    define: {
      // Stringify the API key to inject it into the client code
      'process.env.API_KEY': JSON.stringify(apiKey),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || apiKey),
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-markdown', 'remark-gfm'],
            'vendor-ui': ['lucide-react'],
            'vendor-ai': ['@google/genai'],
            'vendor-db': ['@supabase/supabase-js'],
          }
        }
      }
    }
  }
})