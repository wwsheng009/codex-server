import type {
  SurfacePanelSide,
  SurfacePanelView,
  TerminalDockPlacement,
} from './layout-config-types'
export type {
  SurfacePanelSide,
  SurfacePanelView,
  TerminalDockPlacement,
  TerminalWindowBounds,
} from './layout-config-types'

export const layoutConfig = {
  shell: {
    leftSidebar: {
      defaultWidth: 224,
      limits: {
        min: 180,
        max: 320,
      },
    },
  },
  workbench: {
    terminalDock: {
      defaultHeight: 168,
      defaultPlacement: 'bottom' as TerminalDockPlacement,
      limits: {
        min: 120,
        max: 320,
      },
      floating: {
        defaultWidth: 920,
        defaultHeight: 560,
        limits: {
          minWidth: 540,
          maxWidth: 1400,
          minHeight: 320,
          maxHeight: 960,
        },
        viewportMargin: 20,
      },
    },
    rightRail: {
      defaultWidth: 300,
      limits: {
        min: 240,
        max: 520,
      },
    },
    surfacePanel: {
      defaultWidths: {
        approvals: 360,
        feed: 360,
      } satisfies Record<SurfacePanelView, number>,
      defaultSides: {
        approvals: 'right',
        feed: 'right',
      } satisfies Record<SurfacePanelView, SurfacePanelSide>,
      widthLimits: {
        min: 280,
        max: 520,
      },
    },
  },
} as const
