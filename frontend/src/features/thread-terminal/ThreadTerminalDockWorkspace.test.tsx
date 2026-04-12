import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n/runtime'
import { ThreadTerminalDockWorkspace } from './ThreadTerminalDockWorkspace'

vi.mock('./ThreadTerminalConsoleSection', () => ({
  ThreadTerminalConsoleSection: () => <div>console-section</div>,
}))

vi.mock('./ThreadTerminalSessionTabsSection', () => ({
  ThreadTerminalSessionTabsSection: () => <div>session-tabs</div>,
}))

describe('ThreadTerminalDockWorkspace', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('renders the bottom resize handle inside the workspace edge instead of a dedicated row', () => {
    const html = renderToStaticMarkup(
      <ThreadTerminalDockWorkspace
        consoleSection={{} as never}
        resizeHandle={{
          onResizeStart: () => undefined,
        }}
        sessionTabsSection={{
          sessions: {
            visibleSessions: [],
          },
        } as never}
        windowResizeHandle={null}
        workspaceRef={{ current: null }}
      />,
    )

    expect(html.indexOf('terminal-dock__workspace')).toBeLessThan(
      html.indexOf('terminal-dock__resize-handle'),
    )
    expect(html.indexOf('terminal-dock__resize-handle')).toBeLessThan(
      html.indexOf('terminal-dock__body'),
    )
    expect(html).toContain('Resize terminal dock')
  })
})
