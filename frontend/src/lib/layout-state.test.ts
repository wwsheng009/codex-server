// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  readSurfacePanelSides,
  readSurfacePanelWidths,
  readWorkspaceThreadListSortKey,
  writeWorkspaceThreadListSortKey,
} from './layout-state'

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

  it('persists the workspace thread list sort key and falls back for invalid values', () => {
    expect(readWorkspaceThreadListSortKey()).toBe('created_at')

    writeWorkspaceThreadListSortKey('updated_at')
    expect(readWorkspaceThreadListSortKey()).toBe('updated_at')

    window.localStorage.setItem(
      'codex-server:workspace-thread-list-sort-key',
      JSON.stringify('name'),
    )
    expect(readWorkspaceThreadListSortKey()).toBe('created_at')
  })
})
