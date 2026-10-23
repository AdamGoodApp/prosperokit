export interface RegistryEntry {
  name: string
  files: string[]
  registryDependencies: string[]
  dependencies: string[]
}
export function buildRegistry(registryDir: string): RegistryEntry[]
