// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import { readSurfacePanelSides, readSurfacePanelWidths } from './layout-state'

describe('layout-state surface panel preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('fills in missing plans width from defaults when older saved preferences are loaded', () => {
    window.localStorage.setItem(
      'codex-server:surface-panel-widths',
      JSON.stringify({
        approvals: 320,
        feed: 340,
      }),
    )

    expect(readSurfacePanelWidths()).toEqual({
      approvals: 320,
      feed: 340,
      plans: 380,
    })
  })

  it('fills in missing plans side from defaults when older saved preferences are loaded', () => {
    window.localStorage.setItem(
      'codex-server:surface-panel-sides',
      JSON.stringify({
        approvals: 'left',
        feed: 'right',
      }),
    )

    expect(readSurfacePanelSides()).toEqual({
      approvals: 'left',
      feed: 'right',
      plans: 'right',
    })
  })
})
