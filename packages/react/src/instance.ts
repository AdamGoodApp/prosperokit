import type { HostType, NativeHandle } from './types.js'

export interface Container {
  id: number
  children: Instance[]
}

export type Dir = 'Up' | 'Down' | 'Left' | 'Right'

export interface Instance {
  /** 0 until the instance is emitted to the engine at the end of the commit that attaches it. */
  id: number
  type: HostType | 'rawtext'
  props: Record<string, any>
  /** The props last sent (or about to be sent) to the engine. */
  wire: Record<string, unknown>
  parent: Instance | Container | null
  children: Instance[]
  /** rawtext content. */
  text: string
  emitted: boolean
  hidden: boolean
  handle: NativeHandle | null
  sentNextFocus: Partial<Record<Dir, number>>
}

export const instances = new Map<number, Instance>()

export function isContainer(x: Instance | Container | null): x is Container {
  return x !== null && !('wire' in x)
}

export function parentInstance(inst: Instance): Instance | null {
  const p = inst.parent
  return p && !isContainer(p) ? p : null
}
