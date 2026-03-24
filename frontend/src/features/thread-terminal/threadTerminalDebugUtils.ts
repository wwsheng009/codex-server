import type {
  ThreadTerminalDebugSuggestionsInput,
  ThreadTerminalRendererDebugToneInput
} from './threadTerminalStressStateTypes'

export const isTerminalDebugEnabled = import.meta.env.DEV

function parseDimensionsInfo(value: string) {
  const [colsRaw, rowsRaw] = value.split('x')
  const cols = Number(colsRaw)
  const rows = Number(rowsRaw)

  return {
    cols: Number.isFinite(cols) ? cols : 0,
    rows: Number.isFinite(rows) ? rows : 0,
  }
}

export function getRendererDebugTone({
  renderer,
  rate,
  outputLength,
}: ThreadTerminalRendererDebugToneInput) {
  if (renderer === 'webgl' || renderer === 'static') {
    return 'good'
  }

  if (rate > 32_000 || outputLength > 64_000) {
    return 'warn'
  }

  return 'neutral'
}

export function getSizeDebugTone(value: string) {
  const { cols, rows } = parseDimensionsInfo(value)

  if (cols > 280 || rows > 90) {
    return 'danger'
  }

  if (cols > 220 || rows > 70) {
    return 'warn'
  }

  return 'neutral'
}

export function getOutputDebugTone(outputLength: number) {
  if (outputLength > 112_000) {
    return 'danger'
  }

  if (outputLength > 64_000) {
    return 'warn'
  }

  return 'neutral'
}

export function getRateDebugTone(rate: number) {
  if (rate > 96_000) {
    return 'danger'
  }

  if (rate > 32_000) {
    return 'warn'
  }

  return 'neutral'
}

export function getFlushRateDebugTone(flushesPerSecond: number) {
  if (flushesPerSecond > 120) {
    return 'danger'
  }

  if (flushesPerSecond > 45) {
    return 'warn'
  }

  return 'neutral'
}

export function getChunkDebugTone(lastChunkSize: number) {
  if (lastChunkSize > 32_000) {
    return 'danger'
  }

  if (lastChunkSize > 8_000) {
    return 'warn'
  }

  return 'neutral'
}

export function getReplayAppendDebugTone(replayAppendCount: number) {
  if (replayAppendCount > 0) {
    return 'good'
  }

  return 'neutral'
}

export function getReplayReplaceDebugTone(replayReplaceCount: number) {
  if (replayReplaceCount > 0) {
    return 'warn'
  }

  return 'good'
}

export function buildTerminalDebugSuggestions(
  input: ThreadTerminalDebugSuggestionsInput,
) {
  const suggestions: string[] = []
  const { cols, rows } = parseDimensionsInfo(input.dimensionsInfo)

  if (input.renderer === 'dom' && input.rate > 32_000) {
    suggestions.push('High output rate on DOM renderer. Check whether WebGL failed to initialize.')
  }

  if (cols > 220 || rows > 70) {
    suggestions.push('Terminal viewport is very large. Reduce floating window size or exit maximize.')
  }

  if (input.outputLength > 64_000) {
    suggestions.push('Session output is large. Archive or close older sessions to reduce memory pressure.')
  }

  if (input.rate > 96_000) {
    suggestions.push('Output throughput is extremely high. Consider limiting command verbosity or batching logs.')
  }

  return suggestions
}
