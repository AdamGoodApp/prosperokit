import { describe, expect, it } from 'vitest'
import { createRebuildQueue } from './rebuild-queue.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('rebuild queue', () => {
  it('debounces bursts into one build', async () => {
    const batches: string[][] = []
    const q = createRebuildQueue({ debounceMs: 20, build: async (r) => void batches.push(r) })
    q.trigger('a')
    q.trigger('b')
    q.trigger('c')
    await q.idle()
    expect(batches).toEqual([['a', 'b', 'c']])
  })

  it('serializes and queues changes made during a build', async () => {
    let active = 0
    let maxActive = 0
    const batches: string[][] = []
    const q = createRebuildQueue({
      debounceMs: 10,
      build: async (r) => {
        active++
        maxActive = Math.max(maxActive, active)
        batches.push(r)
        await sleep(60)
        active--
      },
    })
    q.trigger('first')
    await sleep(30) // build is running
    q.trigger('second')
    q.trigger('third')
    await q.idle()
    expect(maxActive).toBe(1)
    expect(batches).toEqual([['first'], ['second', 'third']])
  })

  it('keeps going after a failed build and reports the error', async () => {
    const errors: unknown[] = []
    let n = 0
    const q = createRebuildQueue({
      debounceMs: 5,
      onError: (e) => errors.push(e),
      build: async () => {
        n++
        if (n === 1) throw new Error('boom')
      },
    })
    q.trigger()
    await q.idle()
    q.trigger()
    await q.idle()
    expect(n).toBe(2)
    expect(errors).toHaveLength(1)
  })

  it('ignores triggers after close', async () => {
    let n = 0
    const q = createRebuildQueue({ debounceMs: 5, build: async () => void n++ })
    q.close()
    q.trigger()
    await q.idle()
    await sleep(20)
    expect(n).toBe(0)
  })
})
