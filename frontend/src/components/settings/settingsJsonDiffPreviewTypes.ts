import type { ConfigScenarioDiffEntry } from '../../features/settings/config-scenarios'
import type {
  SettingsJsonDiffLine,
  SettingsJsonDiffSplitRow,
} from './settings-json-diff'

export type SettingsJsonDiffPreviewProps = {
  title: string
  description: string
  entries: ConfigScenarioDiffEntry[]
}

export type UnifiedDiffRowsProps = {
  rows: SettingsJsonDiffLine[]
}

export type SplitDiffRowsProps = {
  rows: SettingsJsonDiffSplitRow[]
}

export type SplitDiffCellSide = 'left' | 'right'

export type SplitDiffCellProps = {
  line: SettingsJsonDiffLine | null
  side: SplitDiffCellSide
  divider?: boolean
}
