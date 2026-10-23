import { createAudio, createIme, createPad } from './modules.js'
import { invoke } from './transport.js'

export * from './index.js'

export const ime = createIme(invoke)
export const pad = createPad(invoke)
export const audio = createAudio(invoke)
