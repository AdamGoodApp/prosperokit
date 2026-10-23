import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Token candidate shapes from plan Phase 6 §2. */
const CANDIDATE = /^!?-?[a-z][a-z0-9]*(?:-[a-z0-9.%#/[\]]+)*(?::[a-z][a-z0-9:-]*)?$/i
const VARIANT_FORM = /^[a-z-]+:[^\s]+$/

const SOURCE_FILE = /\.(?:[cm]?[tj]sx?)$/
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.tanstack'])
const GENERATED = /\.gen\.[cm]?[tj]sx?$/

const STRING_LITERAL = /"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'|`((?:\\.|[^`\\])*)`/g

/** Recursively list `.ts/.tsx/.js/.jsx` source files under `dir`. */
export function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(current, name)
      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) walk(full)
      else if (SOURCE_FILE.test(name) && !GENERATED.test(name)) out.push(full)
    }
  }
  walk(dir)
  return out.sort()
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
}

export function isCandidate(word: string): boolean {
  return CANDIDATE.test(word) || VARIANT_FORM.test(word)
}

/** Add every class-token candidate found in string literals of `source`. */
export function collectCandidates(source: string, into: Set<string>): void {
  for (const match of stripComments(source).matchAll(STRING_LITERAL)) {
    const text = match[1] ?? match[2] ?? match[3] ?? ''
    // `${…}` template holes are not class text.
    const plain = match[3] === undefined ? text : text.replace(/\$\{[^}]*\}/g, ' ')
    for (const word of plain.split(/\s+/)) {
      if (word !== '' && isCandidate(word)) into.add(word)
    }
  }
}

export function scanDirectories(dirs: readonly string[]): Set<string> {
  const candidates = new Set<string>()
  for (const dir of dirs) {
    for (const file of listSourceFiles(dir)) {
      collectCandidates(readFileSync(file, 'utf8'), candidates)
    }
  }
  return candidates
}
