/** Error thrown by every native call. `code` is a stable machine-readable string (`ENOSYS`, `ENODEVICE`, `ETIMEDOUT`, `EBUSY`, `EFORMAT`, `ENOENT`, `EPLATFORM`, …). */
export class NativeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'NativeError'
    this.code = code
  }
}

/** Converts whatever the bridge or the dev relay delivered as an error into a `NativeError`. */
export function toNativeError(raw: unknown): NativeError {
  if (raw instanceof NativeError) return raw
  if (typeof raw === 'string') return new NativeError('EUNKNOWN', raw)
  if (raw !== null && typeof raw === 'object') {
    const { code, message } = raw as { code?: unknown; message?: unknown }
    return new NativeError(
      typeof code === 'string' ? code : 'EUNKNOWN',
      typeof message === 'string' ? message : String(raw),
    )
  }
  return new NativeError('EUNKNOWN', String(raw))
}
