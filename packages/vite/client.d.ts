declare module 'virtual:prosperokit-classes' {
  /** `{ "<token>": id }`, ids index `app.styles.json`'s `styles`. */
  const tokens: Record<string, number>
  export default tokens
}

declare module 'virtual:prosperokit-class-table' {
  /** Argument for `setClassTable` / `createResolver` from `@prosperokit/tailwind/runtime`. */
  const table: {
    tokens: Record<string, number>
    props: Record<string, Record<string, unknown>>
  }
  export default table
}
