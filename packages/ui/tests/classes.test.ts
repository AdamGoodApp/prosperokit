import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileToken } from '@prosperokit/tailwind'
import { parseAst } from 'vite'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !name.includes('.test.')) {
      out.push(full)
    }
  }
  return out.sort()
}

type Node = { type: string; [key: string]: unknown }

/** Names whose initialisers / arguments hold class strings. */
const CLASS_NAME = /class|variants$|^(focus|press|disabled|transition)[A-Z]/i
const TS_VALUE_WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
])
const CLASS_CALLEES = new Set(['cn', 'cva', 'clsx', 'twMerge'])

function nameOf(node: Node): string | undefined {
  switch (node.type) {
    case 'JSXAttribute':
      return (node.name as { name?: string }).name
    case 'VariableDeclarator':
      return (node.id as { name?: string }).name
    case 'FunctionDeclaration':
      return (node.id as { name?: string } | null)?.name
    case 'Property':
    case 'PropertyDefinition': {
      const key = node.key as { name?: string; value?: string }
      return key.name ?? key.value
    }
    default:
      return undefined
  }
}

function nameOf2(node: Node): string | undefined {
  return node.type === 'Identifier' ? (node.name as string) : undefined
}

function inClassContext(ancestors: Node[]): boolean {
  for (const node of ancestors) {
    if (node.type === 'CallExpression') {
      const callee = node.callee as { type: string; name?: string }
      // A string passed to any other function is an argument, not class text.
      return callee.type === 'Identifier' && !!callee.name && CLASS_CALLEES.has(callee.name)
    }
    // Default parameter values and cva `defaultVariants` select variants; they are not classes.
    if (node.type === 'AssignmentPattern') return CLASS_NAME.test(nameOf2(node.left as Node) ?? '')
    const name = nameOf(node)
    if (name === 'defaultVariants') return false
    if (name !== undefined && CLASS_NAME.test(name)) return true
  }
  return false
}

function isNonClassPosition(node: Node, parent: Node | undefined): boolean {
  if (!parent) return false
  if (parent.type === 'Property' && parent.key === node) return true
  if (parent.type === 'SwitchCase' && parent.test === node) return true
  if (parent.type === 'BinaryExpression') {
    const op = parent.operator
    return op === '===' || op === '!==' || op === '==' || op === '!='
  }
  return false
}

/**
 * Strings outside class positions (helpers returning class text) still count
 * when one of their hyphenated or variant-prefixed words is a real utility.
 */
function looksLikeClasses(text: string): boolean {
  return text.split(/\s+/).some((w) => /[-:]/.test(w) && compileToken(w) !== null)
}

/** Every whitespace-separated word of every class-position string literal, per file. */
export function extractClassTokens(file: string): Map<string, string> {
  const program = parseAst(readFileSync(file, 'utf8'), { lang: file.endsWith('x') ? 'tsx' : 'ts' })
  const tokens = new Map<string, string>()
  const add = (text: string) => {
    for (const word of text.split(/\s+/)) if (word !== '') tokens.set(word, file)
  }
  const visit = (node: unknown, ancestors: Node[]) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, ancestors)
      return
    }
    if (!node || typeof node !== 'object') return
    const n = node as Node
    if (typeof n.type !== 'string') return
    const parent = ancestors[0]
    if (n.type === 'Literal' && typeof n.value === 'string') {
      if (parent?.type === 'ImportDeclaration' || parent?.type === 'ExportNamedDeclaration') return
      if (
        !isNonClassPosition(n, parent) &&
        (inClassContext(ancestors) || looksLikeClasses(n.value))
      ) {
        add(n.value)
      }
      return
    }
    if (n.type === 'TemplateElement') {
      const text = (n.value as { cooked: string }).cooked
      if (inClassContext(ancestors) || looksLikeClasses(text)) add(text)
      return
    }
    // Type positions hold string-literal types, never classes.
    if (n.type.startsWith('TS') && !TS_VALUE_WRAPPERS.has(n.type)) return
    const next = [n, ...ancestors]
    for (const [key, value] of Object.entries(n)) {
      if (key === 'type' || key === 'start' || key === 'end') continue
      visit(value, next)
    }
  }
  visit(program, [])
  return tokens
}

describe('class strings', () => {
  const files = [...sourceFiles(join(root, 'registry')), ...sourceFiles(join(root, 'src'))]

  it('finds class strings to check', () => {
    const all = new Map<string, string>()
    for (const f of files) for (const [t, file] of extractClassTokens(f)) all.set(t, file)
    expect(all.size).toBeGreaterThan(50)
    expect(all.has('focus:scale-[1.08]')).toBe(true)
  })

  it('every class compiles with the native styler', () => {
    const failures: string[] = []
    for (const file of files) {
      for (const token of extractClassTokens(file).keys()) {
        if (compileToken(token) === null) failures.push(`${relative(root, file)}: ${token}`)
      }
    }
    expect(failures).toEqual([])
  })
})
