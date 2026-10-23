// Stand-in for @prosperokit/native/server in fixtures; the path matters
// (`/packages/native/src/server`), the contents do not.
export const fs = { list: async (_path: string) => ['a', 'b'] }
