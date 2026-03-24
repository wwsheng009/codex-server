import type { ThreadTerminalActiveViewportInput } from './threadTerminalViewportTypes'

export function getActiveViewport({
  sessionId,
  viewportRefs,
}: ThreadTerminalActiveViewportInput) {
  if (!sessionId) {
    return null
  }

  return viewportRefs[sessionId] ?? null
}
