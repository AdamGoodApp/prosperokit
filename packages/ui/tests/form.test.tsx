import { act, renderNative } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import { useAppForm } from '@/components/ui/form'

function Demo({ onSubmit }: { onSubmit: (v: { name: string }) => void }) {
  const form = useAppForm({
    defaultValues: { name: '' },
    onSubmit: ({ value }) => onSubmit(value),
  })
  return (
    <form.AppForm>
      <form.AppField
        name="name"
        validators={{ onChange: ({ value }) => (value.length < 3 ? 'Too short' : undefined) }}
      >
        {(field) => <field.TextField label="Name" />}
      </form.AppField>
      <form.SubmitButton label="Save" />
    </form.AppForm>
  )
}

describe('form', () => {
  it('renders validation errors and submits valid values', async () => {
    const onSubmit = vi.fn()
    const r = renderNative(<Demo onSubmit={onSubmit} />)
    const input = r.find('field-name')
    expect(input).toBeTruthy()
    if (!input) return
    await act(() => r.fireEvent(input, 'change', { text: 'ab' }))
    expect(r.find('field-error')?.text).toBe('Too short')
    await act(() => r.fireEvent(input, 'change', { text: 'abcd' }))
    expect(r.find('field-error')).toBeNull()
    const submit = r.find('form-submit')
    if (submit) await act(() => r.fireEvent(submit, 'press'))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'abcd' })
  })
})
