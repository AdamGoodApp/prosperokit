// Writes `registry.json` from `registry/*.tsx` (see registry-lib.mjs).
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildRegistry } from './registry-lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const entries = buildRegistry(`${root}registry`)
writeFileSync(`${root}registry.json`, `${JSON.stringify(entries, null, 2)}\n`)
console.log(`registry.json: ${entries.length} components`)
