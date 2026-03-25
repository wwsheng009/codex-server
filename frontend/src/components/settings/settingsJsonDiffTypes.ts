export type SettingsJsonDiffLineKind = 'context' | 'removed' | 'added'

export type SettingsJsonDiffChangeType = 'added' | 'removed' | 'modified'

export type SettingsJsonDiffDisplayMode = 'unified' | 'split'

export type DiffOperation = {
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

export type SettingsJsonDiffOptions = {
  missingLabel?: string
}
