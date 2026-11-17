/**
 * Unit/render test build: compiles every `src/**\/*.test.ts(x)` to an ES
 * module in .test-dist/, then Node's built-in runner executes them
 * (`npm test`). No extra test dependencies are needed.
 */
import react from '@vitejs/plugin-react'
import { globSync } from 'node:fs'
import { defineConfig } from 'vite'

const entries = Object.fromEntries(
  globSync('src/**/*.test.{ts,tsx}').map((f) => [f.replace(/^src\//, '').replace(/\.tsx?$/, ''), f]),
)

export default defineConfig({
  plugins: [react()],
  build: {
    ssr: true,
    outDir: '.test-dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      input: entries,
      output: { format: 'es', entryFileNames: '[name].mjs' },
    },
  },
})
