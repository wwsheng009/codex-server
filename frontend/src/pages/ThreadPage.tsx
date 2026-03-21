import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams } from 'react-router-dom'

import {
  ApprovalIcon,
  ContextIcon,
  FeedIcon,
  FolderClosedIcon,
  PanelOpenIcon,
  RailIconButton,
  RefreshIcon,
  ResizeHandle,
  SendIcon,
  SettingsIcon,
  SparkIcon,
  StopIcon,
  TerminalIcon,
  ToolsIcon,
} from '../components/ui/RailControls'
import { ThreadTerminalBlock } from '../components/thread/ThreadContent'
import {
  buildComposerAutocompleteKey,
  getComposerAutocompleteMatch,
  normalizeComposerFileSearchItem,
  replaceComposerAutocompleteToken,
} from '../lib/composer-autocomplete'
import {
  readRightRailExpanded,
  readRightRailWidth,
  readSurfacePanelSides,
  readSurfacePanelWidths,
  writeRightRailExpanded,
  writeRightRailWidth,
  writeSurfacePanelSides,
  writeSurfacePanelWidths,
} from '../lib/layout-state'
import {
  layoutConfig,
  type SurfacePanelSide,
  type SurfacePanelView,
} from '../lib/layout-config'
import { getErrorMessage, isAuthenticationError } from '../lib/error-utils'
import { computeContextUsage } from '../lib/thread-token-usage'
import { InlineNotice } from '../components/ui/InlineNotice'
import { isApiClientErrorCode } from '../lib/api-client'
import { SelectControl } from '../components/ui/SelectControl'
import { ApprovalDialog, ApprovalStack, LiveFeed, TurnTimeline } from '../components/workspace/renderers'
import { buildLiveTimelineEntries, formatRelativeTimeShort } from '../components/workspace/timeline-utils'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { getAccount, getRateLimits } from '../features/account/api'
import { listPendingApprovals, respondServerRequestWithDetails } from '../features/approvals/api'
import { listCollaborationModes, listMcpServerStatus, listModels, listSkills } from '../features/catalog/api'
import { useSettingsLocalStore } from '../features/settings/local-store'
import { fuzzyFileSearch } from '../features/settings/api'
import { startCommand, terminateCommand, writeCommand } from '../features/commands/api'
import {
  archiveThread,
  compactThread,
  deleteThread,
  getThread,
  listLoadedThreadIds,
  listThreads,
  renameThread,
  resumeThread,
  unarchiveThread,
} from '../features/threads/api'
import { interruptTurn, startTurn } from '../features/turns/api'
import { getWorkspace } from '../features/workspaces/api'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useWorkspaceStream } from '../hooks/useWorkspaceStream'
import { useSessionStore } from '../stores/session-store'
import { getSelectedThreadIdForWorkspace } from '../stores/session-store-utils'
import { useUIStore } from '../stores/ui-store'
import {
  isViewportNearBottom,
  latestSettledMessageKey,
  shouldRefreshApprovalsForEvent,
  shouldRefreshThreadDetailForEvent,
  shouldRefreshThreadsForEvent,
  shouldThrottleThreadDetailRefreshForEvent,
} from './threadPageUtils'
import { applyLiveThreadEvents, upsertPendingUserMessage } from './threadLiveState'
import type { CatalogItem, RateLimit, ServerEvent, Thread, ThreadTokenUsage, ThreadTurn, TurnResult } from '../types/api'

const EMPTY_EVENTS: ServerEvent[] = []
const EMPTY_COMMAND_SESSIONS = {}
const MIN_SEND_FEEDBACK_MS = 700
const COMPOSER_PREFERENCES_STORAGE_PREFIX = 'codex-server:composer-preferences:'
const FALLBACK_MODEL_OPTIONS = ['gpt-5.4', 'gpt-5.3-codex']

type ComposerPermissionPreset = 'default' | 'full-access'
type ComposerReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
type ComposerCollaborationMode = 'default' | 'plan'

type PendingThreadTurn = {
  localId: string
  threadId: string
  input: string
  submittedAt: string
  phase: 'sending' | 'waiting'
  turnId?: string
}

type ContextCompactionFeedback = {
  phase: 'requested' | 'completed' | 'failed'
  title: string
  threadId: string
}

type ComposerPreferences = {
  permissionPreset: ComposerPermissionPreset
  model: string
  reasoningEffort: ComposerReasoningEffort
  collaborationMode: ComposerCollaborationMode
}

const DEFAULT_COMPOSER_PREFERENCES: ComposerPreferences = {
  permissionPreset: 'default',
  model: '',
  reasoningEffort: 'medium',
  collaborationMode: 'default',
}

type ComposerAssistPanel = 'mcp' | 'personalization' | 'status' | 'worktree'
type ComposerCommandMenu = 'root' | 'review'

type ComposerCommandId =
  | 'mcp'
  | 'personalization'
  | 'review'
  | 'feedback'
  | 'worktree'
  | 'status'
  | 'plan'

type ComposerCommandAction =
  | { kind: 'panel'; panel: ComposerAssistPanel }
  | { kind: 'prompt'; prompt: string }
  | { kind: 'submenu'; menu: ComposerCommandMenu }
  | { kind: 'toggle-plan' }

type ComposerCommandDefinition = {
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

type ComposerOptionIcon =
  | 'feedback'
  | 'file'
  | 'mcp'
  | 'personalization'
  | 'plan'
  | 'review'
  | 'skill'
  | 'status'
  | 'worktree'

type ComposerAutocompleteItem =
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

type ComposerAutocompleteSection = {
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

function buildComposerCommandDefinitions(
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
      description:
        collaborationMode === 'plan' ? '关闭计划模式' : '开启计划模式',
      keywords: ['plan', 'planning', '计划', 'plan mode'],
      icon: 'plan',
      action: { kind: 'toggle-plan' },
    },
  ]
}

function updateThreadStatusInList(
  current: Thread[] | undefined,
  threadId: string,
  status: string,
  updatedAt = new Date().toISOString(),
) {
  if (!current?.length) {
    return current
  }

  return current.map((item) =>
    item.id === threadId
      ? {
          ...item,
          status,
          updatedAt,
        }
      : item,
  )
}

function buildRetryPromptFromServerRequest(item: Record<string, unknown>) {
  const requestKind = typeof item.requestKind === 'string' ? item.requestKind : ''
  const details =
    typeof item.details === 'object' && item.details !== null
      ? (item.details as Record<string, unknown>)
      : {}

  switch (requestKind) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval': {
      const command = typeof details.command === 'string' ? details.command : ''
      return command
        ? `Please retry the command request for \`${command}\` so I can review it again.`
        : 'Please retry the previous command request so I can review it again.'
    }
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval': {
      const path = typeof details.path === 'string' ? details.path : ''
      if (path) {
        return `Please regenerate the proposed changes for \`${path}\` so I can review them again.`
      }

      const changes = Array.isArray(details.changes) ? details.changes.length : 0
      return changes
        ? `Please regenerate the previous ${changes} file change${changes === 1 ? '' : 's'} so I can review them again.`
        : 'Please regenerate the previous file changes so I can review them again.'
    }
    case 'item/tool/requestUserInput':
      return 'Please ask for the required user input again so I can answer it.'
    case 'item/permissions/requestApproval': {
      const reason = typeof details.reason === 'string' ? details.reason : ''
      return reason
        ? `Please retry the action that requested additional permissions. Reason: ${reason}`
        : 'Please retry the action that requested additional permissions and explain why they are needed.'
    }
    case 'mcpServer/elicitation/request': {
      const serverName = typeof details.serverName === 'string' ? details.serverName : ''
      return serverName
        ? `Please retry the MCP request for ${serverName} and ask me for the required input again.`
        : 'Please retry the MCP request and ask me for the required input again.'
    }
    case 'item/tool/call': {
      const tool = typeof details.tool === 'string' ? details.tool : ''
      return tool
        ? `Please retry the tool call \`${tool}\` and ask me for the required response again.`
        : 'Please retry the previous tool call and ask me for the required response again.'
    }
    case 'account/chatgptAuthTokens/refresh':
      return 'Please retry the authentication refresh flow and ask me for anything required.'
    default:
      return 'Please retry the previous request so I can complete it again.'
  }
}

function createPendingTurn(threadId: string, input: string): PendingThreadTurn {
  const localId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `pending-${Date.now()}`

  return {
    localId,
    threadId,
    input,
    submittedAt: new Date().toISOString(),
    phase: 'sending',
  }
}

function buildPendingThreadTurn(pendingTurn: PendingThreadTurn): ThreadTurn {
  return {
    id: pendingTurn.turnId ?? `pending-${pendingTurn.localId}`,
    status: pendingTurn.phase === 'sending' ? 'sending' : 'inProgress',
    items: [
      {
        content: [
          {
            text: pendingTurn.input,
            type: 'inputText',
          },
        ],
        id: `pending-user-${pendingTurn.localId}`,
        type: 'userMessage',
      },
    ],
  }
}

function shouldRetryTurnAfterResume(error: unknown) {
  if (isApiClientErrorCode(error, 'thread_not_found')) {
    return true
  }

  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('thread not found') || message.includes('thread not loaded')
}

function normalizePermissionPreset(value: string): ComposerPermissionPreset {
  return value === 'full-access' ? 'full-access' : 'default'
}

function normalizeReasoningEffort(value: string): ComposerReasoningEffort {
  switch (value) {
    case 'low':
    case 'high':
    case 'xhigh':
      return value
    default:
      return 'medium'
  }
}

function normalizeCollaborationMode(value: string): ComposerCollaborationMode {
  return value === 'plan' ? 'plan' : 'default'
}

