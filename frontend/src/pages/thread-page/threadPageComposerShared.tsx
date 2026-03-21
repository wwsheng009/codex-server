import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'

import {
  ContextIcon,
  FeedIcon,
  FolderClosedIcon,
  RefreshIcon,
  SettingsIcon,
  SparkIcon,
  TerminalIcon,
  ToolsIcon,
} from '../../components/ui/RailControls'
import type { CatalogItem, RateLimit, ThreadTokenUsage } from '../../types/api'

const COMPOSER_PREFERENCES_STORAGE_PREFIX = 'codex-server:composer-preferences:'

export const FALLBACK_MODEL_OPTIONS = ['gpt-5.4', 'gpt-5.3-codex']

export type ModelOption = {
  value: string
  label: string
  triggerLabel?: string
}

export type ComposerPermissionPreset = 'default' | 'full-access'
export type ComposerReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type ComposerCollaborationMode = 'default' | 'plan'

export type ContextCompactionFeedback = {
  phase: 'requested' | 'completed' | 'failed'
  title: string
  threadId: string
}

export type ComposerPreferences = {
  permissionPreset: ComposerPermissionPreset
  model: string
  reasoningEffort: ComposerReasoningEffort
  collaborationMode: ComposerCollaborationMode
}

export const DEFAULT_COMPOSER_PREFERENCES: ComposerPreferences = {
  permissionPreset: 'default',
  model: '',
  reasoningEffort: 'medium',
  collaborationMode: 'default',
}

export type ComposerAssistPanel = 'mcp' | 'personalization' | 'status' | 'worktree'
export type ComposerCommandMenu = 'root' | 'review'

type ComposerCommandId =
  | 'mcp'
  | 'personalization'
  | 'review'
  | 'feedback'
  | 'worktree'
  | 'status'
  | 'plan'

export type ComposerCommandAction =
  | { kind: 'panel'; panel: ComposerAssistPanel }
  | { kind: 'prompt'; prompt: string }
  | { kind: 'submenu'; menu: ComposerCommandMenu }
  | { kind: 'toggle-plan' }

export type ComposerCommandDefinition = {
  id: ComposerCommandId
  title: string
  description: string
  keywords: string[]
  icon: ComposerOptionIcon
  action: ComposerCommandAction
}

type ComposerReviewShortcutDefinition = {
  id: 'review-base' | 'review-uncommitted'
  title: string
  description: string
  prompt: string
}

export type ComposerOptionIcon =
  | 'feedback'
  | 'file'
  | 'mcp'
  | 'personalization'
  | 'plan'
  | 'review'
  | 'skill'
  | 'status'
  | 'worktree'

export type ComposerAutocompleteItem =
  | {
      kind: 'command'
      id: ComposerCommandId
      title: string
      description: string
      meta?: string
      icon: ComposerOptionIcon
      action: ComposerCommandAction
      section: 'commands'
    }
  | {
      kind: 'review'
      id: ComposerReviewShortcutDefinition['id']
      title: string
      description: string
      meta?: string
      icon: ComposerOptionIcon
      prompt: string
      section: 'commands'
    }
  | {
      kind: 'skill'
      id: string
      title: string
      description: string
      meta?: string
      icon: ComposerOptionIcon
      insertion: string
      section: 'skills'
    }
  | {
      kind: 'file'
      id: string
      title: string
      description: string
      meta?: string
      icon: ComposerOptionIcon
      insertion: string
      section: 'files'
    }

export type ComposerAutocompleteSection = {
  id: ComposerAutocompleteItem['section']
  label: string
  items: ComposerAutocompleteItem[]
}

const FEEDBACK_PROMPT =
  '请帮我整理一条产品反馈，包含问题概述、复现步骤、期望结果、实际结果和影响范围：'

