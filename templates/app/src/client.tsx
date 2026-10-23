import table from 'virtual:prosperokit-class-table'
import { setClassResolver, startNative } from '@prosperokit/react'
import { createResolver } from '@prosperokit/tailwind/runtime'
import { getRouter } from './router'
import { startInstance } from './start'

setClassResolver(createResolver(table))
startNative({ getRouter, startInstance })
