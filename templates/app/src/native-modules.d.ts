import '@prosperokit/native'

declare module '@prosperokit/native' {
  /** Custom module implemented in `native/example-module` (Rust). */
  interface CustomModules {
    example: {
      add(args: { a: number; b: number }): Promise<{ sum: number }>
    }
  }
}
