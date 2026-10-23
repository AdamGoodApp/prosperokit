import './setup.js'
import 'core-js/actual/dom-exception'
import 'core-js/actual/url'
import 'core-js/actual/url-search-params'
import 'core-js/actual/url/to-json'
import { installConsole } from './console.js'
import { installEncoding } from './encoding.js'
import { installEvents } from './events.js'
import { installFetch } from './fetch.js'
import {
  installCrypto,
  installPerformance,
  installProcess,
  installStructuredClone,
} from './misc.js'
import { installTimers } from './timers.js'

/** Installs everything both runtimes share; the UI/server entries add their own bits. */
export function installCommon(): void {
  installProcess()
  installConsole()
  installTimers()
  installPerformance()
  installStructuredClone()
  installEncoding()
  installCrypto()
  installEvents()
  installFetch()
}
