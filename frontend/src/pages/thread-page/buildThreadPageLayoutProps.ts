import { buildThreadPageComposerDockProps } from './buildThreadPageComposerDockProps'
import { buildThreadPageRailLayoutProps } from './buildThreadPageRailLayoutProps'
import { buildThreadPageSurfaceLayoutProps } from './buildThreadPageSurfaceLayoutProps'
import type {
  BuildThreadPageLayoutPropsInput,
  BuildThreadPageLayoutPropsResult,
} from './threadPageLayoutPropTypes'

export function buildThreadPageLayoutProps(
  input: BuildThreadPageLayoutPropsInput,
): BuildThreadPageLayoutPropsResult {
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
