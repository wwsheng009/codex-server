import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { Link } from 'react-router-dom'

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
          title="Send Failed"
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
                    <strong>{runtimeStatus || 'unknown'}</strong>
                  </div>
                  <div className="composer-assist-card__fact">
                    <span>上下文</span>
                    <strong>
                      {percent === null
                        ? '不可用'
                        : `${percent}% · ${totalTokens.toLocaleString()} / ${contextWindow.toLocaleString()}`}
                    </strong>
                  </div>
                  <div className="composer-assist-card__fact">
                    <span>额度</span>
                    <strong>
                      {rateLimitsLoading
                        ? '读取中…'
                        : rateLimitsError
                          ? '不可用'
                          : describeRateLimits(rateLimits)}
                    </strong>
                  </div>
                </div>
                <div className="composer-assist-card__footer">
                  <span className="composer-assist-card__hint">
                    {rateLimits?.[0]?.resetsAt
                      ? `额度重置 ${formatShortTime(rateLimits[0].resetsAt)}`
                      : accountEmail ?? '未连接账户'}
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
      {isAutocompleteOpen ? (
        <section className="composer-autocomplete" role="listbox">
          {showMentionSearchHint ? (
            <div className="composer-autocomplete__hint">输入相关内容以搜索文件</div>
          ) : showSkillSearchLoading ? (
            <div className="composer-autocomplete__hint">正在加载技能…</div>
          ) : fileSearchIsFetching && isMentionAutocompleteOpen && !composerAutocompleteSectionGroups.length ? (
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
                ? '未找到匹配命令。'
                : isSkillAutocompleteOpen
                  ? '未找到匹配技能。'
                  : '未找到匹配文件。'}
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
            <span>{hasUnreadThreadUpdates ? 'New messages below' : 'Back to latest'}</span>
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
            onKeyDown={onComposerKeyDown}
            onSelect={(event) =>
              onComposerSelect(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
            }
            placeholder={
              isApprovalDialogOpen
                ? 'Resolve the approval request above to continue this thread.'
                : selectedThread
                  ? '向 Codex 任意提问，@ 添加文件，$ 选择技能，/ 调出命令'
                  : 'Select a thread to activate the workspace composer.'
            }
            ref={composerInputRef}
            rows={isMobileViewport ? 2 : 3}
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
                  ariaLabel="Collaboration mode"
                  className="composer-dock__mobile-select composer-dock__mobile-select--mode"
                  disabled={!workspaceId || isComposerLocked}
                  menuClassName="composer-dock__mobile-select-menu"
                  menuLabel="协作模式"
                  onChange={onChangeCollaborationMode}
                  optionClassName="composer-dock__mobile-select-option"
                  options={mobileCollaborationModeOptions}
                  value={composerPreferences.collaborationMode}
                />
                <SelectControl
                  ariaLabel="Permission preset"
                  className="composer-dock__mobile-select"
                  disabled={!workspaceId || isComposerLocked}
                  menuClassName="composer-dock__mobile-select-menu"
                  menuLabel="权限范围"
                  onChange={onChangePermissionPreset}
                  optionClassName="composer-dock__mobile-select-option"
                  options={mobilePermissionOptions}
                  value={composerPreferences.permissionPreset}
                />
                <SelectControl
                  ariaLabel="Model"
                  className="composer-dock__mobile-select composer-dock__mobile-select--model"
                  disabled={!workspaceId || isComposerLocked || modelsLoading}
                  menuClassName="composer-dock__mobile-select-menu"
                  menuLabel="选择模型"
                  onChange={onChangeModel}
                  optionClassName="composer-dock__mobile-select-option"
                  options={mobileModelOptions}
                  value={composerPreferences.model}
                />
                <SelectControl
                  ariaLabel="Reasoning effort"
                  className="composer-dock__mobile-select composer-dock__mobile-select--reasoning"
                  disabled={!workspaceId || isComposerLocked}
                  menuClassName="composer-dock__mobile-select-menu"
                  menuLabel="推理强度"
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
                    aria-label="协作模式"
                    className="composer-control-group composer-control-group--active"
                    role="group"
                  >
                    <span className="composer-control-group__label">模式</span>
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
                        title="默认模式"
                        type="button"
                      >
                        默认
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
                        title="计划模式"
                        type="button"
                      >
                        计划
                      </button>
                    </div>
                  </div>
                  <div
                    aria-label="权限"
                    className={
                      composerPreferences.permissionPreset === 'full-access'
                        ? 'composer-control-group composer-control-group--active composer-control-group--danger-active'
                        : 'composer-control-group composer-control-group--active'
                    }
                    role="group"
                  >
                    <span className="composer-control-group__label">权限</span>
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
                        title="默认权限"
                        type="button"
                      >
                        默认
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
                      disabled={!workspaceId || isComposerLocked || modelsLoading}
                      menuClassName="composer-control-select__menu"
                      menuLabel="选择模型"
                      onChange={onChangeModel}
                      optionClassName="composer-control-select__option"
                      options={desktopModelOptions}
                      value={composerPreferences.model}
                    />
                  </label>
                  <div
                    aria-label="推理强度"
                    className="composer-control-group composer-control-group--active"
                    role="group"
                  >
                    <span className="composer-control-group__label">推理</span>
                    <div className="segmented-control composer-control-group__segmented">
                      {[
                        ['low', '低'],
                        ['medium', '中'],
                        ['high', '高'],
                        ['xhigh', '超'],
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
                  {isWaitingForThreadData ? (
                    <span className="composer-dock__hint">Waiting for backend turn data…</span>
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
