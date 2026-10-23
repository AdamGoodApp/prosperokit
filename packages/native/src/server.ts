import { createAudio, createFs } from './modules.js'
import { invoke } from './transport.js'

export * from './index.js'

export const fs = createFs(invoke)
export const audio = createAudio(invoke)
