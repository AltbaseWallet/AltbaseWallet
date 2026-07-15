import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'cli/altbase-cli.ts',
    outDir: 'cli-dist',
    emptyOutDir: true,
    target: 'node20',
    sourcemap: false,
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: 'altbase-cli.mjs',
        chunkFileNames: 'chunks/[name]-[hash].mjs',
        format: 'esm',
      },
    },
  },
})
