import { useLayoutEffect } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { Link } from 'react-router-dom'

import { formatLocaleNumber } from '../../i18n/format'
import { i18n } from '../../i18n/runtime'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { SelectControl, type SelectOption } from '../../components/ui/SelectControl'
import { SendIcon, StopIcon } from '../../components/ui/RailControls'
import { ApprovalDialog } from '../../components/workspace/renderers'
import type { PendingApproval, RateLimit, Thread, ThreadTokenUsage } from '../../types/api'
import {
  type ComposerAssistPanel,
  type ComposerAutocompleteItem,
  type ComposerAutocompleteSection,
  type ComposerPreferences,
  type ComposerStatusInfo,
  type ContextCompactionFeedback,
  type NormalizedMcpServerState,
  ComposerCloseIcon,
  ComposerOptionGlyph,
  ComposerStatusIndicator,
  ContextUsageIndicator,
  composerSectionLabel,
  describeRateLimits,
  formatShortTime,
  truncateInlineText,
} from './threadPageComposerShared'

type ComposerAutocompleteSectionGroup = ComposerAutocompleteSection & {
  indexedItems: Array<{
    item: ComposerAutocompleteItem
    index: number
  }>
}

type ThreadComposerDockProps = {
  accountEmail?: string
  activeComposerApproval?: PendingApproval | null
  activeComposerPanel: ComposerAssistPanel | null
  approvalAnswers: Record<string, Record<string, string>>
  approvalErrors: Record<string, string>
  approvalsCount: number
  autoPruneDays: number
  compactDisabledReason: string | null
  compactFeedback: ContextCompactionFeedback | null
  compactPending: boolean
  composerActivityDetail: string | null
  composerActivityTitle: string | null
  composerAutocompleteIndex: number
  composerAutocompleteSectionGroups: ComposerAutocompleteSectionGroup[]
  composerDockRef: RefObject<HTMLFormElement | null>
  composerInputRef: RefObject<HTMLTextAreaElement | null>
  composerPreferences: ComposerPreferences
  composerStatusInfo: ComposerStatusInfo | null
  composerStatusMessage: string | null
  composerStatusRetryLabel?: string
  contextWindow: number
  customInstructions: string
  desktopModelOptions: SelectOption[]
  fileSearchIsFetching: boolean
  hasUnreadThreadUpdates: boolean
  isApprovalDialogOpen: boolean
  isCommandAutocompleteOpen: boolean
  isComposerLocked: boolean
  isInterruptMode: boolean
  interruptPending: boolean
  isMentionAutocompleteOpen: boolean
  isMobileViewport: boolean
  isSendBusy: boolean
  isSkillAutocompleteOpen: boolean
  isThreadProcessing: boolean
  isWaitingForThreadData: boolean
  maxWorktrees: number
  mcpServerStates: NormalizedMcpServerState[]
  mcpServerStatusLoading: boolean
  message: string
  mobileCollaborationModeOptions: SelectOption[]
  mobileModelOptions: SelectOption[]
  mobilePermissionOptions: SelectOption[]
  mobileReasoningOptions: SelectOption[]
  modelsLoading: boolean
  onChangeApprovalAnswer: (requestId: string, questionId: string, value: string) => void
  onChangeCollaborationMode: (value: string) => void
  onChangeComposerAutocompleteIndex: (index: number) => void
  onChangeComposerMessage: (value: string, caret: number) => void
  onChangeModel: (value: string) => void
  onChangePermissionPreset: (value: string) => void
  onChangeReasoningEffort: (value: string) => void
  onCloseComposerPanel: () => void
  onCompactSelectedThread: () => void
  onComposerKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onComposerSelect: (caret: number) => void
  onJumpToLatest: () => void
  onPrimaryComposerAction: () => void
  onRespondApproval: (input: {
    requestId: string
    action: string
    answers?: Record<string, string[]>
  }) => void
  onRetryComposerStatus?: () => void
  onSelectComposerAutocompleteItem: (item: ComposerAutocompleteItem) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  percent: number | null
  rateLimits?: RateLimit[]
  rateLimitsError: unknown
  rateLimitsLoading: boolean
  resolvedThreadTokenUsage: ThreadTokenUsage | null | undefined
  respondingToApproval: boolean
  responseTone: string
  reuseBranches: boolean
  runtimeStatus: string
  selectedThread?: Thread
  selectedThreadId?: string
  sendButtonLabel: string
  shouldShowComposerSpinner: boolean
  showJumpToLatestButton: boolean
  showMentionSearchHint: boolean
  showSkillSearchLoading: boolean
  totalTokens: number
  workspaceId: string
}

