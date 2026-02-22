import { resolve } from 'node:path'
import { defineConfig } from 'rolldown'

export default defineConfig({
  input: 'src/index.ts',
  platform: 'node',
  output: {
    file: resolve(import.meta.dirname, 'dist', 'index.js')
  }
})
