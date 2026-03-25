import type { ThreadViewportProgrammaticScrollPolicy } from './threadViewportAutoScrollUtils'

export type ThreadViewportScrollTask = {
  behavior: ScrollBehavior
  metadata?: Record<string, boolean | number | string | null>
  policy: ThreadViewportProgrammaticScrollPolicy
  resolveTargetTop: (viewport: HTMLDivElement) => number | null
  source: string
}