export function ThreadComposerDock({
  accountEmail,
  activeComposerApproval,
  activeComposerPanel,
  approvalAnswers,
  approvalErrors,
  approvalsCount,
  autoPruneDays,
  compactDisabledReason,
  compactFeedback,
  compactPending,
  composerActivityDetail,
  composerActivityTitle,
  composerAutocompleteIndex,
  composerAutocompleteSectionGroups,
  composerDockRef,
  composerInputRef,
  composerPreferences,
  composerStatusInfo,
  composerStatusMessage,
  composerStatusRetryLabel,
  contextWindow,
  customInstructions,
  desktopModelOptions,
  fileSearchIsFetching,
  hasUnreadThreadUpdates,
  isApprovalDialogOpen,
  isCommandAutocompleteOpen,
  isComposerLocked,
  isInterruptMode,
  interruptPending,
  isMentionAutocompleteOpen,
  isMobileViewport,
  isSendBusy,
  isSkillAutocompleteOpen,
  isThreadProcessing,
  isWaitingForThreadData,
  maxWorktrees,
  mcpServerStates,
  mcpServerStatusLoading,
  message,
  mobileCollaborationModeOptions,
  mobileModelOptions,
  mobilePermissionOptions,
  mobileReasoningOptions,
  modelsLoading,
  onChangeApprovalAnswer,
  onChangeCollaborationMode,
  onChangeComposerAutocompleteIndex,
  onChangeComposerMessage,
  onChangeModel,
  onChangePermissionPreset,
  onChangeReasoningEffort,
  onCloseComposerPanel,
  onCompactSelectedThread,
  onComposerKeyDown,
  onComposerSelect,
  onJumpToLatest,
  onPrimaryComposerAction,
  onRespondApproval,
  onRetryComposerStatus,
  onSelectComposerAutocompleteItem,
  onSubmit,
  percent,
  rateLimits,
  rateLimitsError,
  rateLimitsLoading,
  resolvedThreadTokenUsage,
  respondingToApproval,
  responseTone,
  reuseBranches,
  runtimeStatus,
  selectedThread,
  selectedThreadId,
  sendButtonLabel,
  shouldShowComposerSpinner,
  showJumpToLatestButton,
  showMentionSearchHint,
  showSkillSearchLoading,
  totalTokens,
  workspaceId,
}: ThreadComposerDockProps) {
  const isAutocompleteOpen =
    isCommandAutocompleteOpen || isMentionAutocompleteOpen || isSkillAutocompleteOpen
  const composerMinRows = isMobileViewport ? 2 : 3
  const composerMaxRows = isMobileViewport ? 6 : 8
  const modeLabel = i18n._({ id: 'Mode', message: 'Mode' })
  const permissionLabel = i18n._({ id: 'Permission', message: 'Permission' })
  const modelLabel = i18n._({ id: 'Model', message: 'Model' })
  const reasoningLabel = i18n._({ id: 'Reasoning', message: 'Reasoning' })

  useLayoutEffect(() => {
    const textarea = composerInputRef.current
    if (!textarea) {
      return
    }

    const computedStyle = window.getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 24
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0
    const borderTop = Number.parseFloat(computedStyle.borderTopWidth) || 0
    const borderBottom = Number.parseFloat(computedStyle.borderBottomWidth) || 0
    const minHeight = lineHeight * composerMinRows + paddingTop + paddingBottom + borderTop + borderBottom
    const maxHeight = lineHeight * composerMaxRows + paddingTop + paddingBottom + borderTop + borderBottom

    textarea.style.height = 'auto'
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [composerInputRef, composerMaxRows, composerMinRows, message])

  function handleComposerInputKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    onComposerKeyDown(event)
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== 'Enter') {
      return
    }

    if (event.ctrlKey || event.metaKey) {
      return
    }

    event.preventDefault()

    if (isInterruptMode) {
      if (!selectedThreadId || interruptPending) {
        return
      }

      onPrimaryComposerAction()
      return
    }

    if (!selectedThread || isComposerLocked || !message.trim()) {
      return
    }

    composerDockRef.current?.requestSubmit()
  }

  return (
    <form
      className={
        isApprovalDialogOpen
          ? 'composer-dock composer-dock--workbench composer-dock--with-approval'
          : 'composer-dock composer-dock--workbench'
      }
      onSubmit={onSubmit}
      ref={composerDockRef}
    >
      {activeComposerApproval ? (
        <ApprovalDialog
          approval={activeComposerApproval}
          approvalAnswers={approvalAnswers}
          approvalErrors={approvalErrors}
          approvalQueueCount={approvalsCount}
          key={activeComposerApproval.id}
          responding={respondingToApproval}
          onChangeAnswer={onChangeApprovalAnswer}
          onRespond={onRespondApproval}
        />
      ) : null}
      {composerStatusMessage ? (
        <InlineNotice
          className="composer-dock__status-banner"
          details={composerStatusMessage ?? undefined}
          dismissible
          noticeKey={composerStatusMessage ?? 'composer-status'}
          onRetry={onRetryComposerStatus}
          retryLabel={composerStatusRetryLabel}
          title={i18n._({
            id: 'Send failed',
            message: 'Send failed',
          })}
          tone="error"
        >
          {composerStatusMessage}
        </InlineNotice>
      ) : null}
      {activeComposerPanel ? (
        <section aria-live="polite" className="composer-assist-card">
          <div className="composer-assist-card__header">
            <div className="composer-assist-card__copy">
              <strong>
                {activeComposerPanel === 'mcp'
                  ? 'MCP'
                  : activeComposerPanel === 'status'
                    ? i18n._({ id: 'Status', message: 'Status' })
                    : activeComposerPanel === 'personalization'
                      ? i18n._({ id: 'Personalization', message: 'Personalization' })
                      : i18n._({ id: 'Worktree', message: 'Worktree' })}
              </strong>
              <span>
                {activeComposerPanel === 'mcp'
                  ? i18n._({
                      id: 'Inspect MCP service status for the current workspace.',
                      message: 'Inspect MCP service status for the current workspace.',
                    })
                  : activeComposerPanel === 'status'
                    ? i18n._({
                        id: 'Inspect thread, context usage, and account quota status.',
                        message: 'Inspect thread, context usage, and account quota status.',
                      })
                    : activeComposerPanel === 'personalization'
                      ? i18n._({
                          id: 'Inspect local response preferences and custom instructions.',
                          message: 'Inspect local response preferences and custom instructions.',
                        })
                      : i18n._({
                          id: 'Inspect current worktree policy and settings entry points.',
                          message: 'Inspect current worktree policy and settings entry points.',
                        })}
              </span>
            </div>
            <button
              aria-label={i18n._({
                id: 'Close assist panel',
                message: 'Close assist panel',
              })}
              className="composer-assist-card__close"
              onClick={onCloseComposerPanel}
              type="button"
            >
              <ComposerCloseIcon />
            </button>
          </div>
          <div className="composer-assist-card__body">
            {activeComposerPanel === 'mcp' ? (
              <>
                {mcpServerStatusLoading ? (
                  <div className="composer-assist-card__empty">
                    {i18n._({
                      id: 'Loading MCP server status…',
                      message: 'Loading MCP server status…',
                    })}
                  </div>
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
                  <div className="composer-assist-card__empty">
                    {i18n._({
                      id: 'No MCP servers configured',
                      message: 'No MCP servers configured',
                    })}
                  </div>
                )}
                <div className="composer-assist-card__footer">
                  <Link className="composer-assist-card__link" to="/settings/mcp">
                    {i18n._({
                      id: 'Open MCP settings',
                      message: 'Open MCP settings',
                    })}
                  </Link>
                </div>
              </>
            ) : null}
            {activeComposerPanel === 'status' ? (
              <>
                <div className="composer-assist-card__facts">
                  <div className="composer-assist-card__fact">
                    <span>{i18n._({ id: 'Thread', message: 'Thread' })}</span>
                    <strong>
                      {selectedThreadId ??
                        i18n._({
                          id: 'No thread selected',
                          message: 'No thread selected',
                        })}
                    </strong>
                  </div>
                  <div className="composer-assist-card__fact">
                    <span>{i18n._({ id: 'Runtime', message: 'Runtime' })}</span>
                    <strong>{runtimeStatus || i18n._({ id: 'Unknown', message: 'Unknown' })}</strong>
                  </div>
                  <div className="composer-assist-card__fact">
                    <span>{i18n._({ id: 'Context', message: 'Context' })}</span>
                    <strong>
                      {percent === null
                        ? i18n._({ id: 'Unavailable', message: 'Unavailable' })
                        : `${percent}% · ${formatLocaleNumber(totalTokens)} / ${formatLocaleNumber(contextWindow)}`}
                    </strong>
                  </div>
                  <div className="composer-assist-card__fact">
                    <span>{i18n._({ id: 'Quota', message: 'Quota' })}</span>
                    <strong>
                      {rateLimitsLoading
                        ? i18n._({ id: 'Loading…', message: 'Loading…' })
                        : rateLimitsError
                          ? i18n._({ id: 'Unavailable', message: 'Unavailable' })
                          : describeRateLimits(rateLimits)}
                    </strong>
                  </div>
                </div>
                <div className="composer-assist-card__footer">
                  <span className="composer-assist-card__hint">
                    {rateLimits?.[0]?.resetsAt
                      ? i18n._({
                          id: 'Quota resets {time}',
                          message: 'Quota resets {time}',
                          values: { time: formatShortTime(rateLimits[0].resetsAt) },
                        })
                      : accountEmail ??
                        i18n._({
                          id: 'No account connected',
                          message: 'No account connected',
                        })}
                  </span>
                  <Link className="composer-assist-card__link" to="/settings/general">
                    {i18n._({
                      id: 'Open general settings',
                      message: 'Open general settings',
                    })}
                  </Link>
                </div>
              </>
            ) : null}
            {activeComposerPanel === 'personalization' ? (
              <>
                <div className="composer-assist-card__facts">
                  <div className="composer-assist-card__fact">
                    <span>{i18n._({ id: 'Response tone', message: 'Response tone' })}</span>
                    <strong>{responseTone}</strong>
                  </div>
                  <div className="composer-assist-card__fact">
                    <span>{i18n._({ id: 'Custom instructions', message: 'Custom instructions' })}</span>
                    <strong>
                      {customInstructions.trim()
                        ? truncateInlineText(customInstructions, 100)
                        : i18n._({ id: 'Not set', message: 'Not set' })}
                    </strong>
                  </div>
                </div>
                <div className="composer-assist-card__footer">
                  <Link className="composer-assist-card__link" to="/settings/personalization">
                    {i18n._({
                      id: 'Open personalization settings',
                      message: 'Open personalization settings',
                    })}
                  </Link>
                </div>
              </>
            ) : null}
            {activeComposerPanel === 'worktree' ? (
              <>
                <div className="composer-assist-card__facts">
                  <div className="composer-assist-card__fact">
                    <span>{i18n._({ id: 'Max worktrees', message: 'Max worktrees' })}</span>
                    <strong>{maxWorktrees}</strong>
                  </div>
                  <div className="composer-assist-card__fact">
                    <span>{i18n._({ id: 'Auto prune', message: 'Auto prune' })}</span>
                    <strong>
                      {i18n._({
                        id: '{days} days',
                        message: '{days} days',
                        values: { days: autoPruneDays },
                      })}
                    </strong>
                  </div>
                  <div className="composer-assist-card__fact">
                    <span>{i18n._({ id: 'Reuse branches', message: 'Reuse branches' })}</span>
                    <strong>
                      {reuseBranches
                        ? i18n._({ id: 'Enabled', message: 'Enabled' })
                        : i18n._({ id: 'Disabled', message: 'Disabled' })}
                    </strong>
                  </div>
                </div>
                <div className="composer-assist-card__footer">
                  <Link className="composer-assist-card__link" to="/settings/worktrees">
                    {i18n._({
                      id: 'Open worktree settings',
                      message: 'Open worktree settings',
                    })}
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        </section>
      ) : null}
      {isAutocompleteOpen ? (
        <section className="composer-autocomplete" role="listbox">
          {showMentionSearchHint ? (
            <div className="composer-autocomplete__hint">
              {i18n._({
                id: 'Type to search files',
                message: 'Type to search files',
              })}
            </div>
          ) : showSkillSearchLoading ? (
            <div className="composer-autocomplete__hint">
              {i18n._({
                id: 'Loading skills…',
                message: 'Loading skills…',
              })}
            </div>
          ) : fileSearchIsFetching && isMentionAutocompleteOpen && !composerAutocompleteSectionGroups.length ? (
            <div className="composer-autocomplete__hint">
              {i18n._({
                id: 'Searching files…',
                message: 'Searching files…',
              })}
            </div>
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
                      onClick={() => onSelectComposerAutocompleteItem(item)}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => onChangeComposerAutocompleteIndex(index)}
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
                ? i18n._({
                    id: 'No matching commands found.',
                    message: 'No matching commands found.',
                  })
                : isSkillAutocompleteOpen
                  ? i18n._({
                      id: 'No matching skills found.',
                      message: 'No matching skills found.',
                    })
                  : i18n._({
                      id: 'No matching files found.',
                      message: 'No matching files found.',
                    })}
            </div>
          )}
        </section>
      ) : null}
      {showJumpToLatestButton ? (
        <div className="workbench-log__jump-shell">
          <button
            className={
              hasUnreadThreadUpdates
                ? 'workbench-log__jump workbench-log__jump--unread'
                : 'workbench-log__jump'
            }
            onClick={onJumpToLatest}
            type="button"
          >
            <span aria-hidden="true" className="workbench-log__jump-indicator" />
            <span>
              {hasUnreadThreadUpdates
                ? i18n._({
                    id: 'New messages below',
                    message: 'New messages below',
                  })
                : i18n._({
                    id: 'Back to latest',
                    message: 'Back to latest',
                  })}
            </span>
          </button>
        </div>
      ) : null}
      <div className="composer-dock__shell">
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
            onChange={(event) =>
              onChangeComposerMessage(
                event.target.value,
                event.target.selectionStart ?? event.target.value.length,
              )
            }
            onKeyDown={handleComposerInputKeyDown}
            onSelect={(event) =>
              onComposerSelect(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
            }
            placeholder={
              isApprovalDialogOpen
                ? i18n._({
                    id: 'Resolve the approval request above to continue this thread.',
                    message: 'Resolve the approval request above to continue this thread.',
                  })
                : selectedThread
                  ? i18n._({
                      id: 'Ask Codex anything, use @ for files, $ for skills, and / for commands',
                      message: 'Ask Codex anything, use @ for files, $ for skills, and / for commands',
                    })
                  : i18n._({
                      id: 'Select a thread to activate the workspace composer.',
                      message: 'Select a thread to activate the workspace composer.',
                    })
            }
            ref={composerInputRef}
            rows={composerMinRows}
            value={message}
          />
          {composerActivityTitle && composerActivityDetail ? (
            <div
              aria-live="polite"
              className={
                interruptPending
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
                  ariaLabel={i18n._({ id: 'Collaboration mode', message: 'Collaboration mode' })}
                  className="composer-dock__mobile-select composer-dock__mobile-select--mode"
                  disabled={!workspaceId || isComposerLocked}
                  menuClassName="composer-dock__mobile-select-menu"
                  menuLabel={i18n._({ id: 'Collaboration mode', message: 'Collaboration mode' })}
                  onChange={onChangeCollaborationMode}
                  optionClassName="composer-dock__mobile-select-option"
                  options={mobileCollaborationModeOptions}
                  value={composerPreferences.collaborationMode}
                />
                <SelectControl
                  ariaLabel={i18n._({ id: 'Permission preset', message: 'Permission preset' })}
                  className="composer-dock__mobile-select"
                  disabled={!workspaceId || isComposerLocked}
                  menuClassName="composer-dock__mobile-select-menu"
                  menuLabel={i18n._({ id: 'Permission range', message: 'Permission range' })}
                  onChange={onChangePermissionPreset}
                  optionClassName="composer-dock__mobile-select-option"
                  options={mobilePermissionOptions}
                  value={composerPreferences.permissionPreset}
                />
                <SelectControl
                  ariaLabel={modelLabel}
                  className="composer-dock__mobile-select composer-dock__mobile-select--model"
                  disabled={!workspaceId || isComposerLocked || modelsLoading}
                  menuClassName="composer-dock__mobile-select-menu"
                  menuLabel={i18n._({ id: 'Select model', message: 'Select model' })}
                  onChange={onChangeModel}
                  optionClassName="composer-dock__mobile-select-option"
                  options={mobileModelOptions}
                  value={composerPreferences.model}
                />
                <SelectControl
                  ariaLabel={i18n._({ id: 'Reasoning effort', message: 'Reasoning effort' })}
                  className="composer-dock__mobile-select composer-dock__mobile-select--reasoning"
                  disabled={!workspaceId || isComposerLocked}
                  menuClassName="composer-dock__mobile-select-menu"
                  menuLabel={i18n._({ id: 'Reasoning effort', message: 'Reasoning effort' })}
                  onChange={onChangeReasoningEffort}
                  optionClassName="composer-dock__mobile-select-option"
                  options={mobileReasoningOptions}
                  value={composerPreferences.reasoningEffort}
                />
              </div>
              <div className="composer-dock__actions composer-dock__actions--mobile">
                <ContextUsageIndicator
                  compactDisabledReason={compactDisabledReason}
                  compactFeedback={compactFeedback}
                  compactPending={compactPending}
                  contextWindow={contextWindow}
                  onCompact={onCompactSelectedThread}
                  percent={percent}
                  totalTokens={totalTokens}
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
                      ? !selectedThreadId || interruptPending
                      : !selectedThread || isComposerLocked || !message.trim()
                  }
                  onClick={isInterruptMode ? onPrimaryComposerAction : undefined}
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
                  <div
                    aria-label={i18n._({ id: 'Collaboration mode', message: 'Collaboration mode' })}
                    className="composer-control-group composer-control-group--active"
                    role="group"
                  >
                    <span className="composer-control-group__label">{modeLabel}</span>
                    <div className="segmented-control composer-control-group__segmented">
                      <button
                        aria-pressed={composerPreferences.collaborationMode === 'default'}
                        className={
                          composerPreferences.collaborationMode === 'default'
                            ? 'segmented-control__item segmented-control__item--active composer-control-group__item'
                            : 'segmented-control__item composer-control-group__item'
                        }
                        disabled={!workspaceId || isComposerLocked}
                        onClick={() => onChangeCollaborationMode('default')}
                        title={i18n._({ id: 'Default mode', message: 'Default mode' })}
                        type="button"
                      >
                        {i18n._({ id: 'Default', message: 'Default' })}
                      </button>
                      <button
                        aria-pressed={composerPreferences.collaborationMode === 'plan'}
                        className={
                          composerPreferences.collaborationMode === 'plan'
                            ? 'segmented-control__item segmented-control__item--active composer-control-group__item'
                            : 'segmented-control__item composer-control-group__item'
                        }
                        disabled={
                          !workspaceId ||
                          isComposerLocked ||
                          !mobileCollaborationModeOptions.some(
                            (option) => option.value === 'plan' && !option.disabled,
                          )
                        }
                        onClick={() => onChangeCollaborationMode('plan')}
                        title={i18n._({ id: 'Plan mode', message: 'Plan mode' })}
                        type="button"
                      >
                        {i18n._({ id: 'Plan', message: 'Plan' })}
                      </button>
                    </div>
                  </div>
                  <div
                    aria-label={i18n._({ id: 'Permission', message: 'Permission' })}
                    className={
                      composerPreferences.permissionPreset === 'full-access'
                        ? 'composer-control-group composer-control-group--active composer-control-group--danger-active'
                        : 'composer-control-group composer-control-group--active'
                    }
                    role="group"
                  >
                    <span className="composer-control-group__label">{permissionLabel}</span>
                    <div className="segmented-control composer-control-group__segmented">
                      <button
                        aria-pressed={composerPreferences.permissionPreset === 'default'}
                        className={
                          composerPreferences.permissionPreset === 'default'
                            ? 'segmented-control__item segmented-control__item--active composer-control-group__item'
                            : 'segmented-control__item composer-control-group__item'
                        }
                        disabled={!workspaceId || isComposerLocked}
                        onClick={() => onChangePermissionPreset('default')}
                        title={i18n._({ id: 'Default permission', message: 'Default permission' })}
                        type="button"
                      >
                        {i18n._({ id: 'Default', message: 'Default' })}
                      </button>
                      <button
                        aria-pressed={composerPreferences.permissionPreset === 'full-access'}
                        className={
                          composerPreferences.permissionPreset === 'full-access'
                            ? 'segmented-control__item segmented-control__item--active composer-control-group__item composer-control-group__item--danger'
                            : 'segmented-control__item composer-control-group__item composer-control-group__item--danger'
                        }
                        disabled={!workspaceId || isComposerLocked}
                        onClick={() => onChangePermissionPreset('full-access')}
                        title={i18n._({ id: 'Full access permission', message: 'Full access permission' })}
                        type="button"
                      >
                        {i18n._({ id: 'Full', message: 'Full' })}
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
                    <span className="composer-control-group__label">{modelLabel}</span>
                    <SelectControl
                      ariaLabel={modelLabel}
                      className="composer-control-select__control"
                      disabled={!workspaceId || isComposerLocked || modelsLoading}
                      menuClassName="composer-control-select__menu"
                      menuLabel={i18n._({ id: 'Select model', message: 'Select model' })}
                      onChange={onChangeModel}
                      optionClassName="composer-control-select__option"
                      options={desktopModelOptions}
                      value={composerPreferences.model}
                    />
                  </label>
                  <div
                    aria-label={i18n._({ id: 'Reasoning effort', message: 'Reasoning effort' })}
                    className="composer-control-group composer-control-group--active"
                    role="group"
                  >
                    <span className="composer-control-group__label">{reasoningLabel}</span>
                    <div className="segmented-control composer-control-group__segmented">
                      {[
                        ['low', i18n._({ id: 'Low', message: 'Low' })],
                        ['medium', i18n._({ id: 'Medium', message: 'Medium' })],
                        ['high', i18n._({ id: 'High', message: 'High' })],
                        ['xhigh', i18n._({ id: 'Max', message: 'Max' })],
                      ].map(([value, label]) => (
                        <button
                          aria-pressed={composerPreferences.reasoningEffort === value}
                          className={
                            composerPreferences.reasoningEffort === value
                              ? 'segmented-control__item segmented-control__item--active composer-control-group__item'
                              : 'segmented-control__item composer-control-group__item'
                          }
                          disabled={!workspaceId || isComposerLocked}
                          key={value}
                          onClick={() => onChangeReasoningEffort(value)}
                          title={i18n._({
                            id: '{label} reasoning effort',
                            message: '{label} reasoning effort',
                            values: { label },
                          })}
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
                  {isWaitingForThreadData ? (
                    <span className="composer-dock__hint">
                      {i18n._({
                        id: 'Waiting for backend turn data…',
                        message: 'Waiting for backend turn data…',
                      })}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="composer-dock__actions">
                <ContextUsageIndicator
                  compactDisabledReason={compactDisabledReason}
                  compactFeedback={compactFeedback}
                  compactPending={compactPending}
                  contextWindow={contextWindow}
                  onCompact={onCompactSelectedThread}
                  percent={percent}
                  totalTokens={totalTokens}
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
                      ? !selectedThreadId || interruptPending
                      : !selectedThread || isComposerLocked || !message.trim()
                  }
                  onClick={isInterruptMode ? onPrimaryComposerAction : undefined}
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
      </div>
    </form>
  )
}
