// Minimal terminal output. Colours are off when NO_COLOR is set or stdout is not a TTY.

function useColor(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true
  return Boolean(process.stdout.isTTY)
}

function paint(code: number, text: string): string {
  return useColor() ? `\u001b[${code}m${text}\u001b[0m` : text
}

export const style = {
  bold: (s: string) => paint(1, s),
  dim: (s: string) => paint(2, s),
  red: (s: string) => paint(31, s),
  green: (s: string) => paint(32, s),
  yellow: (s: string) => paint(33, s),
  cyan: (s: string) => paint(36, s),
}

export const log = {
  info(msg: string): void {
    console.log(msg)
  },
  warn(msg: string): void {
    console.warn(`${style.yellow('warn')} ${msg}`)
  },
  error(msg: string): void {
    console.error(`${style.red('error')} ${msg}`)
  },
  step(msg: string): void {
    console.log(`${style.cyan('==>')} ${style.bold(msg)}`)
  },
}

export function ok(msg: string): void {
  console.log(`${style.green('✓')} ${msg}`)
}
