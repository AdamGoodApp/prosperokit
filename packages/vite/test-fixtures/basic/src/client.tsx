import classTable from 'virtual:prosperokit-class-table'
import { setClassTable } from '@prosperokit/tailwind/runtime'
import { getRouter } from './router'
import { startInstance } from './start'

// The template's client.tsx does exactly this before `startNative(...)`.
setClassTable(classTable)

Promise.all([getRouter(), startInstance?.getOptions()]).then(([router]) => {
  console.log('fixture client ready', router.state.location.href)
})
