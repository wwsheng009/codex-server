import type { ServerEvent, ThreadDetail } from '../types/api'

export const FRONTEND_RUNTIME_MODE_STORAGE_KEY = 'codex.frontend.runtimeMode'

export type FrontendRuntimeMode = 'normal' | 'debug'

export function normalizeFrontendRuntimeMode(value: string | null | undefined): FrontendRuntimeMode {
  return value?.trim().toLowerCase() === 'debug' ? 'debug' : 'normal'
}

export function readFrontendRuntimeMode(): FrontendRuntimeMode {
  if (typeof window === 'undefined') {
    return 'normal'
  }

  try {
    return normalizeFrontendRuntimeMode(window.localStorage.getItem(FRONTEND_RUNTIME_MODE_STORAGE_KEY))
  } catch {
    return 'normal'
  }
}

export function writeFrontendRuntimeMode(mode: FrontendRuntimeMode) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (mode === 'debug') {
      window.localStorage.setItem(FRONTEND_RUNTIME_MODE_STORAGE_KEY, mode)
    } else {
      window.localStorage.removeItem(FRONTEND_RUNTIME_MODE_STORAGE_KEY)
    }
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function isFrontendDebugModeEnabled() {
  return readFrontendRuntimeMode() === 'debug'
}

export function frontendDebugLog(scope: string, message: string, details?: unknown) {
  if (!isFrontendDebugModeEnabled()) {
    return
  }

  if (details === undefined) {
    console.debug(`[frontend-debug][${scope}] ${message}`)
    return
  }

  console.debug(`[frontend-debug][${scope}] ${message}`, details)
}

export function summarizeServerEventForDebug(event: ServerEvent) {
  return {
    method: event.method,
    threadId: event.threadId ?? null,
    turnId: event.turnId ?? null,
    serverRequestId: event.serverRequestId ?? null,
    payload: event.payload,
    ts: event.ts,
    workspaceId: event.workspaceId,
  }
}

export function summarizeThreadDetailForDebug(threadDetail?: ThreadDetail) {
  if (!threadDetail) {
    return null
  }

  const lastTurn = threadDetail.turns?.[threadDetail.turns.length - 1]
  const lastItem = lastTurn?.items?.[lastTurn.items.length - 1]

  return {
    id: threadDetail.id,
    status: threadDetail.status,
    turnCount: threadDetail.turns?.length ?? 0,
    lastTurn: lastTurn
      ? {
          id: lastTurn.id,
          status: lastTurn.status,
          itemCount: lastTurn.items?.length ?? 0,
        }
      : null,
    lastItem: lastItem
      ? {
          id: typeof lastItem.id === 'string' ? lastItem.id : null,
          type: typeof lastItem.type === 'string' ? lastItem.type : null,
          text:
            typeof lastItem.text === 'string'
              ? previewDebugText(lastItem.text)
              : typeof lastItem.message === 'string'
              ? previewDebugText(lastItem.message)
              : null,
        }
      : null,
  }
}

function previewDebugText(value: string) {
  const normalized = value.trim()
  if (normalized.length <= 200) {
    return normalized
  }

  return `${normalized.slice(0, 200)} ... [truncated, ${normalized.length - 200} more chars]`
}
