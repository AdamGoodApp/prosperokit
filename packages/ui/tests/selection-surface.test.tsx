import { setClassResolver } from '@prosperokit/react'
import { renderNative, type TestNode } from '@prosperokit/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Item } from '@/components/ui/item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Record class names so the classes sent to the engine can be read back.
const names: string[] = []
function idOf(name: string): number {
  const at = names.indexOf(name)
  if (at !== -1) return at
  names.push(name)
  return names.length - 1
}

beforeEach(() => setClassResolver((className) => className.split(/\s+/).filter(Boolean).map(idOf)))
afterEach(() => setClassResolver(() => []))

function textNodes(node: TestNode): TestNode[] {
  const out = node.type === 'Text' ? [node] : []
  for (const child of node.children) out.push(...textNodes(child))
  return out
}

describe('controls in a focused Item row', () => {
  it('render the Select value in the selection text colour while the row is focused', () => {
    const r = renderNative(
      <Item
        testID="row"
        title="Theme accent"
        trailing={
          <Select defaultValue="blue">
            <SelectTrigger testID="trigger" focusable={false}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blue">blue</SelectItem>
            </SelectContent>
          </Select>
        }
      />,
    )
    const row = r.find('row')
    const trigger = r.find('trigger')
    if (!row || !trigger) throw new Error('missing nodes')
    const label = () => {
      const [value] = textNodes(trigger)
      if (!value) throw new Error('missing value text')
      return ((value.props.classes as number[] | undefined) ?? []).map((id) => names[id] ?? '?')
    }

    expect(label()).toContain('text-ps-text')
    r.fireEvent(row, 'focus')
    expect(label()).toContain('text-ps-on-selection')
    expect(label()).not.toContain('text-ps-text')
    r.fireEvent(row, 'blur')
    expect(label()).toContain('text-ps-text')
  })
})
