import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// Security headers for the built web app (docs/security/security-review.md). The production
// host must send the same headers; `vite preview` applies them so the e2e `pwa` project runs the
// production bundle under this policy. Not applied to the dev server, whose HMR client needs more.
export const webSecurityHeaders: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// PWA policy: docs/engineering/pwa.md.
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      // A new version waits until the learner chooses to reload (UpdateBanner), so an update never
      // interrupts a practice session.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'TapTalk language practice',
        short_name: 'TapTalk',
        description: 'A focused English and German practice space.',
        lang: 'en',
        categories: ['education'],
        theme_color: '#f5f1e8',
        background_color: '#f5f1e8',
        display: 'standalone',
        start_url: '/practice',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Only the static app shell is cached. API responses carry user data and are never cached.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  preview: {
    headers: webSecurityHeaders,
  },
  server: {
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    },
  },
});
