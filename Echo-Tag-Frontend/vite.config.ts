import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { compression } from 'vite-plugin-compression2'
import { visualizer } from 'rollup-plugin-visualizer'

// Load-time strategy (see docs/PERFORMANCE_BUDGET.md):
//  - `boot` chunk is tiny and self-sufficient: paints the arena preview + Play button.
//  - `engine` (PixiJS) and `game` chunks are prefetched in parallel, never block first paint.
//  - No image/font/audio assets are fetched at all; every visual is generated at runtime.
export default defineConfig(({ mode }) => ({
  plugins: [
    preact(),
    // Poki serves prebuilt static files; ship precompressed so their CDN can serve them directly.
    compression({ algorithms: ['brotliCompress', 'gzip'], threshold: 1024 }),
    mode === 'analyze' && visualizer({ filename: 'stats.html', gzipSize: true, brotliSize: true }),
  ].filter(Boolean),

  build: {
    target: 'es2022',
    cssTarget: 'chrome111',
    // Raw-size warning only. The real gate is brotli size in `npm run size`, where the
    // PixiJS chunk measures ~83KB against a 160KB budget.
    chunkSizeWarningLimit: 400,
    assetsInlineLimit: 4096,
    modulePreload: { polyfill: false },
    reportCompressedSize: true,
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // Deterministic, hashed, immutable-cacheable filenames.
        entryFileNames: 'a/[name].[hash].js',
        chunkFileNames: 'a/[name].[hash].js',
        assetFileNames: 'a/[name].[hash][extname]',
        manualChunks(id) {
          if (id.includes('pixi.js')) return 'engine'
          if (id.includes('@colyseus')) return 'net'
          if (id.includes('preact') || id.includes('zustand')) return 'ui'
          return undefined
        },
      },
    },
  },

  server: { port: 5173, host: true },
}))
