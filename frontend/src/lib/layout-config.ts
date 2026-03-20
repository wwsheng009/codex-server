export type SurfacePanelView = 'approvals' | 'feed'
export type SurfacePanelSide = 'left' | 'right'

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
      limits: {
        min: 120,
        max: 320,
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
