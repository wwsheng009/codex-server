import { buildThreadPageComposerDockProps } from './buildThreadPageComposerDockProps'
import { buildThreadPageRailLayoutProps } from './buildThreadPageRailLayoutProps'
import { buildThreadPageSurfaceLayoutProps } from './buildThreadPageSurfaceLayoutProps'
import type { BuildThreadPageLayoutPropsInput } from './threadPageLayoutPropTypes'

export function buildThreadPageLayoutProps(input: BuildThreadPageLayoutPropsInput) {
  const composerDockProps = buildThreadPageComposerDockProps(input)
  const { confirmDialogProps, railProps } = buildThreadPageRailLayoutProps(input)
  const { surfaceProps, terminalDockProps } = buildThreadPageSurfaceLayoutProps(input)

  return {
    composerDockProps,
    confirmDialogProps,
    railProps,
    surfaceProps,
    terminalDockProps,
  }
}
