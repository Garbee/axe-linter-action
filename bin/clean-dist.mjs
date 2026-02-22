import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const distPath = resolve(import.meta.dirname, '..', 'dist')

try {
  rmSync(distPath, { recursive: true })
} catch (error) {
  console.error(`Failed to clean dist directory: ${error.message}`)
}
