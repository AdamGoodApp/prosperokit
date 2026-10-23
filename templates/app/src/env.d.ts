/// <reference types="@prosperokit/vite/client" />

/** Set by the host before the UI bundle runs (dev reload keeps the current route). */
declare var __PK_INITIAL_HREF: string | undefined

declare module '*.png' {
  const url: string
  export default url
}
