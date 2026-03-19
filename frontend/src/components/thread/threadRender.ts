export function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function numberField(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

export function arrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

export function userMessageText(item: Record<string, unknown>) {
  if (!Array.isArray(item.content)) {
    return ''
  }

  return item.content
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return ''
      }
      return stringField((entry as Record<string, unknown>).text)
    })
    .filter(Boolean)
    .join('\n')
}

export function planSteps(item: Record<string, unknown>) {
  const text = stringField(item.text)
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
}

export function reasoningSummary(item: Record<string, unknown>) {
  return arrayOfStrings(item.summary)
}

export function reasoningContent(item: Record<string, unknown>) {
  return arrayOfStrings(item.content)
}

export function fileChanges(item: Record<string, unknown>) {
  if (!Array.isArray(item.changes)) {
    return []
  }

  return item.changes.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return { path: '', diff: '', kind: '' }
    }

    const change = entry as Record<string, unknown>
    return {
      path: stringField(change.path),
      diff: stringField(change.diff),
      kind: patchKindLabel(change.kind),
    }
  })
}

export function patchKindLabel(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    return ''
  }

  return stringField((value as Record<string, unknown>).type)
}

export function formatDuration(value?: number) {
  if (typeof value !== 'number') {
    return '—'
  }

  if (value < 1000) {
    return `${value} ms`
  }

  return `${(value / 1000).toFixed(1)} s`
}

export function decodeBase64(value: string) {
  try {
    const binary = window.atob(value)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return value
  }
}

export function itemTypeLabel(type: string) {
  switch (type) {
    case 'userMessage':
      return 'User Message'
    case 'agentMessage':
      return 'Agent Message'
    case 'plan':
      return 'Plan'
    case 'reasoning':
      return 'Reasoning'
    case 'commandExecution':
      return 'Command Execution'
    case 'fileChange':
      return 'File Change'
    default:
      return type || 'Item'
  }
}

export function itemPreview(item: Record<string, unknown>) {
  const itemType = stringField(item.type)

  switch (itemType) {
    case 'userMessage':
      return userMessageText(item)
    case 'agentMessage':
      return stringField(item.text)
    case 'plan':
      return planSteps(item).join('\n')
    case 'reasoning':
      return [...reasoningSummary(item), ...reasoningContent(item)].join('\n')
    case 'commandExecution':
      return stringField(item.command)
    case 'fileChange':
      return fileChanges(item)
        .map((change) => `${change.kind}: ${change.path}`)
        .join('\n')
    default:
      return JSON.stringify(item, null, 2)
  }
}
