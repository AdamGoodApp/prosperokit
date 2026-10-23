import {
  createApp,
  createCustom,
  createHttp,
  createLog,
  createNotify,
  createSystem,
} from './modules.js'
import { invoke } from './transport.js'

export { NativeError } from './errors.js'
export type * from './modules.js'

export const app = createApp(invoke)
export const notify = createNotify(invoke)
export const system = createSystem(invoke)
export const log = createLog(invoke)
export const http = createHttp(invoke)
export const custom = createCustom(invoke)
