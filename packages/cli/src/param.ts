// sce_sys/param.json generation. The fixed fields are copied verbatim from the
// vendored kit's template (`kit/sce_sys/param.json`); the identity fields come from
// the app config.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProsperoConfig } from './config.js'

/** `UP9000-<titleId>_00-<NAME16>` suffix: uppercased, `[A-Z0-9]` only, truncated/padded with `0` to 16. */
export function contentName16(name: string): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return cleaned.slice(0, 16).padEnd(16, '0')
}

export function generateParam(app: ProsperoConfig['app']): Record<string, unknown> {
  const game = app.category === 'game'
  const param: Record<string, unknown> = {
    ageLevel: { default: 0 },
    applicationCategoryType: game ? 0 : 65536,
    applicationDrmType: 'free',
    attribute: 1644167168,
    attribute2: 0,
    attribute3: 1048576,
    conceptId: app.titleId.slice(-5),
    contentBadgeType: game ? 1 : 2,
    contentId: `UP9000-${app.titleId}_00-${contentName16(app.name)}`,
    contentVersion: app.version,
    downloadDataSize: app.downloadDataSizeMB,
  }
  if (game) param.gameIntent = { permittedIntents: [{ intentType: 'launchActivity' }] }
  param.localizedParameters = {
    defaultLanguage: app.language,
    [app.language]: { titleName: app.name },
  }
  param.masterVersion = '01.00'
  param.pubtools = {
    creationDate: '2026-08-22 00:00:00',
    loudnessSnd0: '-28.00',
    toolVersion: '2.00',
  }
  param.requiredSystemSoftwareVersion = '0x0000000000000000'
  param.sdkVersion = '0x0000000000000000'
  param.titleId = app.titleId
  param.versionFileUri = ''
  return param
}

export async function writeParam(
  _appDir: string,
  cfg: ProsperoConfig,
  outFile: string,
): Promise<void> {
  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, `${JSON.stringify(generateParam(cfg.app), null, 2)}\n`)
}
