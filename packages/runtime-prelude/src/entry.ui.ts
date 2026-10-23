import { defineGlobal } from './define.js'
import { installCommon } from './install.js'

installCommon()
defineGlobal('window', globalThis)
