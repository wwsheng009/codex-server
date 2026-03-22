import { describe, expect, it } from 'vitest'

import {
  createSettingsJsonDiffModel,
  getSettingsJsonDiffChangeType,
} from './settings-json-diff'

describe('settings-json-diff', () => {
  it('marks missing to defined transitions as added', () => {
    const model = createSettingsJsonDiffModel(undefined, { approval_policy: 'never' })

    expect(getSettingsJsonDiffChangeType(undefined, { approval_policy: 'never' })).toBe('added')
    expect(model.stats.addedCount).toBeGreaterThan(0)
    expect(model.stats.removedCount).toBe(1)
    expect(model.unifiedRows[0]).toMatchObject({
      kind: 'removed',
      text: '(missing)',
    })
    expect(model.unifiedRows.some((row) => row.kind === 'added')).toBe(true)
  })

  it('marks defined to missing transitions as removed', () => {
    const model = createSettingsJsonDiffModel({ sandbox_mode: 'danger-full-access' }, undefined)

    expect(
      getSettingsJsonDiffChangeType({ sandbox_mode: 'danger-full-access' }, undefined),
    ).toBe('removed')
    expect(model.stats.removedCount).toBeGreaterThan(0)
    expect(model.stats.addedCount).toBe(1)
    expect(model.unifiedRows.at(-1)).toMatchObject({
      kind: 'added',
      text: '(missing)',
    })
    expect(model.unifiedRows.some((row) => row.kind === 'removed')).toBe(true)
  })

  it('builds paired split rows for modified multi-line objects', () => {
    const model = createSettingsJsonDiffModel(
      {
        shell_environment_policy: {
          inherit: 'core',
          set: {
            PATHEXT: '.COM;.EXE',
          },
        },
      },
      {
        shell_environment_policy: {
          inherit: 'all',
          set: {
            PATHEXT: '.COM;.EXE',
            SystemRoot: 'C:\\Windows',
          },
        },
      },
    )

    expect(getSettingsJsonDiffChangeType({ inherit: 'core' }, { inherit: 'all' })).toBe(
      'modified',
    )
    expect(model.stats.addedCount).toBeGreaterThan(0)
    expect(model.stats.removedCount).toBeGreaterThan(0)
    expect(model.stats.contextCount).toBeGreaterThan(0)
    expect(model.splitRows.some((row) => row.left?.kind === 'removed')).toBe(true)
    expect(model.splitRows.some((row) => row.right?.kind === 'added')).toBe(true)
    expect(model.unifiedRows.some((row) => row.text.includes('"SystemRoot"'))).toBe(true)
    expect(model.unifiedRows.some((row) => row.text.includes('"inherit": "core"'))).toBe(true)
    expect(model.unifiedRows.some((row) => row.text.includes('"inherit": "all"'))).toBe(true)
  })
})
