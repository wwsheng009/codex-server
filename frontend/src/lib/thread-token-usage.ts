import type { ServerEvent, ThreadTokenUsage } from '../types/api'

export function readThreadTokenUsageFromEvent(event: ServerEvent) {
  if (event.method !== 'thread/tokenUsage/updated') {
    return null
  }

  const payload = event.payload
  if (typeof payload !== 'object' || payload === null) {
    return null
  }

  const entry = payload as Record<string, unknown>
  const threadId =
    typeof event.threadId === 'string' && event.threadId
      ? event.threadId
      : typeof entry.threadId === 'string'
        ? entry.threadId
        : ''

  if (!threadId) {
    return null
  }

  const tokenUsage = entry.tokenUsage
  if (typeof tokenUsage !== 'object' || tokenUsage === null) {
    return null
  }

  const usage = tokenUsage as Record<string, unknown>
  const last = asObject(usage.last)
  const total = asObject(usage.total)

  return {
    threadId,
    usage: {
      last: {
        cachedInputTokens: numberValue(last.cachedInputTokens),
        inputTokens: numberValue(last.inputTokens),
        outputTokens: numberValue(last.outputTokens),
        reasoningOutputTokens: numberValue(last.reasoningOutputTokens),
        totalTokens: numberValue(last.totalTokens),
      },
      total: {
        cachedInputTokens: numberValue(total.cachedInputTokens),
        inputTokens: numberValue(total.inputTokens),
        outputTokens: numberValue(total.outputTokens),
        reasoningOutputTokens: numberValue(total.reasoningOutputTokens),
        totalTokens: numberValue(total.totalTokens),
      },
      modelContextWindow:
        typeof usage.modelContextWindow === 'number' && Number.isFinite(usage.modelContextWindow)
          ? usage.modelContextWindow
          : null,
    } satisfies ThreadTokenUsage,
  }
}

export function computeContextUsage(usage: ThreadTokenUsage | null | undefined) {
  if (!usage) {
    return {
      contextWindow: 0,
      percent: null,
      totalTokens: 0,
    }
  }

  const totalTokens = numberValue(usage.last.totalTokens)
  const contextWindow = numberValue(usage.modelContextWindow)

  return {
    contextWindow,
    percent:
      contextWindow > 0
        ? Math.max(0, Math.min(100, Math.round((totalTokens / contextWindow) * 100)))
        : null,
    totalTokens,
  }
}

function asObject(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