function readComposerPreferences(workspaceId: string): ComposerPreferences {
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

function writeComposerPreferences(workspaceId: string, preferences: ComposerPreferences) {
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

function buildComposerAutocompleteSections(input: {
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
        matchesComposerQuery(query, [
          command.title,
          command.description,
          ...command.keywords,
        ]),
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
    .filter((skill) =>
      matchesComposerQuery(query, [skill.name, skill.description]),
    )
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

function composerSectionLabel(id: ComposerAutocompleteItem['section']) {
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

function formatShortTime(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return '未知'
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncateInlineText(value: string, maxLength = 120) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) {
    return compact
  }

  return `${compact.slice(0, Math.max(0, maxLength - 1))}…`
}

function describeRateLimits(rateLimits: RateLimit[] | undefined) {
  if (!rateLimits?.length) {
    return '不可用'
  }

  return rateLimits
    .slice(0, 2)
    .map((limit) => `${limit.name}: ${limit.remaining}/${limit.limit}`)
    .join(' · ')
}

function normalizeMcpServerState(entry: Record<string, unknown>) {
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

function ComposerCloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

function ComposerFileIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="M7 4.5h6l4 4v11a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 19.5V6A1.5 1.5 0 0 1 7.5 4.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M13 4.5V9h4.5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

function ComposerOptionGlyph({ icon }: { icon: ComposerOptionIcon }) {
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

function statusIsInterruptible(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  return ['running', 'processing', 'sending', 'waiting', 'inprogress', 'started'].includes(normalized)
}

function compactStatusTone(value?: string) {
  return (value ?? 'idle').toLowerCase().replace(/\s+/g, '-')
}

function compactStatusLabel(value?: string) {
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

type ComposerStatusTone = 'active' | 'warning' | 'error' | 'neutral'

type ComposerStatusDetailRow = {
  label: string
  value: string
}

type ComposerStatusInfo = {
  label: string
  tone: ComposerStatusTone
  summary: string
  detailRows: ComposerStatusDetailRow[]
  noticeTitle?: string
  noticeMessage?: string
}

function normalizeStatusValue(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  return normalized
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

function buildComposerStatusInfo(input: {
  streamState: string
  rawThreadStatus?: string
  latestTurnStatus?: string
  latestTurnError?: unknown
  sendError?: string | null
  requiresOpenAIAuth: boolean
  isApprovalDialogOpen: boolean
  approvalSummary?: string
  isWaitingForThreadData: boolean
  pendingPhase?: PendingThreadTurn['phase']
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
    { label: '线程载入', value: input.isThreadLoaded === null ? '未知' : input.isThreadLoaded ? '已加载' : '未加载' },
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
    if (!latestTurnErrorMessage && input.isThreadLoaded !== false && latestTurnNormalized !== 'error' && latestTurnNormalized !== 'failed') {
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

function compactSyncLabel(label: string, streamState: string) {
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

function formatSyncCountdown(lastSyncAtMs: number, intervalMs: number, nowMs: number) {
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

function ContextUsageIndicator({
  usage,
  percent,
  totalTokens,
  contextWindow,
  compactDisabledReason,
  compactFeedback,
  compactPending,
  onCompact,
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
      style={{ ['--context-usage-percent' as string]: `${usagePercent}%` }}
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
            <span className={`composer-context-usage__pill composer-context-usage__pill--${tone}`}>{label}</span>
          </div>
          {percent === null ? (
            <p className="composer-context-usage__empty">No usage data</p>
          ) : (
            <>
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
            </>
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
              disabled={Boolean(compactDisabledReason) || compactPending || compactFeedback?.phase === 'requested'}
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

function ComposerStatusIndicator({ info }: { info: ComposerStatusInfo }) {
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

export function ThreadPage() {
  const { workspaceId = '' } = useParams()
  const queryClient = useQueryClient()

  const [message, setMessage] = useState('')
  const [composerCaret, setComposerCaret] = useState(0)
  const [activeComposerPanel, setActiveComposerPanel] = useState<ComposerAssistPanel | null>(null)
  const [composerCommandMenu, setComposerCommandMenu] = useState<ComposerCommandMenu>('root')
  const [composerAutocompleteIndex, setComposerAutocompleteIndex] = useState(0)
  const [dismissedComposerAutocompleteKey, setDismissedComposerAutocompleteKey] = useState<string | null>(null)
  const [pendingTurnsByThread, setPendingTurnsByThread] = useState<Record<string, PendingThreadTurn>>({})
  const [sendError, setSendError] = useState<string | null>(null)
  const [contextCompactionFeedback, setContextCompactionFeedback] = useState<ContextCompactionFeedback | null>(null)
  const [command, setCommand] = useState('git status')
  const [stdinValue, setStdinValue] = useState('')
  const [selectedProcessId, setSelectedProcessId] = useState<string>()
  const [surfacePanelView, setSurfacePanelView] = useState<SurfacePanelView | null>(null)
  const [surfacePanelWidths, setSurfacePanelWidths] = useState(readSurfacePanelWidths)
  const [surfacePanelSides, setSurfacePanelSides] = useState(readSurfacePanelSides)
  const [isSurfacePanelResizing, setIsSurfacePanelResizing] = useState(false)
  const [editingThreadId, setEditingThreadId] = useState<string>()
  const [editingThreadName, setEditingThreadName] = useState('')
  const [isTerminalDockExpanded, setIsTerminalDockExpanded] = useState(false)
  const [isTerminalDockResizing, setIsTerminalDockResizing] = useState(false)
  const [terminalDockHeight, setTerminalDockHeight] = useState<number>(layoutConfig.workbench.terminalDock.defaultHeight)
  const [inspectorWidth, setInspectorWidth] = useState<number>(readRightRailWidth)
  const [isInspectorResizing, setIsInspectorResizing] = useState(false)
  const [isThreadToolsExpanded, setIsThreadToolsExpanded] = useState(false)
  const [isWorkbenchToolsExpanded, setIsWorkbenchToolsExpanded] = useState(false)
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(readRightRailExpanded)
  const [approvalAnswers, setApprovalAnswers] = useState<Record<string, Record<string, string>>>({})
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({})
  const [composerPreferences, setComposerPreferences] = useState<ComposerPreferences>(DEFAULT_COMPOSER_PREFERENCES)
  const [hasUnreadThreadUpdates, setHasUnreadThreadUpdates] = useState(false)
  const [isThreadPinnedToLatest, setIsThreadPinnedToLatest] = useState(true)
  const [syncClock, setSyncClock] = useState(() => Date.now())
  const [confirmingThreadDelete, setConfirmingThreadDelete] = useState<Thread | null>(null)
  const inspectorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const surfacePanelResizeRef = useRef<{ side: SurfacePanelSide; startX: number; startWidth: number; view: SurfacePanelView } | null>(null)
  const terminalDockResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const threadDetailRefreshTimerRef = useRef<number | null>(null)
  const threadViewportRef = useRef<HTMLDivElement | null>(null)
  const threadBottomRef = useRef<HTMLDivElement | null>(null)
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)
  const threadContentKeyRef = useRef('')
  const threadSettledMessageKeyRef = useRef('')
  const shouldFollowThreadRef = useRef(true)

  const setSelectedWorkspace = useSessionStore((state) => state.setSelectedWorkspace)
  const setSelectedThread = useSessionStore((state) => state.setSelectedThread)
  const removeThreadFromSession = useSessionStore((state) => state.removeThread)
  const removeCommandSession = useSessionStore((state) => state.removeCommandSession)
  const clearCompletedCommandSessions = useSessionStore((state) => state.clearCompletedCommandSessions)
  const mobileThreadToolsOpen = useUIStore((state) => state.mobileThreadToolsOpen)
  const setMobileThreadChrome = useUIStore((state) => state.setMobileThreadChrome)
  const setMobileThreadToolsOpen = useUIStore((state) => state.setMobileThreadToolsOpen)
  const resetMobileThreadChrome = useUIStore((state) => state.resetMobileThreadChrome)
  const responseTone = useSettingsLocalStore((state) => state.responseTone)
  const customInstructions = useSettingsLocalStore((state) => state.customInstructions)
  const maxWorktrees = useSettingsLocalStore((state) => state.maxWorktrees)
  const autoPruneDays = useSettingsLocalStore((state) => state.autoPruneDays)
  const reuseBranches = useSettingsLocalStore((state) => state.reuseBranches)
  const selectedThreadId = useSessionStore((state) => getSelectedThreadIdForWorkspace(state, workspaceId))
  const allThreadEvents = useSessionStore((state) => state.eventsByThread)
  const isMobileViewport = useMediaQuery('(max-width: 900px)')
  const streamState = useWorkspaceStream(workspaceId)
  const activeComposerMatch = useMemo(
    () => getComposerAutocompleteMatch(message, composerCaret),
    [composerCaret, message],
  )
  const activeComposerAutocompleteKey = buildComposerAutocompleteKey(activeComposerMatch)
  const deferredComposerQuery = useDeferredValue(activeComposerMatch?.query ?? '')
  const normalizedDeferredComposerQuery = deferredComposerQuery.trim()
  const composerCommandDefinitions = useMemo(
    () => buildComposerCommandDefinitions(composerPreferences.collaborationMode),
    [composerPreferences.collaborationMode],
  )

  const workspaceQuery = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(workspaceId),
  })
  const accountQuery = useQuery({
    queryKey: ['account'],
    queryFn: getAccount,
    staleTime: 15_000,
  })
  const rateLimitsQuery = useQuery({
    queryKey: ['rate-limits'],
    queryFn: getRateLimits,
    staleTime: 15_000,
    enabled: activeComposerPanel === 'status',
  })
  const threadsQuery = useQuery({
    queryKey: ['threads', workspaceId],
    queryFn: () => listThreads(workspaceId),
    enabled: Boolean(workspaceId),
  })
  const loadedThreadsQuery = useQuery({
    queryKey: ['loaded-threads', workspaceId],
    queryFn: () => listLoadedThreadIds(workspaceId),
    enabled: Boolean(workspaceId),
    refetchInterval: workspaceId && streamState !== 'open' ? 5_000 : false,
    staleTime: 5_000,
  })
  const modelsQuery = useQuery({
    queryKey: ['models', workspaceId],
    queryFn: () => listModels(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })
  const skillsQuery = useQuery({
    queryKey: ['skills', workspaceId],
    queryFn: () => listSkills(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })
  const mcpServerStatusQuery = useQuery({
    queryKey: ['mcp-server-status', workspaceId],
    queryFn: () => listMcpServerStatus(workspaceId),
    enabled: Boolean(workspaceId && activeComposerPanel === 'mcp'),
    staleTime: 30_000,
  })
  const collaborationModesQuery = useQuery({
    queryKey: ['collaboration-modes', workspaceId],
    queryFn: () => listCollaborationModes(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })
  const threadDetailQuery = useQuery({
    queryKey: ['thread-detail', workspaceId, selectedThreadId],
    queryFn: () => getThread(workspaceId, selectedThreadId ?? ''),
    enabled: Boolean(workspaceId && selectedThreadId),
    refetchInterval:
      selectedThreadId && Boolean(pendingTurnsByThread[selectedThreadId])
        ? 1_000
        : selectedThreadId && streamState !== 'open'
          ? 5_000
          : false,
  })
  const approvalsQuery = useQuery({
    queryKey: ['approvals', workspaceId],
    queryFn: () => listPendingApprovals(workspaceId),
    enabled: Boolean(workspaceId),
    refetchInterval: workspaceId && streamState !== 'open' ? 4_000 : false,
  })
  const fileSearchQuery = useQuery({
    queryKey: ['composer-file-search', workspaceId, normalizedDeferredComposerQuery],
    queryFn: () => fuzzyFileSearch(workspaceId, { query: normalizedDeferredComposerQuery }),
    enabled: Boolean(
      workspaceId &&
        activeComposerMatch?.mode === 'mention' &&
        normalizedDeferredComposerQuery,
    ),
    staleTime: 15_000,
  })

  async function invalidateThreadQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
    ])
  }

  function clearPendingTurn(threadId: string) {
    setPendingTurnsByThread((current) => {
      if (!(threadId in current)) {
        return current
      }

      const next = { ...current }
      delete next[threadId]
      return next
    })
  }

  function updatePendingTurn(
    threadId: string,
    updater: (current: PendingThreadTurn | null) => PendingThreadTurn | null,
  ) {
    setPendingTurnsByThread((current) => {
      const nextValue = updater(current[threadId] ?? null)
      if (!nextValue) {
        if (!(threadId in current)) {
          return current
        }

        const next = { ...current }
        delete next[threadId]
        return next
      }

      return {
        ...current,
        [threadId]: nextValue,
      }
    })
  }

  const renameThreadMutation = useMutation({
    mutationFn: ({ threadId, name }: { threadId: string; name: string }) =>
      renameThread(workspaceId, threadId, { name }),
    onSuccess: async () => {
      setEditingThreadId(undefined)
      setEditingThreadName('')
      await invalidateThreadQueries()
    },
  })
  const archiveThreadMutation = useMutation({
    mutationFn: (threadId: string) => archiveThread(workspaceId, threadId),
    onSuccess: async () => {
      await invalidateThreadQueries()
    },
  })
  const unarchiveThreadMutation = useMutation({
    mutationFn: (threadId: string) => unarchiveThread(workspaceId, threadId),
    onSuccess: async () => {
      await invalidateThreadQueries()
    },
  })
  const deleteThreadMutation = useMutation({
    mutationFn: (threadId: string) => deleteThread(workspaceId, threadId),
    onSuccess: async (_, threadId) => {
      queryClient.setQueryData<Thread[]>(['threads', workspaceId], (current) =>
        (current ?? []).filter((thread) => thread.id !== threadId),
      )
      queryClient.setQueryData<Thread[]>(['shell-threads', workspaceId], (current) =>
        (current ?? []).filter((thread) => thread.id !== threadId),
      )
      queryClient.removeQueries({ queryKey: ['thread-detail', workspaceId, threadId] })

      const remainingThreads =
        (queryClient.getQueryData<Thread[]>(['threads', workspaceId]) ?? []).filter(
          (thread) => thread.id !== threadId,
        )

      setEditingThreadId((current) => (current === threadId ? undefined : current))
      setEditingThreadName('')
      clearPendingTurn(threadId)
      setSendError(null)
      setConfirmingThreadDelete(null)
      deleteThreadMutation.reset()
      removeThreadFromSession(workspaceId, threadId)

      if (selectedThreadId === threadId) {
        setSelectedThread(workspaceId, remainingThreads[0]?.id)
      }

      await Promise.all([
        invalidateThreadQueries(),
        queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] }),
      ])
    },
  })
  const compactThreadMutation = useMutation({
    mutationFn: (threadId: string) => compactThread(workspaceId, threadId),
    onMutate: (threadId) => {
      setContextCompactionFeedback({
        threadId,
        phase: 'requested',
        title: 'Queued',
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    },
    onError: (error, threadId) => {
      void error
      setContextCompactionFeedback({
        threadId,
        phase: 'failed',
        title: 'Failed',
      })
    },
  })
  const startTurnMutation = useMutation<
    TurnResult,
    Error,
    {
      threadId: string
      input: string
      model?: string
      reasoningEffort?: string
      permissionPreset?: string
      collaborationMode?: string
    }
  >({
    mutationFn: ({ threadId, input, model, reasoningEffort, permissionPreset, collaborationMode }) =>
      startTurn(workspaceId, threadId, {
        input,
        model,
        reasoningEffort,
        permissionPreset,
        collaborationMode,
      }),
  })
  const interruptTurnMutation = useMutation({
    mutationFn: () => interruptTurn(workspaceId, selectedThreadId ?? ''),
    onSuccess: async () => {
      if (selectedThreadId) {
        clearPendingTurn(selectedThreadId)
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] }),
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    },
  })
  const respondApprovalMutation = useMutation({
    mutationFn: ({
      requestId,
      action,
      answers,
    }: {
      requestId: string
      action: string
      answers?: Record<string, string[]>
    }) => respondServerRequestWithDetails(requestId, { action, answers }),
    onSuccess: async (_, variables) => {
      setApprovalAnswers((current) => {
        const next = { ...current }
        delete next[variables.requestId]
        return next
      })
      setApprovalErrors((current) => {
        const next = { ...current }
        delete next[variables.requestId]
        return next
      })
      await queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] })
    },
  })
  const startCommandMutation = useMutation({
    mutationFn: (input: { command: string }) => startCommand(workspaceId, input),
    onSuccess: (session) => {
      useSessionStore.getState().upsertCommandSession(session)
      setSelectedProcessId(session.id)
      setIsTerminalDockExpanded(true)
      setCommand('')
    },
  })
  const writeCommandMutation = useMutation({
    mutationFn: ({ processId, input }: { processId: string; input: string }) =>
      writeCommand(workspaceId, processId, { input }),
    onSuccess: () => {
      setStdinValue('')
    },
  })
  const terminateCommandMutation = useMutation({
    mutationFn: (processId: string) => terminateCommand(workspaceId, processId),
  })

  const selectedThreadEvents = useSessionStore((state) =>
    selectedThreadId ? state.eventsByThread[selectedThreadId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  )
  const selectedThreadTokenUsage = useSessionStore((state) =>
    selectedThreadId ? state.tokenUsageByThread[selectedThreadId] ?? null : null,
  )
  const workspaceEvents = useSessionStore((state) =>
    workspaceId ? state.workspaceEventsByWorkspace[workspaceId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  )
  const workspaceActivityEvents = useSessionStore((state) =>
    workspaceId ? state.activityEventsByWorkspace[workspaceId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  )
  const workspaceCommandSessions = useSessionStore((state) =>
    workspaceId
      ? state.commandSessionsByWorkspace[workspaceId] ?? (EMPTY_COMMAND_SESSIONS as typeof state.commandSessionsByWorkspace[string])
      : (EMPTY_COMMAND_SESSIONS as typeof state.commandSessionsByWorkspace[string]),
  )
  const liveThreadDetail = useMemo(
    () => applyLiveThreadEvents(threadDetailQuery.data, selectedThreadEvents),
    [selectedThreadEvents, threadDetailQuery.data],
  )

  const commandSessions = useMemo(
    () =>
      Object.values(workspaceCommandSessions).sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [workspaceCommandSessions],
  )
  const activePendingTurn = selectedThreadId ? pendingTurnsByThread[selectedThreadId] ?? null : null
  const collaborationModes = collaborationModesQuery.data ?? []
  const supportsPlanMode = collaborationModes.some(
    (mode) => normalizeCollaborationMode(mode.mode ?? mode.id) === 'plan',
  )
  const isMentionAutocompleteOpen =
    activeComposerMatch?.mode === 'mention' &&
    activeComposerAutocompleteKey !== dismissedComposerAutocompleteKey
  const isSkillAutocompleteOpen =
    activeComposerMatch?.mode === 'skill' &&
    activeComposerAutocompleteKey !== dismissedComposerAutocompleteKey
  const isCommandAutocompleteOpen =
    ((activeComposerMatch?.mode === 'command' &&
      activeComposerAutocompleteKey !== dismissedComposerAutocompleteKey) ||
      composerCommandMenu === 'review')
  const normalizedMentionFiles = useMemo(
    () =>
      (fileSearchQuery.data?.files ?? [])
        .map((entry) => normalizeComposerFileSearchItem(entry))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    [fileSearchQuery.data?.files],
  )
  const composerAutocompleteSections = useMemo(() => {
    if (isCommandAutocompleteOpen) {
      return buildComposerAutocompleteSections({
        mode: 'command',
        commands: composerCommandDefinitions,
        commandMenu: composerCommandMenu,
        query:
          activeComposerMatch?.mode === 'command'
            ? deferredComposerQuery
            : '',
        skills: skillsQuery.data ?? [],
        files: [],
      })
    }

    if (isSkillAutocompleteOpen) {
      return buildComposerAutocompleteSections({
        mode: 'skill',
        commands: [],
        commandMenu: 'root',
        query:
          activeComposerMatch?.mode === 'skill'
            ? deferredComposerQuery
            : '',
        skills: skillsQuery.data ?? [],
        files: [],
      })
    }

    if (isMentionAutocompleteOpen) {
      return buildComposerAutocompleteSections({
        mode: 'mention',
        commands: [],
        commandMenu: 'root',
        query: '',
        skills: [],
        files: normalizedMentionFiles,
      })
    }

    return []
  }, [
    activeComposerMatch?.mode,
    composerCommandDefinitions,
    composerCommandMenu,
    deferredComposerQuery,
    isCommandAutocompleteOpen,
    isMentionAutocompleteOpen,
    isSkillAutocompleteOpen,
    normalizedMentionFiles,
    skillsQuery.data,
  ])
  const composerAutocompleteItems = useMemo(
    () => composerAutocompleteSections.flatMap((section) => section.items),
    [composerAutocompleteSections],
  )
  const composerAutocompleteSectionGroups = useMemo(() => {
    let offset = 0

    return composerAutocompleteSections.map((section) => {
      const indexedItems = section.items.map((item) => {
        const indexedItem = { item, index: offset }
        offset += 1
        return indexedItem
      })

      return {
        ...section,
        indexedItems,
      }
    })
  }, [composerAutocompleteSections])
  const composerAutocompleteItem =
    composerAutocompleteItems[
      Math.max(0, Math.min(composerAutocompleteIndex, composerAutocompleteItems.length - 1))
    ] ?? null
  const mcpServerStates = useMemo(
    () =>
      (mcpServerStatusQuery.data?.data ?? []).map((entry) =>
        normalizeMcpServerState(entry),
      ),
    [mcpServerStatusQuery.data?.data],
  )
  const showMentionSearchHint =
    isMentionAutocompleteOpen &&
    !normalizedDeferredComposerQuery &&
    !fileSearchQuery.isFetching &&
    !composerAutocompleteItems.length
  const showSkillSearchLoading =
    isSkillAutocompleteOpen &&
    skillsQuery.isFetching &&
    !composerAutocompleteItems.length

  useEffect(() => {
    setSelectedWorkspace(workspaceId)
  }, [setSelectedWorkspace, workspaceId])

  useEffect(() => {
    setComposerPreferences(readComposerPreferences(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    writeComposerPreferences(workspaceId, composerPreferences)
  }, [composerPreferences, workspaceId])

  useEffect(() => {
    if (!supportsPlanMode && composerPreferences.collaborationMode === 'plan') {
      setComposerPreferences((current) => ({
        ...current,
        collaborationMode: 'default',
      }))
    }
  }, [composerPreferences.collaborationMode, supportsPlanMode])

  useEffect(() => {
    setActiveComposerPanel(null)
    setComposerCommandMenu('root')
    setComposerAutocompleteIndex(0)
    setDismissedComposerAutocompleteKey(null)
    setContextCompactionFeedback(null)
  }, [selectedThreadId, workspaceId])

  useEffect(() => {
    setComposerAutocompleteIndex(0)
  }, [activeComposerAutocompleteKey, composerCommandMenu])

  useEffect(() => {
    if (composerAutocompleteIndex < composerAutocompleteItems.length) {
      return
    }

    setComposerAutocompleteIndex(0)
  }, [composerAutocompleteIndex, composerAutocompleteItems.length])

  useEffect(() => {
    setPendingTurnsByThread({})
  }, [workspaceId])

  useEffect(() => {
    if (!isMobileViewport) {
      return
    }

    setIsTerminalDockExpanded(false)
  }, [isMobileViewport])

  useEffect(() => {
    const currentThreads = threadsQuery.data ?? []
    if (!currentThreads.length) {
      return
    }

    if (!selectedThreadId) {
      setSelectedThread(workspaceId, currentThreads[0].id)
      return
    }

    const hasSelectedThread = currentThreads.some((thread) => thread.id === selectedThreadId)
    if (!hasSelectedThread && threadDetailQuery.data?.id !== selectedThreadId) {
      setSelectedThread(workspaceId, currentThreads[0].id)
    }
  }, [selectedThreadId, setSelectedThread, threadDetailQuery.data?.id, threadsQuery.data, workspaceId])

  useEffect(() => {
    shouldFollowThreadRef.current = true
    threadContentKeyRef.current = ''
    threadSettledMessageKeyRef.current = ''
    setHasUnreadThreadUpdates(false)
    setIsThreadPinnedToLatest(true)

    if (!selectedThreadId) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      threadBottomRef.current?.scrollIntoView({ block: 'end' })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [selectedThreadId])

  useEffect(() => {
    if (!selectedThreadId || !activePendingTurn?.turnId) {
      return
    }

    const turns = threadDetailQuery.data?.turns ?? []
    if (!turns.some((turn) => turn.id === activePendingTurn.turnId)) {
      return
    }

    const submittedAtMs = new Date(activePendingTurn.submittedAt).getTime()
    const elapsedMs = Number.isNaN(submittedAtMs) ? MIN_SEND_FEEDBACK_MS : Date.now() - submittedAtMs
    const remainingMs = Math.max(0, MIN_SEND_FEEDBACK_MS - elapsedMs)

    if (remainingMs === 0) {
      clearPendingTurn(selectedThreadId)
      return
    }

    const timeoutId = window.setTimeout(() => {
      clearPendingTurn(selectedThreadId)
    }, remainingMs)

    return () => window.clearTimeout(timeoutId)
  }, [activePendingTurn, clearPendingTurn, liveThreadDetail?.turns, selectedThreadId])

  useEffect(() => {
    if (!selectedThreadId || !selectedThreadEvents.length) {
      return
    }

    const latestEvent = selectedThreadEvents[selectedThreadEvents.length - 1]
    if (shouldRefreshThreadsForEvent(latestEvent.method)) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    }

    if (!shouldRefreshThreadDetailForEvent(latestEvent.method)) {
      return
    }

    const runRefresh = () => {
      threadDetailRefreshTimerRef.current = null
      void queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] })
    }

    if (threadDetailRefreshTimerRef.current) {
      window.clearTimeout(threadDetailRefreshTimerRef.current)
      threadDetailRefreshTimerRef.current = null
    }

    if (shouldThrottleThreadDetailRefreshForEvent(latestEvent.method)) {
      return
    }

    runRefresh()
  }, [queryClient, selectedThreadEvents, selectedThreadId, workspaceId])

  useEffect(() => {
    if (
      !selectedThreadId ||
      !contextCompactionFeedback ||
      contextCompactionFeedback.threadId !== selectedThreadId ||
      contextCompactionFeedback.phase !== 'requested' ||
      !selectedThreadEvents.length
    ) {
      return
    }

    const latestEvent = selectedThreadEvents[selectedThreadEvents.length - 1]
    if (latestEvent.method !== 'thread/compacted') {
      return
    }

    setContextCompactionFeedback({
      threadId: selectedThreadId,
      phase: 'completed',
      title: 'Compacted',
    })
  }, [contextCompactionFeedback, selectedThreadEvents, selectedThreadId])

  useEffect(() => {
    if (!workspaceActivityEvents.length) {
      return
    }

    const latestEvent = workspaceActivityEvents[workspaceActivityEvents.length - 1]

    if (shouldRefreshThreadsForEvent(latestEvent.method)) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    }

    if (shouldRefreshApprovalsForEvent(latestEvent.method, latestEvent.serverRequestId)) {
      void queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] })
    }
  }, [queryClient, workspaceActivityEvents, workspaceId])

  useEffect(
    () => () => {
      if (threadDetailRefreshTimerRef.current) {
        window.clearTimeout(threadDetailRefreshTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    const entries = Object.values(pendingTurnsByThread)
    if (!entries.length) {
      return
    }

    const timeoutIds: number[] = []

    for (const entry of entries) {
      if (!entry.turnId) {
        continue
      }

      const hasCompletedEvent = (allThreadEvents[entry.threadId] ?? []).some(
        (event) => event.turnId === entry.turnId && event.method === 'turn/completed',
      )
      if (!hasCompletedEvent) {
        continue
      }

      const submittedAtMs = new Date(entry.submittedAt).getTime()
      const elapsedMs = Number.isNaN(submittedAtMs) ? MIN_SEND_FEEDBACK_MS : Date.now() - submittedAtMs
      const remainingMs = Math.max(0, MIN_SEND_FEEDBACK_MS - elapsedMs)

      if (remainingMs === 0) {
        clearPendingTurn(entry.threadId)
        continue
      }

      timeoutIds.push(
        window.setTimeout(() => {
          clearPendingTurn(entry.threadId)
        }, remainingMs),
      )
    }

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
    }
  }, [allThreadEvents, clearPendingTurn, pendingTurnsByThread])

  useEffect(() => {
    if (!isMobileViewport) {
      return
    }

    if (mobileThreadToolsOpen && !isInspectorExpanded) {
      setSurfacePanelView(null)
      setIsInspectorExpanded(true)
      return
    }

    if (!mobileThreadToolsOpen && isInspectorExpanded && !surfacePanelView) {
      setIsInspectorExpanded(false)
    }
  }, [isInspectorExpanded, isMobileViewport, mobileThreadToolsOpen, surfacePanelView])

  useEffect(() => {
    if (!isTerminalDockResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = terminalDockResizeRef.current
      if (!resizeState) {
        return
      }

      const delta = resizeState.startY - event.clientY
      const nextHeight = Math.min(
        layoutConfig.workbench.terminalDock.limits.max,
        Math.max(layoutConfig.workbench.terminalDock.limits.min, resizeState.startHeight + delta),
      )
      setTerminalDockHeight(nextHeight)
    }

    function stopResizing() {
      terminalDockResizeRef.current = null
      setIsTerminalDockResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [isTerminalDockResizing])

  useEffect(() => {
    if (!isInspectorResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = inspectorResizeRef.current
      if (!resizeState) {
        return
      }

      const delta = resizeState.startX - event.clientX
      const nextWidth = Math.min(
        layoutConfig.workbench.rightRail.limits.max,
        Math.max(layoutConfig.workbench.rightRail.limits.min, resizeState.startWidth + delta),
      )
      setInspectorWidth(nextWidth)
    }

    function stopResizing() {
      inspectorResizeRef.current = null
      setIsInspectorResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [isInspectorResizing])

  useEffect(() => {
    writeRightRailExpanded(isInspectorExpanded)
  }, [isInspectorExpanded])

  useEffect(() => {
    writeRightRailWidth(inspectorWidth)
  }, [inspectorWidth])

  useEffect(() => {
    writeSurfacePanelWidths(surfacePanelWidths)
  }, [surfacePanelWidths])

  useEffect(() => {
    writeSurfacePanelSides(surfacePanelSides)
  }, [surfacePanelSides])

  useEffect(() => {
    if (!isSurfacePanelResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = surfacePanelResizeRef.current
      if (!resizeState) {
        return
      }

      const delta =
        resizeState.side === 'right'
          ? resizeState.startX - event.clientX
          : event.clientX - resizeState.startX
      const nextWidth = Math.min(
        layoutConfig.workbench.surfacePanel.widthLimits.max,
        Math.max(layoutConfig.workbench.surfacePanel.widthLimits.min, resizeState.startWidth + delta),
      )
      setSurfacePanelWidths((current) => ({
        ...current,
        [resizeState.view]: nextWidth,
      }))
    }

    function stopResizing() {
      surfacePanelResizeRef.current = null
      setIsSurfacePanelResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [isSurfacePanelResizing])

  const selectedThread = useMemo(
    () =>
      threadsQuery.data?.find((thread) => thread.id === selectedThreadId) ??
      (threadDetailQuery.data?.id === selectedThreadId ? threadDetailQuery.data : undefined),
    [selectedThreadId, threadDetailQuery.data, threadsQuery.data],
  )
  const displayedTurns = useMemo(() => {
    const turns = liveThreadDetail?.turns ?? []

    if (!activePendingTurn) {
      return turns
    }

    if (activePendingTurn.turnId && turns.some((turn) => turn.id === activePendingTurn.turnId)) {
      return upsertPendingUserMessage(turns, activePendingTurn)
    }

    return [...turns, buildPendingThreadTurn(activePendingTurn)]
  }, [activePendingTurn, liveThreadDetail?.turns])
  const liveTimelineEntries = useMemo(
    () =>
      buildLiveTimelineEntries(
        [...workspaceEvents, ...selectedThreadEvents].sort(
          (left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime(),
        ),
      ),
    [selectedThreadEvents, workspaceEvents],
  )
  const selectedCommandSession = useMemo(
    () => commandSessions.find((session) => session.id === selectedProcessId) ?? commandSessions[0],
    [commandSessions, selectedProcessId],
  )
  const resolvedThreadTokenUsage = liveThreadDetail?.tokenUsage ?? selectedThreadTokenUsage
  const contextUsage = useMemo(
    () => computeContextUsage(resolvedThreadTokenUsage),
    [resolvedThreadTokenUsage],
  )
  const activeContextCompactionFeedback =
    contextCompactionFeedback?.threadId === selectedThreadId ? contextCompactionFeedback : null
  const availableModels = useMemo(
    () =>
      Array.from(
        new Set(
          [composerPreferences.model, ...(modelsQuery.data ?? []).map((item) => item.name), ...FALLBACK_MODEL_OPTIONS].filter(Boolean),
        ),
      ),
    [composerPreferences.model, modelsQuery.data],
  )
  const mobileCollaborationModeOptions = useMemo(
    () => [
      { value: 'default', label: '默认模式', triggerLabel: '模式' },
      { value: 'plan', label: 'Plan 模式', triggerLabel: 'Plan', disabled: !supportsPlanMode },
    ],
    [supportsPlanMode],
  )
  const mobilePermissionOptions = useMemo(
    () => [
      { value: 'default', label: '默认权限', triggerLabel: '权限' },
      { value: 'full-access', label: '完全访问', triggerLabel: '全开' },
    ],
    [],
  )
  const mobileModelOptions = useMemo(
    () => [
      { value: '', label: '默认模型', triggerLabel: '模型' },
      ...availableModels.map((model) => ({
        value: model,
        label: model,
      })),
    ],
    [availableModels],
  )
  const desktopModelOptions = useMemo(
    () => [
      { value: '', label: '跟随默认模型', triggerLabel: '默认' },
      ...availableModels.map((model) => ({
        value: model,
        label: model,
      })),
    ],
    [availableModels],
  )
  const mobileReasoningOptions = useMemo(
    () => [
      { value: 'low', label: '低' },
      { value: 'medium', label: '中' },
      { value: 'high', label: '高' },
      { value: 'xhigh', label: '超' },
    ],
    [],
  )
  const activeComposerApproval = useMemo(() => {
    const approvals = approvalsQuery.data ?? []
    if (!approvals.length) {
      return null
    }

    const threadApproval = selectedThreadId
      ? approvals.find((approval) => approval.threadId === selectedThreadId)
      : undefined

    return threadApproval ?? approvals[0]
  }, [approvalsQuery.data, selectedThreadId])
  const latestDisplayedTurn = displayedTurns[displayedTurns.length - 1]
  const isSelectedThreadLoaded = useMemo(() => {
    if (!selectedThreadId) {
      return null
    }

    if (!loadedThreadsQuery.data) {
      return null
    }

    return loadedThreadsQuery.data.includes(selectedThreadId)
  }, [loadedThreadsQuery.data, selectedThreadId])
  const turnCount = displayedTurns.length
  const timelineItemCount = displayedTurns.reduce((count, turn) => count + turn.items.length, 0)
  const latestThreadEventTs = selectedThreadEvents[selectedThreadEvents.length - 1]?.ts ?? ''
  const threadContentKey = [
    selectedThreadId ?? '',
    turnCount,
    timelineItemCount,
    latestDisplayedTurn?.id ?? '',
    latestDisplayedTurn?.status ?? '',
    latestThreadEventTs,
    activePendingTurn?.phase ?? '',
    activePendingTurn?.turnId ?? '',
    liveThreadDetail?.updatedAt ?? '',
    selectedThread?.updatedAt ?? '',
  ].join('|')
  const settledMessageAutoScrollKey = useMemo(
    () => latestSettledMessageKey(displayedTurns),
    [displayedTurns],
  )
  const isWaitingForThreadData = Boolean(activePendingTurn)
  const isSendingSelectedThread = activePendingTurn?.phase === 'sending'
  const isApprovalDialogOpen = Boolean(activeComposerApproval)
  const requiresOpenAIAuth =
    accountQuery.data?.status === 'requires_openai_auth' || isAuthenticationError(accountQuery.error)
  const isThreadInterruptible = Boolean(
    selectedThreadId &&
      (isWaitingForThreadData ||
        statusIsInterruptible(selectedThread?.status) ||
        statusIsInterruptible(latestDisplayedTurn?.status)),
  )
  const isSendBusy = isWaitingForThreadData
  const isThreadProcessing =
    isWaitingForThreadData || interruptTurnMutation.isPending || isThreadInterruptible
  const compactDisabledReason = !selectedThreadId
    ? 'Select a thread to compact its context.'
    : activeContextCompactionFeedback?.phase === 'requested'
      ? 'Compaction is already running. This panel will update when the runtime confirms it.'
      : isThreadProcessing
        ? 'Wait until the current reply finishes before compacting this thread.'
        : null
  const isInterruptMode = Boolean(
    selectedThreadId &&
      !isApprovalDialogOpen &&
      !isSendingSelectedThread &&
      (interruptTurnMutation.isPending || isThreadInterruptible),
  )
  const isComposerLocked =
    isApprovalDialogOpen ||
    isWaitingForThreadData ||
    interruptTurnMutation.isPending ||
    isThreadInterruptible
  const sendButtonLabel = interruptTurnMutation.isPending
    ? 'Stopping…'
    : isSendingSelectedThread
      ? 'Sending…'
      : isInterruptMode
        ? 'Stop'
        : 'Send'
  const shouldShowComposerSpinner =
    isSendingSelectedThread || interruptTurnMutation.isPending || isInterruptMode
  const composerActivityTitle = interruptTurnMutation.isPending
    ? 'Stopping current reply…'
    : isSendingSelectedThread
      ? 'Sending message to Codex…'
      : isThreadInterruptible
        ? 'Codex is replying…'
        : null
  const composerActivityDetail = interruptTurnMutation.isPending
    ? 'The runtime is stopping the active turn. The thread will settle in place when it completes.'
    : isSendingSelectedThread
      ? 'Your message is staged. The primary action will switch to Stop as soon as the turn is live.'
      : isThreadInterruptible
        ? isThreadPinnedToLatest
          ? 'Auto-follow is keeping the latest output in view.'
          : hasUnreadThreadUpdates
            ? 'New output is available below. Jump to latest to follow it.'
            : 'Scroll back to the latest message to resume auto-follow.'
        : null
  const mobileStatus = isWaitingForThreadData
    ? 'running'
    : selectedThread?.status ?? streamState
  const composerStatusMessage = sendError
  const composerStatusInfo = useMemo(
    () =>
      buildComposerStatusInfo({
        streamState,
        rawThreadStatus: liveThreadDetail?.status ?? selectedThread?.status,
        latestTurnStatus: latestDisplayedTurn?.status,
        latestTurnError: latestDisplayedTurn?.error,
        sendError,
        requiresOpenAIAuth,
        isApprovalDialogOpen,
        approvalSummary: activeComposerApproval?.summary,
        isWaitingForThreadData,
        pendingPhase: activePendingTurn?.phase,
        isThreadInterruptible,
        isThreadLoaded: isSelectedThreadLoaded,
      }),
    [
      activeComposerApproval?.summary,
      activePendingTurn?.phase,
      isApprovalDialogOpen,
      isSelectedThreadLoaded,
      isThreadInterruptible,
      isWaitingForThreadData,
      latestDisplayedTurn?.error,
      latestDisplayedTurn?.status,
      liveThreadDetail?.status,
      requiresOpenAIAuth,
      selectedThread?.status,
      sendError,
      streamState,
    ],
  )
  const threadDetailPollIntervalMs = selectedThreadId
    ? activePendingTurn
      ? 1_000
      : streamState !== 'open'
        ? 5_000
        : null
    : null
  const approvalsPollIntervalMs = workspaceId && streamState !== 'open' ? 4_000 : null
  const autoSyncIntervalMs = [threadDetailPollIntervalMs, approvalsPollIntervalMs].reduce<number | null>(
    (current, value) => {
      if (typeof value !== 'number') {
        return current
      }

      return current === null ? value : Math.min(current, value)
    },
    null,
  )
  const lastAutoSyncAtMs = Math.max(
    threadsQuery.dataUpdatedAt || 0,
    selectedThreadId ? threadDetailQuery.dataUpdatedAt || 0 : 0,
    approvalsQuery.dataUpdatedAt || 0,
  )
  const isHeaderSyncBusy =
    threadsQuery.isFetching ||
    (Boolean(selectedThreadId) && threadDetailQuery.isFetching) ||
    approvalsQuery.isFetching
  const syncCountdownLabel =
    isHeaderSyncBusy
      ? 'Syncing…'
      : autoSyncIntervalMs
        ? `Next sync ${formatSyncCountdown(lastAutoSyncAtMs, autoSyncIntervalMs, syncClock)}`
        : streamState === 'open'
          ? 'Live'
          : 'Manual sync'
  const activeCommandCount = commandSessions.filter((session) => session.status === 'running').length
  const lastTimelineEventTs =
    selectedThreadEvents[selectedThreadEvents.length - 1]?.ts ?? workspaceEvents[workspaceEvents.length - 1]?.ts
  const terminalDockClassName = [
    'terminal-dock',
    'terminal-dock--attached',
    !commandSessions.length ? 'terminal-dock--empty' : '',
    !isTerminalDockExpanded ? 'terminal-dock--collapsed' : '',
    isTerminalDockResizing ? 'terminal-dock--resizing' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const activeSurfacePanelWidth = surfacePanelView
    ? surfacePanelWidths[surfacePanelView]
    : layoutConfig.workbench.surfacePanel.defaultWidths.feed
  const activeSurfacePanelSide = surfacePanelView
    ? surfacePanelSides[surfacePanelView]
    : layoutConfig.workbench.surfacePanel.defaultSides.feed
  const isMobileInspectorOpen = isMobileViewport && isInspectorExpanded
  const isMobileSurfacePanelOpen = isMobileViewport && Boolean(surfacePanelView)
  const isMobileWorkbenchOverlayOpen = isMobileInspectorOpen || isMobileSurfacePanelOpen
  const workbenchRailWidth = isMobileViewport
    ? '0px'
    : isInspectorExpanded
      ? `${inspectorWidth}px`
      : 'var(--rail-collapsed-width)'
  const workbenchLayoutStyle = {
    ['--surface-panel-width' as string]: `${activeSurfacePanelWidth}px`,
    ['--terminal-dock-height' as string]: `${terminalDockHeight}px`,
    ['--workbench-rail-width' as string]: workbenchRailWidth,
  }

  useEffect(() => {
    setMobileThreadChrome({
      visible: Boolean(selectedThread),
      title: selectedThread?.name ?? '',
      statusLabel: compactStatusLabel(mobileStatus),
      statusTone: compactStatusTone(mobileStatus),
      syncLabel: compactSyncLabel(syncCountdownLabel, streamState),
      syncTitle: syncCountdownLabel,
      activityVisible: Boolean(selectedThread),
      activityRunning: isThreadProcessing,
      refreshBusy: isHeaderSyncBusy,
    })

    return () => {
      resetMobileThreadChrome()
    }
  }, [
    isHeaderSyncBusy,
    isThreadProcessing,
    mobileStatus,
    resetMobileThreadChrome,
    selectedThread,
    setMobileThreadChrome,
    streamState,
    syncCountdownLabel,
  ])

  useEffect(() => {
    if (!isMobileViewport) {
      setMobileThreadToolsOpen(false)
    }
  }, [isMobileViewport, setMobileThreadToolsOpen])

  useEffect(() => {
    if (!isMobileViewport) {
      return
    }

    if (mobileThreadToolsOpen && !isMobileWorkbenchOverlayOpen) {
      setSurfacePanelView(null)
      setIsInspectorExpanded(true)
      return
    }

    if (!mobileThreadToolsOpen && isMobileWorkbenchOverlayOpen) {
      setSurfacePanelView(null)
      setIsInspectorExpanded(false)
    }
  }, [
    isMobileViewport,
    isMobileWorkbenchOverlayOpen,
    mobileThreadToolsOpen,
    setMobileThreadToolsOpen,
  ])

  useEffect(() => {
    if (streamState === 'open' || !autoSyncIntervalMs || typeof window === 'undefined') {
      return
    }

    setSyncClock(Date.now())
    const intervalId = window.setInterval(() => {
      setSyncClock(Date.now())
    }, 1_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [autoSyncIntervalMs, streamState])

  useEffect(() => {
    if (!selectedThreadId) {
      threadContentKeyRef.current = ''
      threadSettledMessageKeyRef.current = ''
      return
    }

    const previousContentKey = threadContentKeyRef.current
    if (previousContentKey === threadContentKey) {
      return
    }

    const previousSettledMessageKey = threadSettledMessageKeyRef.current
    const isInitialPaintForThread =
      !previousContentKey || !previousContentKey.startsWith(`${selectedThreadId}|`)
    const shouldAutoScrollForMessage =
      Boolean(settledMessageAutoScrollKey) &&
      previousSettledMessageKey !== settledMessageAutoScrollKey

    threadContentKeyRef.current = threadContentKey
    threadSettledMessageKeyRef.current = settledMessageAutoScrollKey

    const viewport = threadViewportRef.current
    const pinnedToLatest = viewport
      ? isViewportNearBottom(viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight)
      : true

    if (pinnedToLatest) {
      shouldFollowThreadRef.current = true
      setIsThreadPinnedToLatest(true)
    }

    if (isInitialPaintForThread || (shouldAutoScrollForMessage && (shouldFollowThreadRef.current || pinnedToLatest))) {
      shouldFollowThreadRef.current = true
      setHasUnreadThreadUpdates(false)
      setIsThreadPinnedToLatest(true)

      const frameId = window.requestAnimationFrame(() => {
        threadBottomRef.current?.scrollIntoView({
          behavior: isInitialPaintForThread ? 'auto' : 'smooth',
          block: 'end',
        })
      })

      return () => window.cancelAnimationFrame(frameId)
    }

    setHasUnreadThreadUpdates(true)
  }, [selectedThreadId, settledMessageAutoScrollKey, threadContentKey])

  function syncThreadViewportState() {
    const viewport = threadViewportRef.current
    if (!viewport) {
      shouldFollowThreadRef.current = true
      setHasUnreadThreadUpdates(false)
      setIsThreadPinnedToLatest(true)
      return true
    }

    const pinnedToLatest = isViewportNearBottom(
      viewport.scrollTop,
      viewport.scrollHeight,
      viewport.clientHeight,
    )

    shouldFollowThreadRef.current = pinnedToLatest
    setIsThreadPinnedToLatest(pinnedToLatest)

    if (pinnedToLatest) {
      setHasUnreadThreadUpdates(false)
    }

    return pinnedToLatest
  }

  function scrollThreadToLatest(behavior: ScrollBehavior = 'smooth') {
    shouldFollowThreadRef.current = true
    setHasUnreadThreadUpdates(false)
    setIsThreadPinnedToLatest(true)
    window.requestAnimationFrame(() => {
      threadBottomRef.current?.scrollIntoView({ behavior, block: 'end' })
    })
  }

  function handleThreadViewportScroll() {
    syncThreadViewportState()
  }

  function handleJumpToLatest() {
    scrollThreadToLatest('smooth')
  }

  function handleRetryServerRequest(item: Record<string, unknown>) {
    const nextPrompt = buildRetryPromptFromServerRequest(item)

    setMessage((current) => {
      const trimmed = current.trim()
      if (!trimmed) {
        return nextPrompt
      }

      if (trimmed.includes(nextPrompt)) {
        return current
      }

      return `${current.trimEnd()}\n\n${nextPrompt}`
    })
    setSendError(null)

    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus()
      composerInputRef.current?.setSelectionRange(
        composerInputRef.current.value.length,
        composerInputRef.current.value.length,
      )
    })
  }

  function focusComposerAt(nextCaret: number) {
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus()
      composerInputRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  function applyComposerMessage(nextValue: string, nextCaret: number) {
    setMessage(nextValue)
    setComposerCaret(nextCaret)
    setSendError(null)
    setDismissedComposerAutocompleteKey(null)
    focusComposerAt(nextCaret)
  }

  function clearComposerTriggerToken() {
    if (!activeComposerMatch) {
      return { value: message, caret: composerCaret }
    }

    return replaceComposerAutocompleteToken(message, activeComposerMatch, '')
  }

  function insertComposerText(input: {
    replacement: string
    replaceActiveToken?: boolean
  }) {
    const { replacement, replaceActiveToken = false } = input
    if (replaceActiveToken && activeComposerMatch) {
      return replaceComposerAutocompleteToken(message, activeComposerMatch, replacement)
    }

    return {
      value: `${message.slice(0, composerCaret)}${replacement}${message.slice(composerCaret)}`,
      caret: composerCaret + replacement.length,
    }
  }

  function dismissComposerAutocomplete() {
    setComposerCommandMenu('root')
    if (activeComposerAutocompleteKey) {
      setDismissedComposerAutocompleteKey(activeComposerAutocompleteKey)
    }
  }

  function handleComposerCommandAction(action: ComposerCommandAction) {
    switch (action.kind) {
      case 'panel': {
        const cleared = clearComposerTriggerToken()
        setComposerCommandMenu('root')
        setActiveComposerPanel(action.panel)
        applyComposerMessage(cleared.value, cleared.caret)
        return
      }
      case 'prompt': {
        const nextMessage = insertComposerText({
          replacement: action.prompt,
          replaceActiveToken: activeComposerMatch?.mode === 'command',
        })
        setComposerCommandMenu('root')
        applyComposerMessage(nextMessage.value, nextMessage.caret)
        return
      }
      case 'submenu': {
        const cleared = clearComposerTriggerToken()
        setComposerCommandMenu(action.menu)
        setDismissedComposerAutocompleteKey(null)
        applyComposerMessage(cleared.value, cleared.caret)
        return
      }
      case 'toggle-plan': {
        if (!supportsPlanMode) {
          setSendError('Plan mode is not available for this workspace.')
          dismissComposerAutocomplete()
          return
        }

        const cleared = clearComposerTriggerToken()
        setComposerPreferences((current) => ({
          ...current,
          collaborationMode: current.collaborationMode === 'plan' ? 'default' : 'plan',
        }))
        setComposerCommandMenu('root')
        setActiveComposerPanel(null)
        applyComposerMessage(cleared.value, cleared.caret)
      }
    }
  }

  function handleSelectComposerAutocompleteItem(item: ComposerAutocompleteItem) {
    switch (item.kind) {
      case 'command':
        handleComposerCommandAction(item.action)
        return
      case 'review': {
        const nextMessage = insertComposerText({
          replacement: item.prompt,
          replaceActiveToken: activeComposerMatch?.mode === 'command',
        })
        setComposerCommandMenu('root')
        applyComposerMessage(nextMessage.value, nextMessage.caret)
        return
      }
      case 'skill':
      case 'file': {
        const nextMessage = insertComposerText({
          replacement: item.insertion,
          replaceActiveToken: Boolean(activeComposerMatch),
        })
        setComposerCommandMenu('root')
        applyComposerMessage(nextMessage.value, nextMessage.caret)
        return
      }
    }
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape' && (isCommandAutocompleteOpen || isMentionAutocompleteOpen || isSkillAutocompleteOpen)) {
      event.preventDefault()
      dismissComposerAutocomplete()
      return
    }

    if (!composerAutocompleteItems.length) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setComposerAutocompleteIndex((current) =>
        current + 1 >= composerAutocompleteItems.length ? 0 : current + 1,
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setComposerAutocompleteIndex((current) =>
        current - 1 < 0 ? composerAutocompleteItems.length - 1 : current - 1,
      )
      return
    }

    if ((event.key === 'Enter' || event.key === 'Tab') && composerAutocompleteItem) {
      event.preventDefault()
      handleSelectComposerAutocompleteItem(composerAutocompleteItem)
    }
  }

  function handleDeleteSelectedThread() {
    if (!selectedThread || deleteThreadMutation.isPending) {
      return
    }

    deleteThreadMutation.reset()
    setConfirmingThreadDelete(selectedThread)
  }

  function handleCloseDeleteThreadDialog() {
    if (deleteThreadMutation.isPending) {
      return
    }

    setConfirmingThreadDelete(null)
    deleteThreadMutation.reset()
  }

  function handleConfirmDeleteThreadDialog() {
    if (!confirmingThreadDelete || deleteThreadMutation.isPending) {
      return
    }

    deleteThreadMutation.mutate(confirmingThreadDelete.id)
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedThreadId || !selectedThread || !message.trim()) {
      return
    }

    const input = message.trim()
    const optimisticTurn = createPendingTurn(selectedThreadId, input)
    const optimisticStatusUpdatedAt = new Date().toISOString()

    setSendError(null)
    updatePendingTurn(selectedThreadId, () => optimisticTurn)
    setMessage('')
    setComposerCaret(0)
    setComposerCommandMenu('root')
    setDismissedComposerAutocompleteKey(null)
    setActiveComposerPanel(null)
    queryClient.setQueryData<Thread[]>(['threads', workspaceId], (current) =>
      updateThreadStatusInList(current, selectedThreadId, 'running', optimisticStatusUpdatedAt),
    )
    queryClient.setQueryData<Thread[]>(['shell-threads', workspaceId], (current) =>
      updateThreadStatusInList(current, selectedThreadId, 'running', optimisticStatusUpdatedAt),
    )
    queryClient.setQueryData<string[]>(['loaded-threads', workspaceId], (current) => {
      if (!current?.length) {
        return current
      }

      return current.includes(selectedThreadId) ? current : [...current, selectedThreadId]
    })
    scrollThreadToLatest('smooth')

    try {
      let result: TurnResult

      try {
        result = await startTurnMutation.mutateAsync({
          threadId: selectedThreadId,
          input,
          model: composerPreferences.model || undefined,
          reasoningEffort: composerPreferences.reasoningEffort,
          permissionPreset: composerPreferences.permissionPreset,
          collaborationMode:
            composerPreferences.collaborationMode === 'plan' ? 'plan' : undefined,
        })
      } catch (error) {
        if (!shouldRetryTurnAfterResume(error)) {
          throw error
        }

        await resumeThread(workspaceId, selectedThreadId)
        result = await startTurnMutation.mutateAsync({
          threadId: selectedThreadId,
          input,
          model: composerPreferences.model || undefined,
          reasoningEffort: composerPreferences.reasoningEffort,
          permissionPreset: composerPreferences.permissionPreset,
          collaborationMode:
            composerPreferences.collaborationMode === 'plan' ? 'plan' : undefined,
        })
      }

      updatePendingTurn(selectedThreadId, (current) =>
        current?.localId === optimisticTurn.localId
          ? {
              ...current,
              phase: 'waiting',
              turnId: result.turnId,
            }
          : current,
      )

      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] }),
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    } catch (error) {
      updatePendingTurn(selectedThreadId, (current) =>
        current?.localId === optimisticTurn.localId ? null : current,
      )
      setMessage(input)
      setComposerCaret(input.length)
      setSendError(getErrorMessage(error, 'Failed to send message.'))
      void invalidateThreadQueries()
    }
  }

  function handleStartCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command.trim()) {
      return
    }
    startCommandMutation.mutate({ command: command.trim() })
  }

  function handleSendStdin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedCommandSession?.id || !stdinValue.trim()) {
      return
    }
    writeCommandMutation.mutate({
      processId: selectedCommandSession.id,
      input: `${stdinValue}\n`,
    })
  }

  function handleApprovalAnswerChange(requestId: string, questionId: string, value: string) {
    setApprovalAnswers((current) => ({
      ...current,
      [requestId]: {
        ...(current[requestId] ?? {}),
        [questionId]: value,
      },
    }))
  }

  function handleRespondApproval(input: {
    requestId: string
    action: string
    answers?: Record<string, string[]>
  }) {
    respondApprovalMutation.mutate(input)
  }

  function handlePrimaryComposerAction() {
    if (!isInterruptMode || !selectedThreadId) {
      return
    }

    interruptTurnMutation.mutate()
  }

  function handleCompactSelectedThread() {
    if (!selectedThreadId || compactDisabledReason || compactThreadMutation.isPending) {
      return
    }

    compactThreadMutation.mutate(selectedThreadId)
  }

  function handleTerminalResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    terminalDockResizeRef.current = {
      startY: event.clientY,
      startHeight: terminalDockHeight,
    }
    setIsTerminalDockResizing(true)
  }

  function handleRemoveCommandSession(processId: string) {
    const remainingSessions = commandSessions.filter((session) => session.id !== processId)
    removeCommandSession(workspaceId, processId)

    if (selectedProcessId === processId) {
      setSelectedProcessId(remainingSessions[0]?.id)
    }

    if (!remainingSessions.length) {
      setIsTerminalDockExpanded(false)
    }
  }

  function handleClearCompletedCommandSessions() {
    const remainingSessions = commandSessions.filter((session) => ['running', 'starting'].includes(session.status))
    clearCompletedCommandSessions(workspaceId)

    if (selectedProcessId && !remainingSessions.some((session) => session.id === selectedProcessId)) {
      setSelectedProcessId(remainingSessions[0]?.id)
    }

    if (!remainingSessions.length) {
      setIsTerminalDockExpanded(false)
    }
  }

  function handleOpenInspector() {
    setSurfacePanelView(null)
    setIsInspectorExpanded(true)
    if (isMobileViewport) {
      setMobileThreadToolsOpen(true)
    }
  }

  function handleOpenSurfacePanel(view: SurfacePanelView) {
    setIsInspectorExpanded(false)
    setSurfacePanelView(view)
    if (isMobileViewport) {
      setMobileThreadToolsOpen(true)
    }
  }

  function handleCloseWorkbenchOverlay() {
    setSurfacePanelView(null)
    setIsInspectorExpanded(false)
    if (isMobileViewport) {
      setMobileThreadToolsOpen(false)
    }
  }

  function handleSurfacePanelResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    if (!surfacePanelView) {
      return
    }
    surfacePanelResizeRef.current = {
      side: activeSurfacePanelSide,
      startX: event.clientX,
      startWidth: activeSurfacePanelWidth,
      view: surfacePanelView,
    }
    setIsSurfacePanelResizing(true)
  }

  function handleInspectorResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    inspectorResizeRef.current = {
      startX: event.clientX,
      startWidth: inspectorWidth,
    }
    setIsInspectorResizing(true)
  }

  function handleResetInspectorWidth() {
    setInspectorWidth(layoutConfig.workbench.rightRail.defaultWidth)
  }

  return (
    <section className={isMobileViewport ? 'screen workbench-screen workbench-screen--mobile' : 'screen workbench-screen'}>
      {isMobileWorkbenchOverlayOpen ? (
        <button
          aria-label="Close workbench panel"
          className="workbench-mobile-backdrop"
          onClick={handleCloseWorkbenchOverlay}
          type="button"
        />
      ) : null}
      <div className="workbench-layout" style={workbenchLayoutStyle}>
        <section className="workbench-main">
          <section className="workbench-surface workbench-surface--ide">
            <div className="workbench-stage__canvas">
              <div className="workbench-log">
                <div
                  aria-busy={isThreadProcessing}
                  className="workbench-log__viewport"
                  onScroll={handleThreadViewportScroll}
                  ref={threadViewportRef}
                >
                  {selectedThread ? (
                    threadDetailQuery.isLoading && !displayedTurns.length ? (
                      <div className="notice">Loading thread surface…</div>
                    ) : threadDetailQuery.error && !displayedTurns.length ? (
                      <InlineNotice
                        details={getErrorMessage(threadDetailQuery.error)}
                        dismissible
                        noticeKey={`thread-load-${threadDetailQuery.error instanceof Error ? threadDetailQuery.error.message : 'unknown'}`}
                        onRetry={() => void queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] })}
                        title="Failed To Load Thread"
                        tone="error"
                      >
                        {getErrorMessage(threadDetailQuery.error)}
                      </InlineNotice>
                    ) : displayedTurns.length ? (
                      <div className="workbench-log__thread">
                        {composerStatusInfo?.noticeTitle && composerStatusInfo.noticeMessage ? (
                          <InlineNotice
                            details={composerStatusInfo.summary}
                            dismissible
                            noticeKey={`thread-runtime-${selectedThreadId}-${composerStatusInfo.label}`}
                            onRetry={() => void queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] })}
                            title={composerStatusInfo.noticeTitle}
                            tone="error"
                          >
                            {composerStatusInfo.noticeMessage}
                          </InlineNotice>
                        ) : null}
                        <TurnTimeline
                          onRetryServerRequest={handleRetryServerRequest}
                          turns={displayedTurns}
                        />
                        {isWaitingForThreadData ? (
                          <div
                            aria-live="polite"
                            className={
                              activePendingTurn?.phase === 'sending'
                                ? 'thread-pending-state thread-pending-state--sending'
                                : 'thread-pending-state thread-pending-state--waiting'
                            }
                            role="status"
                          >
                            <span aria-hidden="true" className="thread-pending-state__spinner" />
                            <div className="thread-pending-state__copy">
                              <strong>
                                {activePendingTurn?.phase === 'sending'
                                  ? 'Sending message…'
                                  : 'Generating reply…'}
                              </strong>
                              <span>
                                {activePendingTurn?.phase === 'sending'
                                  ? 'Your message is staged and the thread is preparing a response.'
                                  : isThreadPinnedToLatest
                                    ? 'Auto-follow is keeping the newest output in view.'
                                    : 'New output is arriving. Jump to latest to keep following it.'}
                              </span>
                            </div>
                          </div>
                        ) : null}
                        <div aria-hidden="true" className="workbench-log__bottom-anchor" ref={threadBottomRef} />
                      </div>
                    ) : (
                      <div className="empty-state workbench-log__empty">Send the first message to start this thread.</div>
                    )
                  ) : (
                    <div className="empty-state workbench-log__empty">
                      <div className="form-stack">
                        <p>Select a thread from the left sidebar to start working in this workspace.</p>
                      </div>
                    </div>
                  )}
                </div>
                {selectedThread && displayedTurns.length && !isThreadPinnedToLatest ? (
                  <div className="workbench-log__jump-shell">
                    <button
                      className={
                        hasUnreadThreadUpdates
                          ? 'workbench-log__jump workbench-log__jump--unread'
                          : 'workbench-log__jump'
                      }
                      onClick={handleJumpToLatest}
                      type="button"
                    >
                      <span aria-hidden="true" className="workbench-log__jump-indicator" />
                      <span>{hasUnreadThreadUpdates ? 'New messages below' : 'Back to latest'}</span>
                    </button>
                  </div>
                ) : null}
                {surfacePanelView ? (
                  <section
                    className={
                      isMobileViewport
                        ? 'workbench-log__panel workbench-log__panel--mobile'
                        : isSurfacePanelResizing
                          ? `workbench-log__panel workbench-log__panel--${activeSurfacePanelSide} workbench-log__panel--resizing`
                          : `workbench-log__panel workbench-log__panel--${activeSurfacePanelSide}`
                    }
                  >
                    {!isMobileViewport ? (
                      <button
                        aria-label="Resize surface panel"
                        className="workbench-log__panel-resize"
                        onPointerDown={handleSurfacePanelResizeStart}
                        type="button"
                      />
                    ) : null}
                    <div className="workbench-log__panel-header">
                      <div>
                        <h2>{surfacePanelView === 'feed' ? 'Live Feed' : 'Approvals'}</h2>
                        <p>
                          {surfacePanelView === 'feed'
                            ? 'Inspect recent live activity without opening the full side rail.'
                            : 'Review pending approvals as a smaller in-surface panel.'}
                        </p>
                      </div>
                      <div className="workbench-log__panel-actions">
                        {!isMobileViewport ? (
                          <button
                            className="pane-section__toggle"
                            onClick={() =>
                              surfacePanelView &&
                              setSurfacePanelSides((current) => ({
                                ...current,
                                [surfacePanelView]:
                                  current[surfacePanelView] === 'right' ? 'left' : 'right',
                              }))
                            }
                            type="button"
                          >
                            {activeSurfacePanelSide === 'right' ? 'Dock Left' : 'Dock Right'}
                          </button>
                        ) : null}
                        <button
                          className="pane-section__toggle"
                          onClick={handleCloseWorkbenchOverlay}
                          type="button"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                    <div className="workbench-log__panel-body">
                      {surfacePanelView === 'feed' ? (
                        liveTimelineEntries.length ? <LiveFeed entries={liveTimelineEntries} /> : <div className="empty-state">No live feed entries yet.</div>
                      ) : approvalsQuery.data?.length ? (
                        <ApprovalStack
                          approvalAnswers={approvalAnswers}
                          approvalErrors={approvalErrors}
                          approvals={approvalsQuery.data}
                          responding={respondApprovalMutation.isPending}
                          onChangeAnswer={handleApprovalAnswerChange}
                          onRespond={handleRespondApproval}
                        />
                      ) : (
                        <div className="empty-state">No pending approvals in this workspace.</div>
                      )}
                    </div>
                  </section>
                ) : null}
              </div>

              <form
                className={isApprovalDialogOpen ? 'composer-dock composer-dock--workbench composer-dock--with-approval' : 'composer-dock composer-dock--workbench'}
                onSubmit={handleSendMessage}
              >
                {activeComposerApproval ? (
                  <ApprovalDialog
                    approval={activeComposerApproval}
                    approvalAnswers={approvalAnswers}
                    approvalErrors={approvalErrors}
                    approvalQueueCount={approvalsQuery.data?.length ?? 0}
                    key={activeComposerApproval.id}
                    responding={respondApprovalMutation.isPending}
                    onChangeAnswer={handleApprovalAnswerChange}
                    onRespond={handleRespondApproval}
                  />
                ) : null}
                {composerStatusMessage ? (
                  <InlineNotice
                    className="composer-dock__status-banner"
                    details={composerStatusMessage ?? undefined}
                    dismissible
                    noticeKey={composerStatusMessage ?? 'composer-status'}
                    onRetry={
                      accountQuery.error
                        ? () => void queryClient.invalidateQueries({ queryKey: ['account'] })
                        : !requiresOpenAIAuth && sendError
                          ? () => {
                              setSendError(null)
                            }
                          : undefined
                    }
                    retryLabel={accountQuery.error ? 'Refresh Status' : 'Dismiss Error'}
                    title="Send Failed"
                    tone="error"
                  >
                    {composerStatusMessage}
                  </InlineNotice>
                ) : null}
                {activeComposerPanel ? (
                  <section className="composer-assist-card" aria-live="polite">
                    <div className="composer-assist-card__header">
                      <div className="composer-assist-card__copy">
                        <strong>
                          {activeComposerPanel === 'mcp'
                            ? 'MCP'
                            : activeComposerPanel === 'status'
                              ? '状态'
                              : activeComposerPanel === 'personalization'
                                ? '个性'
                                : '工作树'}
                        </strong>
                        <span>
                          {activeComposerPanel === 'mcp'
                            ? '查看当前工作区的 MCP 服务状态。'
                            : activeComposerPanel === 'status'
                              ? '查看线程、上下文使用情况和账户额度。'
                              : activeComposerPanel === 'personalization'
                                ? '查看本地响应偏好和自定义指令。'
                                : '查看当前工作树策略和设置入口。'}
                        </span>
                      </div>
                      <button
                        aria-label="关闭辅助面板"
                        className="composer-assist-card__close"
                        onClick={() => setActiveComposerPanel(null)}
                        type="button"
                      >
                        <ComposerCloseIcon />
                      </button>
                    </div>
                    <div className="composer-assist-card__body">
                      {activeComposerPanel === 'mcp' ? (
                        <>
                          {mcpServerStatusQuery.isLoading ? (
                            <div className="composer-assist-card__empty">正在读取 MCP 服务器状态…</div>
                          ) : mcpServerStates.length ? (
                            <div className="composer-assist-card__list">
                              {mcpServerStates.slice(0, 4).map((server) => (
                                <article className="composer-assist-card__row" key={`${server.name}-${server.status}`}>
                                  <div className="composer-assist-card__icon">
                                    <ComposerOptionGlyph icon="mcp" />
                                  </div>
                                  <div className="composer-assist-card__details">
                                    <strong>{server.name}</strong>
                                    <span>{server.detail || server.status}</span>
                                  </div>
                                  <span className="meta-pill">{server.status}</span>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <div className="composer-assist-card__empty">未配置 MCP 服务器</div>
                          )}
                          <div className="composer-assist-card__footer">
                            <Link className="composer-assist-card__link" to="/settings/mcp">
                              打开 MCP 设置
                            </Link>
                          </div>
                        </>
                      ) : null}
                      {activeComposerPanel === 'status' ? (
                        <>
                          <div className="composer-assist-card__facts">
                            <div className="composer-assist-card__fact">
                              <span>线程</span>
                              <strong>{selectedThreadId ?? '未选择线程'}</strong>
                            </div>
                            <div className="composer-assist-card__fact">
                              <span>运行时</span>
                              <strong>{workspaceQuery.data?.runtimeStatus ?? 'unknown'}</strong>
                            </div>
                            <div className="composer-assist-card__fact">
                              <span>上下文</span>
                              <strong>
                                {contextUsage.percent === null
                                  ? '不可用'
                                  : `${contextUsage.percent}% · ${contextUsage.totalTokens.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()}`}
                              </strong>
                            </div>
                            <div className="composer-assist-card__fact">
                              <span>额度</span>
                              <strong>
                                {rateLimitsQuery.isLoading
                                  ? '读取中…'
                                  : rateLimitsQuery.error
                                    ? '不可用'
                                    : describeRateLimits(rateLimitsQuery.data)}
                              </strong>
                            </div>
                          </div>
                          <div className="composer-assist-card__footer">
                            <span className="composer-assist-card__hint">
                              {rateLimitsQuery.data?.[0]?.resetsAt
                                ? `额度重置 ${formatShortTime(rateLimitsQuery.data[0].resetsAt)}`
                                : accountQuery.data?.email ?? '未连接账户'}
                            </span>
                            <Link className="composer-assist-card__link" to="/settings/general">
                              打开常规设置
                            </Link>
                          </div>
                        </>
                      ) : null}
                      {activeComposerPanel === 'personalization' ? (
                        <>
                          <div className="composer-assist-card__facts">
                            <div className="composer-assist-card__fact">
                              <span>响应风格</span>
                              <strong>{responseTone}</strong>
                            </div>
                            <div className="composer-assist-card__fact">
                              <span>自定义指令</span>
                              <strong>
                                {customInstructions.trim()
                                  ? truncateInlineText(customInstructions, 100)
                                  : '未设置'}
                              </strong>
                            </div>
                          </div>
                          <div className="composer-assist-card__footer">
                            <Link className="composer-assist-card__link" to="/settings/personalization">
                              打开个性化设置
                            </Link>
                          </div>
                        </>
                      ) : null}
                      {activeComposerPanel === 'worktree' ? (
                        <>
                          <div className="composer-assist-card__facts">
                            <div className="composer-assist-card__fact">
                              <span>最大工作树</span>
                              <strong>{maxWorktrees}</strong>
                            </div>
                            <div className="composer-assist-card__fact">
                              <span>自动清理</span>
                              <strong>{autoPruneDays} 天</strong>
                            </div>
                            <div className="composer-assist-card__fact">
                              <span>复用分支</span>
                              <strong>{reuseBranches ? '开启' : '关闭'}</strong>
                            </div>
                          </div>
                          <div className="composer-assist-card__footer">
                            <Link className="composer-assist-card__link" to="/settings/worktrees">
                              打开工作树设置
                            </Link>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </section>
                ) : null}
                {isCommandAutocompleteOpen || isMentionAutocompleteOpen || isSkillAutocompleteOpen ? (
                  <section className="composer-autocomplete" role="listbox">
                    {showMentionSearchHint ? (
                      <div className="composer-autocomplete__hint">
                        输入相关内容以搜索文件
                      </div>
                    ) : showSkillSearchLoading ? (
                      <div className="composer-autocomplete__hint">正在加载技能…</div>
                    ) : fileSearchQuery.isFetching && isMentionAutocompleteOpen && !composerAutocompleteItems.length ? (
                      <div className="composer-autocomplete__hint">正在搜索文件…</div>
                    ) : composerAutocompleteSectionGroups.length ? (
                      composerAutocompleteSectionGroups.map((section) => (
                        <div className="composer-autocomplete__section" key={section.id}>
                          <div className="composer-autocomplete__section-label">
                            {section.label || composerSectionLabel(section.id)}
                          </div>
                          <div className="composer-autocomplete__list">
                            {section.indexedItems.map(({ item, index }) => (
                              <button
                                aria-selected={composerAutocompleteIndex === index}
                                className={
                                  composerAutocompleteIndex === index
                                    ? 'composer-autocomplete__item composer-autocomplete__item--active'
                                    : 'composer-autocomplete__item'
                                }
                                key={`${section.id}-${item.id}`}
                                onClick={() => handleSelectComposerAutocompleteItem(item)}
                                onMouseDown={(event) => event.preventDefault()}
                                onMouseEnter={() => setComposerAutocompleteIndex(index)}
                                role="option"
                                type="button"
                              >
                                <span className="composer-autocomplete__icon">
                                  <ComposerOptionGlyph icon={item.icon} />
                                </span>
                                <span className="composer-autocomplete__body">
                                  <strong>{item.title}</strong>
                                  <span>{item.description}</span>
                                </span>
                                {item.meta ? (
                                  <span className="composer-autocomplete__meta">{item.meta}</span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="composer-autocomplete__hint">
                        {isCommandAutocompleteOpen
                          ? '未找到匹配命令。'
                          : isSkillAutocompleteOpen
                            ? '未找到匹配技能。'
                            : '未找到匹配文件。'}
                      </div>
                    )}
                  </section>
                ) : null}
                <div
                  aria-busy={isThreadProcessing}
                  className={
                    isThreadProcessing
                      ? 'composer-dock__surface composer-dock__surface--live'
                      : 'composer-dock__surface'
                  }
                >
                  <textarea
                    className="composer-dock__input"
                    disabled={!selectedThread || isComposerLocked}
                    onChange={(event) => {
                      setMessage(event.target.value)
                      setComposerCaret(event.target.selectionStart ?? event.target.value.length)
                      setComposerCommandMenu((current) =>
                        current === 'review' ? current : 'root',
                      )
                      setDismissedComposerAutocompleteKey(null)
                      if (sendError) {
                        setSendError(null)
                      }
                    }}
                    onKeyDown={handleComposerKeyDown}
                    onSelect={(event) =>
                      setComposerCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
                    }
                    placeholder={
                      isApprovalDialogOpen
                        ? 'Resolve the approval request above to continue this thread.'
                        : selectedThread
                        ? '向 Codex 任意提问，@ 添加文件，$ 选择技能，/ 调出命令'
                        : 'Select a thread to activate the workspace composer.'
                    }
                    rows={isMobileViewport ? 2 : 3}
                    ref={composerInputRef}
                    value={message}
                  />
                  {composerActivityTitle && composerActivityDetail ? (
                    <div
                      aria-live="polite"
                      className={
                        interruptTurnMutation.isPending
                          ? 'composer-dock__live-status composer-dock__live-status--interrupt'
                          : 'composer-dock__live-status'
                      }
                      role="status"
                    >
                      <span aria-hidden="true" className="composer-dock__live-status-dot" />
                      <div className="composer-dock__live-status-copy">
                        <strong>{composerActivityTitle}</strong>
                        <span>{composerActivityDetail}</span>
                      </div>
                    </div>
                  ) : null}
                  {isMobileViewport ? (
                    <div className="composer-dock__footer composer-dock__footer--mobile">
                      <div className="composer-dock__mobile-controls">
                        <SelectControl
                          ariaLabel="Collaboration mode"
                          className="composer-dock__mobile-select composer-dock__mobile-select--mode"
                          disabled={!workspaceId || isComposerLocked}
                          menuLabel="协作模式"
                          menuClassName="composer-dock__mobile-select-menu"
                          onChange={(nextValue) =>
                            setComposerPreferences((current) => ({
                              ...current,
                              collaborationMode: normalizeCollaborationMode(nextValue),
                            }))
                          }
                          optionClassName="composer-dock__mobile-select-option"
                          options={mobileCollaborationModeOptions}
                          value={composerPreferences.collaborationMode}
                        />
                        <SelectControl
                          ariaLabel="Permission preset"
                          className="composer-dock__mobile-select"
                          disabled={!workspaceId || isComposerLocked}
                          menuLabel="权限范围"
                          menuClassName="composer-dock__mobile-select-menu"
                          onChange={(nextValue) =>
                            setComposerPreferences((current) => ({
                              ...current,
                              permissionPreset: normalizePermissionPreset(nextValue),
                            }))
                          }
                          optionClassName="composer-dock__mobile-select-option"
                          options={mobilePermissionOptions}
                          value={composerPreferences.permissionPreset}
                        />
                        <SelectControl
                          ariaLabel="Model"
                          className="composer-dock__mobile-select composer-dock__mobile-select--model"
                          disabled={!workspaceId || isComposerLocked || modelsQuery.isLoading}
                          menuLabel="选择模型"
                          menuClassName="composer-dock__mobile-select-menu"
                          onChange={(nextValue) =>
                            setComposerPreferences((current) => ({
                              ...current,
                              model: nextValue,
                            }))
                          }
                          optionClassName="composer-dock__mobile-select-option"
                          options={mobileModelOptions}
                          value={composerPreferences.model}
                        />
                        <SelectControl
                          ariaLabel="Reasoning effort"
                          className="composer-dock__mobile-select composer-dock__mobile-select--reasoning"
                          disabled={!workspaceId || isComposerLocked}
                          menuLabel="推理强度"
                          menuClassName="composer-dock__mobile-select-menu"
                          onChange={(nextValue) =>
                            setComposerPreferences((current) => ({
                              ...current,
                              reasoningEffort: normalizeReasoningEffort(nextValue),
                            }))
                          }
                          optionClassName="composer-dock__mobile-select-option"
                          options={mobileReasoningOptions}
                          value={composerPreferences.reasoningEffort}
                        />
                      </div>
                      <div className="composer-dock__actions composer-dock__actions--mobile">
                        <ContextUsageIndicator
                          contextWindow={contextUsage.contextWindow}
                          compactDisabledReason={compactDisabledReason}
                          compactFeedback={activeContextCompactionFeedback}
                          compactPending={compactThreadMutation.isPending}
                          onCompact={handleCompactSelectedThread}
                          percent={contextUsage.percent}
                          totalTokens={contextUsage.totalTokens}
                          usage={resolvedThreadTokenUsage}
                        />
                        <button
                          aria-label={sendButtonLabel}
                          className={
                            isInterruptMode
                              ? 'ide-button composer-dock__action composer-dock__action--interrupt composer-dock__action--mobile'
                              : isSendBusy
                                ? 'ide-button ide-button--busy composer-dock__action composer-dock__action--mobile'
                                : 'ide-button composer-dock__action composer-dock__action--mobile'
                          }
                          disabled={
                            isInterruptMode
                              ? !selectedThreadId || interruptTurnMutation.isPending
                              : !selectedThread || isComposerLocked || !message.trim()
                          }
                          onClick={isInterruptMode ? handlePrimaryComposerAction : undefined}
                          title={sendButtonLabel}
                          type={isInterruptMode ? 'button' : 'submit'}
                        >
                          {isInterruptMode ? (
                            shouldShowComposerSpinner ? (
                              <span
                                aria-hidden="true"
                                className="composer-dock__action-icon composer-dock__action-icon--spinning"
                              >
                                <StopIcon />
                              </span>
                            ) : (
                              <span aria-hidden="true" className="composer-dock__action-icon">
                                <StopIcon />
                              </span>
                            )
                          ) : shouldShowComposerSpinner ? (
                            <span aria-hidden="true" className="composer-dock__spinner" />
                          ) : (
                            <span aria-hidden="true" className="composer-dock__action-icon">
                              <SendIcon />
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="composer-dock__footer">
                      <div className="composer-dock__footer-main">
                        <div className="composer-dock__control-strip">
                          <div className="composer-control-group composer-control-group--active" role="group" aria-label="协作模式">
                            <span className="composer-control-group__label">模式</span>
                            <div className="segmented-control composer-control-group__segmented">
                              <button
                                className={
                                  composerPreferences.collaborationMode === 'default'
                                    ? 'segmented-control__item segmented-control__item--active composer-control-group__item'
                                    : 'segmented-control__item composer-control-group__item'
                                }
                                aria-pressed={composerPreferences.collaborationMode === 'default'}
                                disabled={!workspaceId || isComposerLocked}
                                onClick={() =>
                                  setComposerPreferences((current) => ({
                                    ...current,
                                    collaborationMode: 'default',
                                  }))
                                }
                                title="默认模式"
                                type="button"
                              >
                                默认
                              </button>
                              <button
                                className={
                                  composerPreferences.collaborationMode === 'plan'
                                    ? 'segmented-control__item segmented-control__item--active composer-control-group__item'
                                    : 'segmented-control__item composer-control-group__item'
                                }
                                aria-pressed={composerPreferences.collaborationMode === 'plan'}
                                disabled={!workspaceId || isComposerLocked || !supportsPlanMode}
                                onClick={() =>
                                  setComposerPreferences((current) => ({
                                    ...current,
                                    collaborationMode: 'plan',
                                  }))
                                }
                                title="计划模式"
                                type="button"
                              >
                                计划
                              </button>
                            </div>
                          </div>
                          <div
                            className={
                              composerPreferences.permissionPreset === 'full-access'
                                ? 'composer-control-group composer-control-group--active composer-control-group--danger-active'
                                : 'composer-control-group composer-control-group--active'
                            }
                            role="group"
                            aria-label="权限"
                          >
                            <span className="composer-control-group__label">权限</span>
                            <div className="segmented-control composer-control-group__segmented">
                              <button
                                className={
                                  composerPreferences.permissionPreset === 'default'
                                    ? 'segmented-control__item segmented-control__item--active composer-control-group__item'
                                    : 'segmented-control__item composer-control-group__item'
                                }
                                aria-pressed={composerPreferences.permissionPreset === 'default'}
                                disabled={!workspaceId || isComposerLocked}
                                onClick={() =>
                                  setComposerPreferences((current) => ({
                                    ...current,
                                    permissionPreset: 'default',
                                  }))
                                }
                                title="默认权限"
                                type="button"
                              >
                                默认
                              </button>
                              <button
                                className={
                                  composerPreferences.permissionPreset === 'full-access'
                                    ? 'segmented-control__item segmented-control__item--active composer-control-group__item composer-control-group__item--danger'
                                    : 'segmented-control__item composer-control-group__item composer-control-group__item--danger'
                                }
                                aria-pressed={composerPreferences.permissionPreset === 'full-access'}
                                disabled={!workspaceId || isComposerLocked}
                                onClick={() =>
                                  setComposerPreferences((current) => ({
                                    ...current,
                                    permissionPreset: 'full-access',
                                  }))
                                }
                                title="完全访问权限"
                                type="button"
                              >
                                全权
                              </button>
                            </div>
                          </div>
                          <label
                            className={
                              composerPreferences.model
                                ? 'composer-control-select composer-control-select--active composer-control-select--model'
                                : 'composer-control-select composer-control-select--model'
                            }
                          >
                            <span className="composer-control-group__label">模型</span>
                            <SelectControl
                              ariaLabel="Model"
                              className="composer-control-select__control"
                              disabled={!workspaceId || isComposerLocked || modelsQuery.isLoading}
                              menuLabel="选择模型"
                              menuClassName="composer-control-select__menu"
                              onChange={(nextValue) =>
                                setComposerPreferences((current) => ({
                                  ...current,
                                  model: nextValue,
                                }))
                              }
                              optionClassName="composer-control-select__option"
                              options={desktopModelOptions}
                              value={composerPreferences.model}
                            />
                          </label>
                          <div className="composer-control-group composer-control-group--active" role="group" aria-label="推理强度">
                            <span className="composer-control-group__label">推理</span>
                            <div className="segmented-control composer-control-group__segmented">
                              {[
                                ['low', '低'],
                                ['medium', '中'],
                                ['high', '高'],
                                ['xhigh', '超'],
                              ].map(([value, label]) => (
                                <button
                                  className={
                                    composerPreferences.reasoningEffort === value
                                      ? 'segmented-control__item segmented-control__item--active composer-control-group__item'
                                      : 'segmented-control__item composer-control-group__item'
                                  }
                                  aria-pressed={composerPreferences.reasoningEffort === value}
                                  disabled={!workspaceId || isComposerLocked}
                                  key={value}
                                  onClick={() =>
                                    setComposerPreferences((current) => ({
                                      ...current,
                                      reasoningEffort: normalizeReasoningEffort(value),
                                    }))
                                  }
                                  title={`${label}推理强度`}
                                  type="button"
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="composer-dock__meta composer-dock__meta--surface">
                          {composerStatusInfo ? <ComposerStatusIndicator info={composerStatusInfo} /> : null}
                          {isWaitingForThreadData ? <span className="composer-dock__hint">Waiting for backend turn data…</span> : null}
                        </div>
                      </div>
                      <div className="composer-dock__actions">
                        <ContextUsageIndicator
                          contextWindow={contextUsage.contextWindow}
                          compactDisabledReason={compactDisabledReason}
                          compactFeedback={activeContextCompactionFeedback}
                          compactPending={compactThreadMutation.isPending}
                          onCompact={handleCompactSelectedThread}
                          percent={contextUsage.percent}
                          totalTokens={contextUsage.totalTokens}
                          usage={resolvedThreadTokenUsage}
                        />
                        <button
                          aria-label={sendButtonLabel}
                          className={
                            isInterruptMode
                              ? 'ide-button composer-dock__action composer-dock__action--interrupt'
                              : isSendBusy
                                ? 'ide-button ide-button--busy composer-dock__action'
                                : 'ide-button composer-dock__action'
                          }
                          disabled={
                            isInterruptMode
                              ? !selectedThreadId || interruptTurnMutation.isPending
                              : !selectedThread || isComposerLocked || !message.trim()
                          }
                          onClick={isInterruptMode ? handlePrimaryComposerAction : undefined}
                          title={sendButtonLabel}
                          type={isInterruptMode ? 'button' : 'submit'}
                        >
                          {isInterruptMode ? (
                            <span
                              aria-hidden="true"
                              className={
                                shouldShowComposerSpinner
                                  ? 'composer-dock__action-icon composer-dock__action-icon--spinning'
                                  : 'composer-dock__action-icon'
                              }
                            >
                              <StopIcon />
                            </span>
                          ) : shouldShowComposerSpinner ? (
                            <span aria-hidden="true" className="composer-dock__spinner" />
                          ) : (
                            <span aria-hidden="true" className="composer-dock__action-icon">
                              <SendIcon />
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </form>
            </div>

            {!isMobileViewport ? (
            <section className={terminalDockClassName}>
              <div className="terminal-dock__bar">
                <div className="terminal-dock__bar-copy">
                  <h2>Terminal</h2>
                </div>
                <div className="terminal-dock__bar-meta">
                  {isTerminalDockExpanded ? (
                    <>
                      <span className="meta-pill">{commandSessions.length} sessions</span>
                      <span className="meta-pill">{activeCommandCount} running</span>
                      <span className="meta-pill">
                        {selectedCommandSession?.updatedAt
                          ? `updated ${formatRelativeTimeShort(selectedCommandSession.updatedAt)}`
                          : 'idle'}
                      </span>
                      {commandSessions.some((session) => !['running', 'starting'].includes(session.status)) ? (
                        <button
                          className="terminal-dock__toggle"
                          onClick={handleClearCompletedCommandSessions}
                          type="button"
                        >
                          Clear Finished
                        </button>
                      ) : null}
                    </>
                  ) : commandSessions.length ? (
                    <span className="meta-pill">
                      {activeCommandCount ? `${activeCommandCount} active` : `${commandSessions.length} stored`}
                    </span>
                  ) : null}
                  <button
                    aria-expanded={isTerminalDockExpanded}
                    className="terminal-dock__toggle"
                    onClick={() => setIsTerminalDockExpanded((current) => !current)}
                    type="button"
                  >
                    {isTerminalDockExpanded ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {isTerminalDockExpanded ? (
                <>
                  <ResizeHandle
                    aria-label="Resize terminal dock"
                    axis="vertical"
                    className="terminal-dock__resize-handle"
                    onPointerDown={handleTerminalResizeStart}
                  />
                  {commandSessions.length ? (
                    <div className="terminal-dock__workspace">
                      <div className="terminal-dock__tabs">
                        {commandSessions.map((session) => (
                          <div
                            className={
                              session.id === selectedCommandSession?.id
                                ? 'terminal-dock__tab terminal-dock__tab--active'
                                : 'terminal-dock__tab'
                            }
                            key={session.id}
                          >
                            <button
                              className="terminal-dock__tab-select"
                              onClick={() => setSelectedProcessId(session.id)}
                              type="button"
                            >
                              <strong>{session.command}</strong>
                              <span>
                                {session.status}
                                {session.updatedAt ? ` · ${formatRelativeTimeShort(session.updatedAt)}` : ''}
                              </span>
                            </button>
                            <button
                              aria-label={`Close ${session.command}`}
                              className="terminal-dock__tab-close"
                              onClick={() => handleRemoveCommandSession(session.id)}
                              type="button"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="terminal-dock__console-shell">
                        <div className="terminal-dock__console">
                          <div className="terminal-dock__meta">
                            <span>{selectedCommandSession?.status ?? 'idle'}</span>
                            {typeof selectedCommandSession?.exitCode === 'number' ? <span>exit {selectedCommandSession.exitCode}</span> : null}
                            {selectedCommandSession?.id ? <code>{selectedCommandSession.id}</code> : null}
                          </div>
                          <ThreadTerminalBlock
                            className="terminal-dock__output"
                            content={selectedCommandSession?.combinedOutput || 'Run a command to see output.'}
                          />
                          <form className="terminal-dock__input" onSubmit={handleSendStdin}>
                            <input
                              disabled={!selectedCommandSession?.id}
                              onChange={(event) => setStdinValue(event.target.value)}
                              placeholder="Send stdin to selected process"
                              value={stdinValue}
                            />
                            <button className="ide-button ide-button--secondary" disabled={!selectedCommandSession?.id || !stdinValue.trim()} type="submit">
                              Send
                            </button>
                            <button
                              className="ide-button ide-button--secondary"
                              disabled={!selectedCommandSession?.id}
                              onClick={() => selectedCommandSession?.id && terminateCommandMutation.mutate(selectedCommandSession.id)}
                              type="button"
                            >
                              Stop
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="terminal-dock__empty">
                      Run a command to mount the dock. Sessions stay attached to the workspace and can be revisited from this bottom panel.
                    </div>
                  )}
                </>
              ) : null}
            </section>
            ) : null}
          </section>
        </section>

        {isInspectorExpanded ? (
          <aside
            className={
              isMobileViewport
                ? 'workbench-pane workbench-pane--expanded workbench-pane--mobile'
                : isInspectorResizing
                  ? 'workbench-pane workbench-pane--expanded workbench-pane--resizing'
                  : 'workbench-pane workbench-pane--expanded'
            }
          >
            {!isMobileViewport ? (
              <ResizeHandle
                aria-label="Resize side rail"
                axis="horizontal"
                className="workbench-pane__resize-handle"
                onPointerDown={handleInspectorResizeStart}
              />
            ) : null}
            <div className="workbench-pane__topbar">
              <span className="meta-pill">{isMobileViewport ? 'workbench' : 'side rail'}</span>
              <div className="workbench-pane__topbar-actions">
                {!isMobileViewport ? (
                  <button className="pane-section__toggle" onClick={handleResetInspectorWidth} type="button">
                    Reset Width
                  </button>
                ) : null}
                <button
                  className="pane-section__toggle"
                  onClick={handleCloseWorkbenchOverlay}
                  type="button"
                >
                  {isMobileViewport ? 'Close' : 'Hide Rail'}
                </button>
              </div>
            </div>

            {isMobileViewport ? (
              <div className="pane-section">
                <div className="section-header section-header--inline">
                  <div>
                    <h2>Quick Actions</h2>
                    <p>Only open side panels when you need them.</p>
                  </div>
                </div>
                <div className="workbench-mobile-actions">
                  <button
                    className={surfacePanelView === 'feed' ? 'pane-section__toggle workbench-mobile-actions__button workbench-mobile-actions__button--active' : 'pane-section__toggle workbench-mobile-actions__button'}
                    onClick={() => {
                      handleCloseWorkbenchOverlay()
                      handleOpenSurfacePanel('feed')
                    }}
                    type="button"
                  >
                    Feed
                  </button>
                  <button
                    className={surfacePanelView === 'approvals' ? 'pane-section__toggle workbench-mobile-actions__button workbench-mobile-actions__button--active' : 'pane-section__toggle workbench-mobile-actions__button'}
                    onClick={() => {
                      handleCloseWorkbenchOverlay()
                      handleOpenSurfacePanel('approvals')
                    }}
                    type="button"
                  >
                    Approvals
                  </button>
                </div>
              </div>
            ) : null}

            <div className="pane-section">
              <div className="section-header section-header--inline">
                <div>
                  <h2>Thread Tools</h2>
                  <p>Low-frequency thread management stays folded unless you need it.</p>
                </div>
                <button
                  className="pane-section__toggle"
                  onClick={() => setIsThreadToolsExpanded((current) => !current)}
                  type="button"
                >
                  {isThreadToolsExpanded ? 'Hide' : 'Show'}
                </button>
              </div>
              {isThreadToolsExpanded ? (
                <>
                  {selectedThread ? (
                    <>
                      <div className="header-actions">
                        <button
                          className="ide-button ide-button--secondary"
                          onClick={() => {
                            setEditingThreadId(selectedThread.id)
                            setEditingThreadName(selectedThread.name)
                          }}
                          type="button"
                        >
                          Rename
                        </button>
                        <button
                          className="ide-button ide-button--secondary"
                          onClick={() =>
                            selectedThread.archived
                              ? unarchiveThreadMutation.mutate(selectedThread.id)
                              : archiveThreadMutation.mutate(selectedThread.id)
                          }
                          type="button"
                        >
                          {selectedThread.archived ? 'Unarchive' : 'Archive'}
                        </button>
                        <button
                          className="ide-button ide-button--danger"
                          disabled={deleteThreadMutation.isPending}
                          onClick={handleDeleteSelectedThread}
                          type="button"
                        >
                          {deleteThreadMutation.isPending &&
                          deleteThreadMutation.variables === selectedThread.id
                            ? 'Deleting…'
                            : 'Delete'}
                        </button>
                      </div>
                      {editingThreadId === selectedThread.id ? (
                        <form className="form-stack" onSubmit={(event) => {
                          event.preventDefault()
                          if (!editingThreadName.trim()) {
                            return
                          }
                          renameThreadMutation.mutate({
                            threadId: selectedThread.id,
                            name: editingThreadName.trim(),
                          })
                        }}>
                          <label className="field">
                            <span>Rename Thread</span>
                            <input onChange={(event) => setEditingThreadName(event.target.value)} value={editingThreadName} />
                          </label>
                          <div className="header-actions">
                            <button className="ide-button" disabled={!editingThreadName.trim()} type="submit">
                              Save
                            </button>
                            <button className="ide-button ide-button--secondary" onClick={() => setEditingThreadId(undefined)} type="button">
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="pane-section">
              <div className="section-header section-header--inline">
                <div>
                  <h2>Workspace Context</h2>
                  <p>Persistent context stays in the rail. Feed and approvals open as lighter in-surface panels.</p>
                </div>
                <div className="header-actions workbench-pane__panel-actions">
                  <button
                    className={
                      surfacePanelView === 'feed'
                        ? 'pane-section__toggle workbench-pane__panel-toggle workbench-pane__panel-toggle--active'
                        : 'pane-section__toggle workbench-pane__panel-toggle'
                    }
                    onClick={() => {
                      if (surfacePanelView === 'feed') {
                        setSurfacePanelView(null)
                        return
                      }

                      handleOpenSurfacePanel('feed')
                    }}
                    type="button"
                  >
                    Feed
                  </button>
                  <button
                    className={
                      surfacePanelView === 'approvals'
                        ? 'pane-section__toggle workbench-pane__panel-toggle workbench-pane__panel-toggle--active'
                        : 'pane-section__toggle workbench-pane__panel-toggle'
                    }
                    onClick={() => {
                      if (surfacePanelView === 'approvals') {
                        setSurfacePanelView(null)
                        return
                      }

                      handleOpenSurfacePanel('approvals')
                    }}
                    type="button"
                  >
                    Approvals
                  </button>
                </div>
              </div>
              <div className="detail-list">
                <div className="detail-row">
                  <span>Workspace</span>
                  <strong>{workspaceQuery.data?.name ?? '—'}</strong>
                </div>
                <div className="detail-row">
                  <span>Stream</span>
                  <strong>{streamState}</strong>
                </div>
                <div className="detail-row">
                  <span>Threads</span>
                  <strong>{threadsQuery.data?.length ?? 0}</strong>
                </div>
                <div className="detail-row">
                  <span>Root Path</span>
                  <strong>{workspaceQuery.data?.rootPath ?? '—'}</strong>
                </div>
                <div className="detail-row">
                  <span>Selected Thread</span>
                  <strong>{selectedThread?.name ?? '—'}</strong>
                </div>
                <div className="detail-row">
                  <span>CWD</span>
                  <strong>{liveThreadDetail?.cwd ?? '—'}</strong>
                </div>
                <div className="detail-row">
                  <span>Turns</span>
                  <strong>{turnCount}</strong>
                </div>
                <div className="detail-row">
                  <span>Timeline Items</span>
                  <strong>{timelineItemCount}</strong>
                </div>
                <div className="detail-row">
                  <span>Pending Approvals</span>
                  <strong>{approvalsQuery.data?.length ?? 0}</strong>
                </div>
                <div className="detail-row">
                  <span>Activity</span>
                  <strong>{lastTimelineEventTs ? formatRelativeTimeShort(lastTimelineEventTs) : 'idle'}</strong>
                </div>
                <div className="detail-row">
                  <span>Commands</span>
                  <strong>{commandSessions.length}</strong>
                </div>
              </div>
            </div>

            <div className="pane-section pane-section--command">
              <div className="section-header section-header--inline">
                <div>
                  <h2>Workbench Tools</h2>
                  <p>Global shortcuts and ad-hoc commands stay collapsed by default.</p>
                </div>
                <button
                  className="pane-section__toggle"
                  onClick={() => setIsWorkbenchToolsExpanded((current) => !current)}
                  type="button"
                >
                  {isWorkbenchToolsExpanded ? 'Hide' : 'Show'}
                </button>
              </div>
              {isWorkbenchToolsExpanded ? (
                <>
                  <div className="pane-link-grid">
                    <Link className="ide-button ide-button--secondary" to="/automations">
                      Automations
                    </Link>
                    <Link className="ide-button ide-button--secondary" to="/skills">
                      Skills
                    </Link>
                    <Link className="ide-button ide-button--secondary" to="/runtime">
                      Runtime
                    </Link>
                  </div>
                  <form className="form-stack" onSubmit={handleStartCommand}>
                    <label className="field">
                      <span>Run Command</span>
                      <input
                        onChange={(event) => setCommand(event.target.value)}
                        placeholder="pnpm test --filter frontend"
                        value={command}
                      />
                    </label>
                    <button className="ide-button" disabled={!command.trim()} type="submit">
                      {startCommandMutation.isPending ? 'Starting…' : 'Run Command'}
                    </button>
                  </form>
                </>
              ) : null}
            </div>

          </aside>
        ) : !isMobileViewport ? (
          <aside className="workbench-pane workbench-pane--collapsed">
            <div className="workbench-pane__collapsed">
              <RailIconButton
                aria-label="Open side rail"
                className="workbench-pane__mini-button"
                onClick={handleOpenInspector}
                primary
                title="Open side rail"
              >
                <PanelOpenIcon />
              </RailIconButton>
              <RailIconButton
                aria-label="Open workspace context"
                className="workbench-pane__mini-button"
                onClick={handleOpenInspector}
                title="Context"
              >
                <ContextIcon />
              </RailIconButton>
              <RailIconButton
                aria-label="Open live feed panel"
                className="workbench-pane__mini-button"
                onClick={() => handleOpenSurfacePanel('feed')}
                title="Feed"
              >
                <FeedIcon />
              </RailIconButton>
              <RailIconButton
                aria-label="Open approvals panel"
                className="workbench-pane__mini-button"
                onClick={() => handleOpenSurfacePanel('approvals')}
                title="Approvals"
              >
                <ApprovalIcon />
              </RailIconButton>
              <RailIconButton
                aria-label="Open workbench tools"
                className="workbench-pane__mini-button"
                onClick={handleOpenInspector}
                title="Tools"
              >
                <ToolsIcon />
              </RailIconButton>
            </div>
          </aside>
        ) : null}
      </div>
      {confirmingThreadDelete ? (
        <ConfirmDialog
          confirmLabel="Delete Thread"
          description="This removes the thread from this workspace list and clears its active UI state."
          error={deleteThreadMutation.error ? getErrorMessage(deleteThreadMutation.error) : null}
          isPending={deleteThreadMutation.isPending}
          onClose={handleCloseDeleteThreadDialog}
          onConfirm={handleConfirmDeleteThreadDialog}
          subject={confirmingThreadDelete.name}
          title="Delete Thread?"
        />
      ) : null}
    </section>
  )
}
