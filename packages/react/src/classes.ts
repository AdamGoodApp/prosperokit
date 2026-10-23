/**
 * `className` → token ids. `@prosperokit/tailwind` owns the real resolver
 * (it needs the table injected by the Vite plugin), so this package takes it
 * by injection: the Vite preset / app entry calls `setClassResolver`.
 */

export type ClassResolverFn = (className: string) => number[]

export type ClassResolver =
  | (ClassResolverFn & { props?: (className: string) => Record<string, unknown> | undefined })
  | {
      classes(className: string): number[]
      props?(className: string): Record<string, unknown> | undefined
    }

let resolver: ClassResolver = () => []

export function setClassResolver(next: ClassResolver): void {
  resolver = next
}

export function resolveClassIds(className: string): number[] {
  return typeof resolver === 'function' ? resolver(className) : resolver.classes(className)
}

/** Host props contributed by class tokens (e.g. `numberOfLines` from `line-clamp-2`). */
export function resolveClassHostProps(className: string): Record<string, unknown> | undefined {
  return resolver.props?.(className)
}