const REVIEW_SHORTCUTS: ComposerReviewShortcutDefinition[] = [
  {
    id: 'review-base',
    title: '基于基础分支进行审查',
    description: '审查当前分支相对基础分支的变更。',
    prompt: '请基于当前基础分支对代码变更进行审查，优先指出 bug、行为回归、风险点和缺失的测试。',
  },
  {
    id: 'review-uncommitted',
    title: '审查未提交的更改',
    description: '审查当前工作区中尚未提交的本地修改。',
    prompt: '请审查当前未提交的本地更改，优先指出 bug、行为回归、风险点和缺失的测试。',
  },
]

export function buildComposerCommandDefinitions(
  collaborationMode: ComposerCollaborationMode,
): ComposerCommandDefinition[] {
  return [
    {
      id: 'mcp',
      title: 'MCP',
      description: '显示 MCP 服务器状态',
      keywords: ['mcp', 'server', 'oauth', 'status'],
      icon: 'mcp',
      action: { kind: 'panel', panel: 'mcp' },
    },
    {
      id: 'personalization',
      title: '个性',
      description: '查看本地响应偏好与自定义指令',
      keywords: ['个性', '个性化', 'personalization', 'tone', 'instructions'],
      icon: 'personalization',
      action: { kind: 'panel', panel: 'personalization' },
    },
    {
      id: 'review',
      title: '代码审查',
      description: '打开审查快捷指令',
      keywords: ['review', 'code review', '代码审查', '审查'],
      icon: 'review',
      action: { kind: 'submenu', menu: 'review' },
    },
    {
      id: 'feedback',
      title: '反馈',
      description: '插入产品反馈提示词',
      keywords: ['feedback', 'bug report', '反馈'],
      icon: 'feedback',
      action: { kind: 'prompt', prompt: FEEDBACK_PROMPT },
    },
    {
      id: 'worktree',
      title: '新工作树',
      description: '查看当前工作树策略与设置入口',
      keywords: ['worktree', '工作树', 'branch'],
      icon: 'worktree',
      action: { kind: 'panel', panel: 'worktree' },
    },
    {
      id: 'status',
      title: '状态',
      description: '显示线程 ID、上下文使用情况以及额度',
      keywords: ['status', 'quota', 'context', 'thread', '状态', '额度'],
      icon: 'status',
      action: { kind: 'panel', panel: 'status' },
    },
    {
      id: 'plan',
      title: '计划模式',
      description: collaborationMode === 'plan' ? '关闭计划模式' : '开启计划模式',
      keywords: ['plan', 'planning', '计划', 'plan mode'],
      icon: 'plan',
      action: { kind: 'toggle-plan' },
    },
  ]
}

export function normalizePermissionPreset(value: string): ComposerPermissionPreset {
  return value === 'full-access' ? 'full-access' : 'default'
}

export function normalizeReasoningEffort(value: string): ComposerReasoningEffort {
  switch (value) {
    case 'low':
    case 'high':
    case 'xhigh':
      return value
    default:
      return 'medium'
  }
}

export function normalizeCollaborationMode(value: string): ComposerCollaborationMode {
  return value === 'plan' ? 'plan' : 'default'
}

export function readComposerPreferences(workspaceId: string): ComposerPreferences {
  if (!workspaceId || typeof window === 'undefined') {
    return DEFAULT_COMPOSER_PREFERENCES
  }

  try {
    const raw = window.localStorage.getItem(`${COMPOSER_PREFERENCES_STORAGE_PREFIX}${workspaceId}`)
    if (!raw) {
      return DEFAULT_COMPOSER_PREFERENCES
    }

    const parsed = JSON.parse(raw) as Partial<ComposerPreferences>
    return {
      permissionPreset: normalizePermissionPreset(String(parsed.permissionPreset ?? 'default')),
      model: typeof parsed.model === 'string' ? parsed.model : '',
      reasoningEffort: normalizeReasoningEffort(String(parsed.reasoningEffort ?? 'medium')),
      collaborationMode: normalizeCollaborationMode(String(parsed.collaborationMode ?? 'default')),
    }
  } catch {
    return DEFAULT_COMPOSER_PREFERENCES
  }
}

