import { Text } from '@prosperokit/react'
import { renderNative } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

function sample(props: Parameters<typeof Accordion>[0]) {
  return (
    <Accordion {...props}>
      <AccordionItem value="a">
        <AccordionTrigger>First</AccordionTrigger>
        <AccordionContent>
          <Text testID="body-a">Body A</Text>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>Second</AccordionTrigger>
        <AccordionContent>
          <Text testID="body-b">Body B</Text>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

describe('Accordion', () => {
  it('press toggles an item (multiple mode keeps the others open)', () => {
    const onValueChange = vi.fn()
    const r = renderNative(sample({ type: 'multiple', onValueChange }))
    const a = r.find('accordion-trigger-a')
    const b = r.find('accordion-trigger-b')
    if (!a || !b) throw new Error('missing trigger')
    expect(r.find('body-a')).toBeNull()
    r.fireEvent(a, 'press')
    r.fireEvent(b, 'press')
    expect(r.find('body-a')).not.toBeNull()
    expect(r.find('body-b')).not.toBeNull()
    expect(onValueChange).toHaveBeenLastCalledWith(['a', 'b'])
    r.fireEvent(a, 'press')
    expect(r.find('body-a')).toBeNull()
    expect(r.find('body-b')).not.toBeNull()
  })

  it('single mode closes the other item', () => {
    const r = renderNative(sample({ type: 'single', defaultValue: 'a' }))
    expect(r.find('body-a')).not.toBeNull()
    const b = r.find('accordion-trigger-b')
    if (!b) throw new Error('missing trigger')
    r.fireEvent(b, 'press')
    expect(r.find('body-a')).toBeNull()
    expect(r.find('body-b')).not.toBeNull()
  })

  it('single mode only closes the open item when collapsible', () => {
    const closed = renderNative(sample({ defaultValue: 'a' }))
    const a = closed.find('accordion-trigger-a')
    if (!a) throw new Error('missing trigger')
    closed.fireEvent(a, 'press')
    expect(closed.find('body-a')).not.toBeNull()
    closed.unmount()

    const onValueChange = vi.fn()
    const r = renderNative(sample({ collapsible: true, defaultValue: 'a', onValueChange }))
    const trigger = r.find('accordion-trigger-a')
    if (!trigger) throw new Error('missing trigger')
    r.fireEvent(trigger, 'press')
    expect(r.find('body-a')).toBeNull()
    expect(onValueChange).toHaveBeenLastCalledWith('')
  })
})

describe('Collapsible', () => {
  it('mounts the content only while open', () => {
    const onOpenChange = vi.fn()
    const r = renderNative(
      <Collapsible onOpenChange={onOpenChange}>
        <CollapsibleTrigger>More</CollapsibleTrigger>
        <CollapsibleContent>
          <Text testID="more">Hidden</Text>
        </CollapsibleContent>
      </Collapsible>,
    )
    expect(r.find('more')).toBeNull()
    const trigger = r.find('collapsible-trigger')
    if (!trigger) throw new Error('missing trigger')
    r.fireEvent(trigger, 'press')
    expect(r.find('more')?.text).toBe('Hidden')
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    r.fireEvent(trigger, 'press')
    expect(r.find('more')).toBeNull()
  })
})
