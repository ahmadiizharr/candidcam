import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

const page = (name) => resolve(import.meta.dirname, `${name}.html`)

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: process.env.CANDID_OUT_DIR || 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: page('index'), app: page('app'), guest: page('guest'), display: page('display'), 404: page('404') },
    },
  },
  server: { proxy: { '/api': 'http://127.0.0.1:8094', '/media': 'http://127.0.0.1:8094' } },
})