export function writeComposerPreferences(workspaceId: string, preferences: ComposerPreferences) {
  if (!workspaceId || typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      `${COMPOSER_PREFERENCES_STORAGE_PREFIX}${workspaceId}`,
      JSON.stringify(preferences),
    )
  } catch {
    // Ignore browser storage failures.
  }
}

function matchesComposerQuery(query: string, values: string[]) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return true
  }

  return values.some((value) => value.toLowerCase().includes(normalizedQuery))
}

export function buildComposerAutocompleteSections(input: {
  mode: 'command' | 'mention' | 'skill'
  commands: ComposerCommandDefinition[]
  commandMenu: ComposerCommandMenu
  query: string
  skills: CatalogItem[]
  files: Array<{ path: string; name: string; directory: string }>
}) {
  const { commands, commandMenu, files, mode, query, skills } = input
  const sections: ComposerAutocompleteSection[] = []

  if (mode === 'command' && commandMenu === 'review') {
    const items = REVIEW_SHORTCUTS.filter((shortcut) =>
      matchesComposerQuery(query, [shortcut.title, shortcut.description, shortcut.prompt]),
    ).map<ComposerAutocompleteItem>((shortcut) => ({
      kind: 'review',
      id: shortcut.id,
      title: shortcut.title,
      description: shortcut.description,
      icon: 'review',
      prompt: shortcut.prompt,
      section: 'commands',
    }))

    sections.push({ id: 'commands', label: '搜索', items })
    return sections
  }

  if (mode === 'command') {
    const commandItems = commands
      .filter((command) =>
        matchesComposerQuery(query, [command.title, command.description, ...command.keywords]),
      )
      .map<ComposerAutocompleteItem>((command) => ({
        kind: 'command',
        id: command.id,
        title: command.title,
        description: command.description,
        icon: command.icon,
        action: command.action,
        section: 'commands',
      }))

    if (commandItems.length) {
      sections.push({ id: 'commands', label: '搜索', items: commandItems })
    }
  }

  const skillItems = skills
    .filter((skill) => matchesComposerQuery(query, [skill.name, skill.description]))
    .slice(0, 6)
    .map<ComposerAutocompleteItem>((skill) => ({
      kind: 'skill',
      id: skill.id,
      title: skill.name,
      description: skill.description || '将技能标记插入输入框',
      meta: skill.id,
      icon: 'skill',
      insertion: `$${skill.name} `,
      section: 'skills',
    }))

  if (skillItems.length && (mode === 'command' || mode === 'skill')) {
    sections.push({ id: 'skills', label: '技能', items: skillItems })
  }

  if (mode === 'mention') {
    const fileItems = files.map<ComposerAutocompleteItem>((file) => ({
      kind: 'file',
      id: file.path,
      title: file.name,
      description: file.directory || file.path,
      meta: file.path,
      icon: 'file',
      insertion: `@${file.path} `,
      section: 'files',
    }))

    if (fileItems.length) {
      sections.push({ id: 'files', label: '文件', items: fileItems })
    }
  }

  return sections
}

export function composerSectionLabel(id: ComposerAutocompleteItem['section']) {
  switch (id) {
    case 'files':
      return '文件'
    case 'skills':
      return '技能'
    default:
      return '搜索'
  }
}

function stringRecordField(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function formatShortTime(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return '未知'
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function truncateInlineText(value: string, maxLength = 120) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) {
    return compact
  }

  return `${compact.slice(0, Math.max(0, maxLength - 1))}…`
}

export function describeRateLimits(rateLimits: RateLimit[] | undefined) {
  if (!rateLimits?.length) {
    return '不可用'
  }

  return rateLimits
    .slice(0, 2)
    .map((limit) => `${limit.name}: ${limit.remaining}/${limit.limit}`)
    .join(' · ')
}

export type NormalizedMcpServerState = {
  name: string
  status: string
  detail: string
}

