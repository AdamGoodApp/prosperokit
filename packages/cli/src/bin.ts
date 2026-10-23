#!/usr/bin/env node
import { Command } from 'commander'
import { registerAdd } from './commands/add.js'
import { registerAssets } from './commands/assets.js'
import { registerBuild } from './commands/build.js'
import { registerCreate } from './commands/create.js'
import { registerDeploy } from './commands/deploy.js'
import { registerDev } from './commands/dev.js'
import { registerDoctor } from './commands/doctor.js'
import { registerPreview } from './commands/preview.js'
import { cliVersion } from './paths.js'

export function createProgram(): Command {
  const program = new Command()
    .name('prosperokit')
    .description('ProsperoKit: native PS5 homebrew apps with React')
    .version(cliVersion())
  registerCreate(program)
  registerDoctor(program)
  registerDev(program)
  registerBuild(program) // build + package
  registerPreview(program)
  registerDeploy(program) // deploy + undeploy
  registerAdd(program)
  registerAssets(program)
  return program
}

await createProgram().parseAsync(process.argv)
