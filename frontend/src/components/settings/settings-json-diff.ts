export type SettingsJsonDiffLineKind = 'context' | 'removed' | 'added'

export type SettingsJsonDiffChangeType = 'added' | 'removed' | 'modified'

export type SettingsJsonDiffDisplayMode = 'unified' | 'split'

type DiffOperation = {
  kind: SettingsJsonDiffLineKind
  text: string
}

export type SettingsJsonDiffLine = {
  kind: SettingsJsonDiffLineKind
  text: string
  prefix: ' ' | '-' | '+'
  leftLineNumber?: number
  rightLineNumber?: number
}

export type SettingsJsonDiffSplitRow = {
  left: SettingsJsonDiffLine | null
  right: SettingsJsonDiffLine | null
}

export type SettingsJsonDiffModel = {
  changeType: SettingsJsonDiffChangeType
  currentText: string
  nextText: string
  unifiedRows: SettingsJsonDiffLine[]
  splitRows: SettingsJsonDiffSplitRow[]
  stats: {
    addedCount: number
    removedCount: number
    contextCount: number
  }
}

type SettingsJsonDiffOptions = {
  missingLabel?: string
}

export function createSettingsJsonDiffModel(
  currentValue: unknown,
  nextValue: unknown,
  options?: SettingsJsonDiffOptions,
): SettingsJsonDiffModel {
  const currentText = stringifyDiffValue(currentValue, options)
  const nextText = stringifyDiffValue(nextValue, options)
  const operations = buildDiffOperations(
    splitDiffLines(currentText),
    splitDiffLines(nextText),
  )

  let leftLineNumber = 1
  let rightLineNumber = 1
  const stats = {
    addedCount: 0,
    removedCount: 0,
    contextCount: 0,
  }

  const unifiedRows = operations.map((operation) => {
    if (operation.kind === 'context') {
      const row = {
        kind: operation.kind,
        text: operation.text,
        prefix: ' ' as const,
        leftLineNumber,
        rightLineNumber,
      }
      leftLineNumber += 1
      rightLineNumber += 1
      stats.contextCount += 1
      return row
    }

    if (operation.kind === 'removed') {
      const row = {
        kind: operation.kind,
        text: operation.text,
        prefix: '-' as const,
        leftLineNumber,
      }
      leftLineNumber += 1
      stats.removedCount += 1
      return row
    }

    const row = {
      kind: operation.kind,
      text: operation.text,
      prefix: '+' as const,
      rightLineNumber,
    }
    rightLineNumber += 1
    stats.addedCount += 1
    return row
  })

  return {
    changeType: getSettingsJsonDiffChangeType(currentValue, nextValue),
    currentText,
    nextText,
    unifiedRows,
    splitRows: buildSplitRows(unifiedRows),
    stats,
  }
}

export function getSettingsJsonDiffChangeType(
  currentValue: unknown,
  nextValue: unknown,
): SettingsJsonDiffChangeType {
  if (typeof currentValue === 'undefined') {
    return 'added'
  }

  if (typeof nextValue === 'undefined') {
    return 'removed'
  }

  return 'modified'
}

export function stringifyDiffValue(
  value: unknown,
  options?: SettingsJsonDiffOptions,
): string {
  if (typeof value === 'undefined') {
    return options?.missingLabel ?? '(missing)'
  }

  const serialized = JSON.stringify(value, null, 2)
  return serialized ?? String(value)
}

function splitDiffLines(text: string) {
  return text.split('\n')
}

function buildDiffOperations(leftLines: string[], rightLines: string[]): DiffOperation[] {
  const leftLength = leftLines.length
  const rightLength = rightLines.length
  const lcsTable = Array.from({ length: leftLength + 1 }, () =>
    Array.from<number>({ length: rightLength + 1 }).fill(0),
  )

  for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
      if (leftLines[leftIndex - 1] === rightLines[rightIndex - 1]) {
        lcsTable[leftIndex][rightIndex] = lcsTable[leftIndex - 1][rightIndex - 1] + 1
      } else {
        lcsTable[leftIndex][rightIndex] = Math.max(
          lcsTable[leftIndex - 1][rightIndex],
          lcsTable[leftIndex][rightIndex - 1],
        )
      }
    }
  }

  const operations: DiffOperation[] = []
  let leftIndex = leftLength
  let rightIndex = rightLength

  while (leftIndex > 0 || rightIndex > 0) {
    if (
      leftIndex > 0 &&
      rightIndex > 0 &&
      leftLines[leftIndex - 1] === rightLines[rightIndex - 1]
    ) {
      operations.push({
        kind: 'context',
        text: leftLines[leftIndex - 1],
      })
      leftIndex -= 1
      rightIndex -= 1
      continue
    }

    if (
      rightIndex > 0 &&
      (leftIndex === 0 ||
        lcsTable[leftIndex][rightIndex - 1] >= lcsTable[leftIndex - 1][rightIndex])
    ) {
      operations.push({
        kind: 'added',
        text: rightLines[rightIndex - 1],
      })
      rightIndex -= 1
      continue
    }

    operations.push({
      kind: 'removed',
      text: leftLines[leftIndex - 1],
    })
    leftIndex -= 1
  }

  operations.reverse()
  return operations
}

function buildSplitRows(lines: SettingsJsonDiffLine[]): SettingsJsonDiffSplitRow[] {
  const rows: SettingsJsonDiffSplitRow[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.kind === 'context') {
      rows.push({
        left: line,
        right: line,
      })
      index += 1
      continue
    }

    const removed: SettingsJsonDiffLine[] = []
    const added: SettingsJsonDiffLine[] = []

    while (index < lines.length && lines[index].kind !== 'context') {
      if (lines[index].kind === 'removed') {
        removed.push(lines[index])
      } else {
        added.push(lines[index])
      }
      index += 1
    }

    const pairCount = Math.max(removed.length, added.length)
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      rows.push({
        left: removed[pairIndex] ?? null,
        right: added[pairIndex] ?? null,
      })
    }
  }

  return rows
}