export function normalizeMcpServerState(entry: Record<string, unknown>): NormalizedMcpServerState {
  const name =
    stringRecordField(entry.name) ||
    stringRecordField(entry.serverName) ||
    stringRecordField(entry.id) ||
    'Unnamed server'
  const status =
    stringRecordField(entry.status) ||
    stringRecordField(entry.authStatus) ||
    stringRecordField(entry.state) ||
    'unknown'
  const detail =
    stringRecordField(entry.message) ||
    stringRecordField(entry.description) ||
    stringRecordField(entry.detail)

  return { name, status, detail }
}

export function ComposerCloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

function ComposerFileIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path
        d="M7 4.5h6l4 4v11a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 19.5V6A1.5 1.5 0 0 1 7.5 4.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M13 4.5V9h4.5"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

export function ComposerOptionGlyph({ icon }: { icon: ComposerOptionIcon }) {
  switch (icon) {
    case 'mcp':
      return <TerminalIcon />
    case 'personalization':
      return <SettingsIcon />
    case 'review':
      return <ToolsIcon />
    case 'feedback':
      return <FeedIcon />
    case 'worktree':
      return <FolderClosedIcon />
    case 'status':
      return <ContextIcon />
    case 'plan':
      return <RefreshIcon />
    case 'skill':
      return <SparkIcon />
    case 'file':
    default:
      return <ComposerFileIcon />
  }
}

export function statusIsInterruptible(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  return ['running', 'processing', 'sending', 'waiting', 'inprogress', 'started'].includes(normalized)
}

export function compactStatusTone(value?: string) {
  return (value ?? 'idle').toLowerCase().replace(/\s+/g, '-')
}

export function compactStatusLabel(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')

  switch (normalized) {
    case 'running':
    case 'processing':
    case 'sending':
    case 'waiting':
    case 'inprogress':
    case 'started':
      return '处理中'
    case 'connected':
    case 'ready':
    case 'open':
    case 'active':
      return '在线'
    case 'archived':
      return '归档'
    case 'failed':
    case 'error':
    case 'systemerror':
      return '异常'
    default:
      return '空闲'
  }
}

export type ComposerStatusTone = 'active' | 'warning' | 'error' | 'neutral'

type ComposerStatusDetailRow = {
  label: string
  value: string
}

export type ComposerStatusInfo = {
  label: string
  tone: ComposerStatusTone
  summary: string
  detailRows: ComposerStatusDetailRow[]
  noticeTitle?: string
  noticeMessage?: string
}

function normalizeStatusValue(value?: string) {
  return (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')
}

function formatStatusValueLabel(value?: string) {
  const normalized = normalizeStatusValue(value)

  switch (normalized) {
    case 'running':
    case 'processing':
    case 'sending':
    case 'waiting':
    case 'inprogress':
    case 'started':
      return '处理中'
    case 'archived':
      return '已归档'
    case 'failed':
    case 'error':
    case 'systemerror':
      return '异常'
    case 'reviewing':
      return '待审批'
    case 'interrupted':
      return '已停止'
    case 'completed':
      return '已完成'
    case 'idle':
    case 'connected':
    case 'ready':
    case 'open':
    case 'active':
      return '空闲'
    case 'notloaded':
      return '未载入'
    case '':
      return '未知'
    default:
      return value ?? '未知'
  }
}

function readStatusReason(value: unknown): string {
  if (!value) {
    return ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (value instanceof Error) {
    return value.message.trim()
  }

  if (typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>
  const directKeys = ['message', 'error', 'detail', 'reason', 'summary']
  for (const key of directKeys) {
    const next = record[key]
    if (typeof next === 'string' && next.trim() !== '') {
      return next.trim()
    }
  }

  for (const key of directKeys) {
    const next = record[key]
    const nested = readStatusReason(next)
    if (nested) {
      return nested
    }
  }

  return ''
}

function describeStreamState(value: string) {
  switch (value) {
    case 'open':
      return 'Live'
    case 'connecting':
      return '连接中'
    case 'closed':
      return '连接已断开'
    case 'error':
      return '连接异常'
    default:
      return '未连接'
  }
}

export function buildComposerStatusInfo(input: {
  streamState: string
  rawThreadStatus?: string
  latestTurnStatus?: string
  latestTurnError?: unknown
  sendError?: string | null
  requiresOpenAIAuth: boolean
  isApprovalDialogOpen: boolean
  approvalSummary?: string
  isWaitingForThreadData: boolean
  pendingPhase?: 'sending' | 'waiting'
  isThreadInterruptible: boolean
  isThreadLoaded: boolean | null
}) {
  const rawThreadStatus = input.rawThreadStatus ?? ''
  const latestTurnStatus = input.latestTurnStatus ?? ''
  const rawNormalized = normalizeStatusValue(rawThreadStatus)
  const latestTurnNormalized = normalizeStatusValue(latestTurnStatus)
  const latestTurnErrorMessage = readStatusReason(input.latestTurnError)
  const sendErrorMessage = input.sendError?.trim() ?? ''
  const detailRows: ComposerStatusDetailRow[] = [
    {
      label: '线程载入',
      value: input.isThreadLoaded === null ? '未知' : input.isThreadLoaded ? '已加载' : '未加载',
    },
    { label: '实时连接', value: describeStreamState(input.streamState) },
    { label: '线程原始状态', value: formatStatusValueLabel(rawThreadStatus) },
  ]

  if (latestTurnStatus) {
    detailRows.push({ label: '最近 Turn 状态', value: formatStatusValueLabel(latestTurnStatus) })
  }
  if (latestTurnErrorMessage) {
    detailRows.push({ label: '最近错误', value: latestTurnErrorMessage })
  }
  if (sendErrorMessage) {
    detailRows.push({ label: '发送错误', value: sendErrorMessage })
  }
  if (input.approvalSummary) {
    detailRows.push({ label: '审批状态', value: input.approvalSummary })
  }

  if (input.requiresOpenAIAuth) {
    return {
      label: '认证异常',
      tone: 'error',
      summary: 'OpenAI 认证失效，线程当前无法继续执行。',
      detailRows,
      noticeTitle: '线程认证异常',
      noticeMessage: 'OpenAI 认证失效，线程当前无法继续执行。',
    } satisfies ComposerStatusInfo
  }

  if (input.isApprovalDialogOpen) {
    return {
      label: '待审批',
      tone: 'warning',
      summary: input.approvalSummary
        ? `线程正在等待审批：${input.approvalSummary}`
        : '线程正在等待审批，暂不会继续执行。',
      detailRows,
    } satisfies ComposerStatusInfo
  }

  if (input.isWaitingForThreadData || input.isThreadInterruptible) {
    return {
      label: '处理中',
      tone: 'active',
      summary:
        input.pendingPhase === 'sending'
          ? '消息已提交，正在等待 runtime 创建 turn。'
          : '线程正在执行或等待当前 turn 完成。',
      detailRows,
    } satisfies ComposerStatusInfo
  }

  if (latestTurnErrorMessage) {
    return {
      label: '异常',
      tone: 'error',
      summary: latestTurnErrorMessage,
      detailRows,
      noticeTitle: '线程运行异常',
      noticeMessage: latestTurnErrorMessage,
    } satisfies ComposerStatusInfo
  }

  if (sendErrorMessage) {
    return {
      label: '异常',
      tone: 'error',
      summary: sendErrorMessage,
      detailRows,
      noticeTitle: '线程发送异常',
      noticeMessage: sendErrorMessage,
    } satisfies ComposerStatusInfo
  }

  if (rawNormalized === 'systemerror') {
    if (
      !latestTurnErrorMessage &&
      input.isThreadLoaded !== false &&
      latestTurnNormalized !== 'error' &&
      latestTurnNormalized !== 'failed'
    ) {
      return null
    }

    return {
      label: '异常',
      tone: 'error',
      summary:
        input.isThreadLoaded === false
          ? 'Runtime 将线程标记为 systemError，且当前线程未处于已加载状态。'
          : 'Runtime 将线程标记为 systemError，但没有返回更具体的错误信息。',
      detailRows,
      noticeTitle: '线程运行异常',
      noticeMessage:
        input.isThreadLoaded === false
          ? 'Runtime 将线程标记为 systemError，且当前线程未处于已加载状态。'
          : 'Runtime 将线程标记为 systemError，但没有返回更具体的错误信息。',
    } satisfies ComposerStatusInfo
  }

  if (rawNormalized === 'archived') {
    return {
      label: '已归档',
      tone: 'warning',
      summary: '当前线程已归档。',
      detailRows,
    } satisfies ComposerStatusInfo
  }

  if (rawNormalized === 'interrupted') {
    return {
      label: '已停止',
      tone: 'warning',
      summary: '线程执行已被中断。',
      detailRows,
    } satisfies ComposerStatusInfo
  }

  return null
}

export function compactSyncLabel(label: string, streamState: string) {
  if (label === 'Syncing…') {
    return '同步中'
  }

  if (label.startsWith('Next sync ')) {
    return label.slice('Next sync '.length)
  }

  if (label === 'Manual sync') {
    return '手动'
  }

  if (label === 'Live' || streamState === 'open') {
    return 'Live'
  }

  return label
}

export function formatSyncCountdown(lastSyncAtMs: number, intervalMs: number, nowMs: number) {
  if (!lastSyncAtMs || !intervalMs) {
    return 'soon'
  }

  const remainingMs = Math.max(0, lastSyncAtMs + intervalMs - nowMs)
  if (remainingMs < 1_000) {
    return 'soon'
  }

  const totalSeconds = Math.ceil(remainingMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (!minutes) {
    return `${totalSeconds}s`
  }

  return `${minutes}m ${seconds}s`
}

export function ContextUsageIndicator({
  compactDisabledReason,
  compactFeedback,
  compactPending,
  contextWindow,
  onCompact,
  percent,
  totalTokens,
  usage,
}: {
  usage: ThreadTokenUsage | null | undefined
  percent: number | null
  totalTokens: number
  contextWindow: number
  compactDisabledReason: string | null
  compactFeedback: ContextCompactionFeedback | null
  compactPending: boolean
  onCompact: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const usagePercent = percent ?? 0
  const tone =
    percent === null
      ? 'idle'
      : usagePercent >= 85
        ? 'critical'
        : usagePercent >= 65
          ? 'warning'
          : 'healthy'

  const label = percent === null ? '--' : `${usagePercent}%`
  const title =
    percent === null
      ? 'Context usage is not available until the runtime reports token usage.'
      : `Context usage ${usagePercent}% (${totalTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens)`
  const totalBreakdown = usage?.total
  const lastBreakdown = usage?.last
  const compactButtonLabel = compactPending
    ? 'Starting'
    : compactFeedback?.phase === 'requested'
      ? 'Queued'
      : compactFeedback?.phase === 'failed'
        ? 'Retry'
        : 'Compact'

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div
      ref={containerRef}
      className={
        isOpen
          ? `composer-context-usage composer-context-usage--${tone} composer-context-usage--open`
          : `composer-context-usage composer-context-usage--${tone}`
      }
      style={{ ['--context-usage-percent' as string]: `${usagePercent}%` } as CSSProperties}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={title}
        className="composer-context-usage__summary"
        onClick={() => setIsOpen((current) => !current)}
        title={title}
        type="button"
      >
        <span aria-hidden="true" className="composer-context-usage__ring" />
        <span aria-hidden="true" className="composer-context-usage__core" />
        <span className="composer-context-usage__value">{label}</span>
      </button>
      {isOpen ? (
        <div className="composer-context-usage__popover" role="dialog">
          <div className="composer-context-usage__header">
            <strong>Context</strong>
            <span className={`composer-context-usage__pill composer-context-usage__pill--${tone}`}>
              {label}
            </span>
          </div>
          {percent === null ? (
            <p className="composer-context-usage__empty">No usage data</p>
          ) : (
            <div className="composer-context-usage__metric-grid">
              <div className="composer-context-usage__metric">
                <span>Total</span>
                <strong>{totalTokens.toLocaleString()}</strong>
              </div>
              <div className="composer-context-usage__metric">
                <span>Window</span>
                <strong>{contextWindow.toLocaleString()}</strong>
              </div>
              <div className="composer-context-usage__metric">
                <span>Input</span>
                <strong>{(totalBreakdown?.inputTokens ?? 0).toLocaleString()}</strong>
              </div>
              <div className="composer-context-usage__metric">
                <span>Output</span>
                <strong>{(totalBreakdown?.outputTokens ?? 0).toLocaleString()}</strong>
              </div>
              <div className="composer-context-usage__metric">
                <span>Reasoning</span>
                <strong>{(totalBreakdown?.reasoningOutputTokens ?? 0).toLocaleString()}</strong>
              </div>
              <div className="composer-context-usage__metric">
                <span>Last Turn</span>
                <strong>{(lastBreakdown?.totalTokens ?? 0).toLocaleString()}</strong>
              </div>
            </div>
          )}
          <div className="composer-context-usage__action">
            {compactFeedback ? (
              <span
                aria-live="polite"
                className={
                  compactFeedback.phase === 'failed'
                    ? 'composer-context-usage__status composer-context-usage__status--error'
                    : compactFeedback.phase === 'completed'
                      ? 'composer-context-usage__status composer-context-usage__status--success'
                      : 'composer-context-usage__status composer-context-usage__status--pending'
                }
                role="status"
              >
                {compactFeedback.title}
              </span>
            ) : null}
            <button
              className="ide-button ide-button--secondary composer-context-usage__compact-button"
              disabled={
                Boolean(compactDisabledReason) ||
                compactPending ||
                compactFeedback?.phase === 'requested'
              }
              onClick={onCompact}
              title={compactDisabledReason ?? 'Compact older thread context'}
              type="button"
            >
              <span aria-hidden="true" className="composer-context-usage__compact-icon">
                <SparkIcon />
              </span>
              <span>{compactButtonLabel}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ComposerStatusIndicator({ info }: { info: ComposerStatusInfo }) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<{ bottom: number; right: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function updatePosition() {
      const trigger = triggerRef.current
      if (!trigger) {
        return
      }

      const rect = trigger.getBoundingClientRect()
      const viewportPadding = 12
      const estimatedWidth = 320
      const bottom = Math.max(viewportPadding, window.innerHeight - rect.top + 8)
      const right = Math.max(viewportPadding, window.innerWidth - rect.right)
      const maxRight = Math.max(viewportPadding, window.innerWidth - viewportPadding - estimatedWidth)

      setPosition({
        bottom,
        right: Math.max(viewportPadding, Math.min(right, maxRight)),
      })
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (containerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return
      }

      setIsOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    const frameId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const popover =
    isOpen && position
      ? createPortal(
          <div
            className="composer-thread-status__popover"
            role="dialog"
            ref={popoverRef}
            style={{ bottom: `${position.bottom}px`, right: `${position.right}px` }}
          >
            <div className="composer-thread-status__popover-header">
              <strong>{info.label}</strong>
              <span>{info.summary}</span>
            </div>
            <div className="composer-thread-status__popover-grid">
              {info.detailRows.map((row) => (
                <div className="composer-thread-status__popover-row" key={`${row.label}-${row.value}`}>
                  <span>{row.label}</span>
                  <strong title={row.value}>{row.value}</strong>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div
      className={
        isOpen
          ? `composer-thread-status composer-thread-status--${info.tone} composer-thread-status--open`
          : `composer-thread-status composer-thread-status--${info.tone}`
      }
      ref={containerRef}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`${info.label}: ${info.summary}`}
        className="composer-thread-status__trigger"
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        title={info.summary}
        type="button"
      >
        <span className="composer-thread-status__dot" />
        <span className="composer-thread-status__label">{info.label}</span>
      </button>
      {popover}
    </div>
  )
}
