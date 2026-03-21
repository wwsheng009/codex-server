import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { getErrorMessage } from '../lib/error-utils'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useSettingsLocalStore } from '../features/settings/local-store'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useWorkspaceStream } from '../hooks/useWorkspaceStream'
import { useSessionStore } from '../stores/session-store'
import { getSelectedThreadIdForWorkspace } from '../stores/session-store-utils'
import { useUIStore } from '../stores/ui-store'
import { useThreadComposerActions } from './thread-page/useThreadComposerActions'
import { ThreadComposerDock } from './thread-page/ThreadComposerDock'
import { usePendingThreadTurns } from './thread-page/usePendingThreadTurns'
import { useThreadComposerState } from './thread-page/useThreadComposerState'
import { useThreadPageActions } from './thread-page/useThreadPageActions'
import { useThreadPageComposerCallbacks } from './thread-page/useThreadPageComposerCallbacks'
import { useThreadPageComposerPanelState } from './thread-page/useThreadPageComposerPanelState'
import { useThreadPageData } from './thread-page/useThreadPageData'
import { useThreadPageDisplayState } from './thread-page/useThreadPageDisplayState'
import { useThreadPageEffects } from './thread-page/useThreadPageEffects'
import { useThreadPageMutations } from './thread-page/useThreadPageMutations'
import { useThreadPagePlanModeSupport } from './thread-page/useThreadPagePlanModeSupport'
import { useThreadPageRailState } from './thread-page/useThreadPageRailState'
import { useThreadPageStatusState } from './thread-page/useThreadPageStatusState'
import { useThreadViewportState } from './thread-page/useThreadViewportState'
import { useWorkbenchLayoutState } from './thread-page/useWorkbenchLayoutState'
import { ThreadWorkbenchRail } from './thread-page/ThreadWorkbenchRail'
import { ThreadTerminalDock } from './thread-page/ThreadTerminalDock'
import { ThreadWorkbenchSurface } from './thread-page/ThreadWorkbenchSurface'
import { type ContextCompactionFeedback } from './thread-page/threadPageComposerShared'

export function ThreadPage() {
  const { workspaceId = '' } = useParams()
  const queryClient = useQueryClient()

  const [contextCompactionFeedback, setContextCompactionFeedback] = useState<ContextCompactionFeedback | null>(null)
  const [command, setCommand] = useState('git status')
  const [stdinValue, setStdinValue] = useState('')
  const [selectedProcessId, setSelectedProcessId] = useState<string>()
  const [approvalAnswers, setApprovalAnswers] = useState<Record<string, Record<string, string>>>({})
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({})
  const [syncClock, setSyncClock] = useState(() => Date.now())
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)

  const setSelectedWorkspace = useSessionStore((state) => state.setSelectedWorkspace)
  const setSelectedThread = useSessionStore((state) => state.setSelectedThread)
  const removeThreadFromSession = useSessionStore((state) => state.removeThread)
  const removeCommandSession = useSessionStore((state) => state.removeCommandSession)
  const clearCompletedCommandSessions = useSessionStore((state) => state.clearCompletedCommandSessions)
  const allThreadEvents = useSessionStore((state) => state.eventsByThread)
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
  const isMobileViewport = useMediaQuery('(max-width: 900px)')
  const {
    activeSurfacePanelSide,
    handleInspectorResizeStart,
    handleResetInspectorWidth,
    handleSurfacePanelResizeStart,
    handleTerminalResizeStart,
    isInspectorExpanded,
    isInspectorResizing,
    isSurfacePanelResizing,
    isTerminalDockExpanded,
    isTerminalDockResizing,
    setIsInspectorExpanded,
    setIsTerminalDockExpanded,
    setSurfacePanelSides,
    setSurfacePanelView,
    surfacePanelView,
    workbenchLayoutStyle,
  } = useWorkbenchLayoutState({
    isMobileViewport,
  })
  const streamState = useWorkspaceStream(workspaceId)
  const {
    activePendingTurn,
    clearPendingTurn,
    pendingTurnsByThread,
    updatePendingTurn,
  } = usePendingThreadTurns({
    allThreadEvents,
    selectedThreadId,
    workspaceId,
  })
  const { supportsPlanMode } = useThreadPagePlanModeSupport(workspaceId)
  const {
    activeComposerMatch,
    activeComposerPanel,
    applyComposerMessage,
    clearComposerTriggerToken,
    composerAutocompleteIndex,
    composerCommandDefinitions,
    composerCommandMenu,
    composerPreferences,
    dismissComposerAutocomplete,
    insertComposerText,
    isCommandAutocompleteOpen,
    isMentionAutocompleteOpen,
    isSkillAutocompleteOpen,
    message,
    normalizedDeferredComposerQuery,
    sendError,
    setActiveComposerPanel,
    setComposerAutocompleteIndex,
    setComposerCaret,
    setComposerCommandMenu,
    setComposerPreferences,
    setDismissedComposerAutocompleteKey,
    setMessage,
    setSendError,
  } = useThreadComposerState({
    composerInputRef,
    selectedThreadId,
    supportsPlanMode,
    workspaceId,
  })
  const {
    accountQuery,
    approvalsQuery,
    commandSessions,
    fileSearchQuery,
    liveThreadDetail,
    loadedThreadsQuery,
    mcpServerStatusQuery,
    modelsQuery,
    rateLimitsQuery,
    selectedThread,
    selectedThreadEvents,
    selectedThreadTokenUsage,
    skillsQuery,
    threadDetailQuery,
    threadsQuery,
    workspaceActivityEvents,
    workspaceEvents,
    workspaceQuery,
  } = useThreadPageData({
    activeComposerMatchMode: activeComposerMatch?.mode,
    activeComposerPanel,
    hasPendingTurn: Boolean(pendingTurnsByThread[selectedThreadId ?? '']),
    normalizedDeferredComposerQuery,
    selectedThreadId,
    streamState,
    workspaceId,
  })
  const {
    confirmingThreadDelete,
    editingThreadId,
    editingThreadName,
    handleBeginRenameSelectedThread: beginRenameSelectedThread,
    handleCancelRenameSelectedThread: cancelRenameSelectedThread,
    handleCloseDeleteThreadDialog: closeDeleteThreadDialog,
    handleCloseWorkbenchOverlay: closeWorkbenchOverlay,
    handleDeleteSelectedThread: requestDeleteSelectedThread,
    handleHideSurfacePanel: hideSurfacePanel,
    handleOpenInspector: openInspector,
    handleOpenSurfacePanel: openSurfacePanel,
    handleToggleThreadToolsExpanded: toggleThreadToolsExpanded,
    handleToggleWorkbenchToolsExpanded: toggleWorkbenchToolsExpanded,
    isThreadToolsExpanded,
    isWorkbenchToolsExpanded,
    setConfirmingThreadDelete,
    setEditingThreadId,
    setEditingThreadName,
  } = useThreadPageRailState({
    isMobileViewport,
    selectedThread,
    setIsInspectorExpanded,
    setMobileThreadToolsOpen,
    setSurfacePanelView,
  })
  const {
    archiveThreadMutation,
    compactThreadMutation,
    deleteThreadMutation,
    interruptTurnMutation,
    invalidateThreadQueries,
    renameThreadMutation,
    respondApprovalMutation,
    startCommandMutation,
    startTurnMutation,
    terminateCommandMutation,
    unarchiveThreadMutation,
    writeCommandMutation,
  } = useThreadPageMutations({
    clearPendingTurn,
    queryClient,
    removeThreadFromSession,
    selectedThreadId,
    setApprovalAnswers,
    setApprovalErrors,
    setCommand,
    setConfirmingThreadDelete,
    setContextCompactionFeedback,
    setEditingThreadId,
    setEditingThreadName,
    setIsTerminalDockExpanded,
    setSelectedProcessId,
    setSelectedThread,
    setSendError,
    setStdinValue,
    workspaceId,
  })

  const {
    composerAutocompleteItem,
    composerAutocompleteItems,
    composerAutocompleteSectionGroups,
    desktopModelOptions,
    mcpServerStates,
    mobileCollaborationModeOptions,
    mobileModelOptions,
    mobilePermissionOptions,
    mobileReasoningOptions,
    showMentionSearchHint,
    showSkillSearchLoading,
  } = useThreadPageComposerPanelState({
    activeComposerMatchMode: activeComposerMatch?.mode,
    composerAutocompleteIndex,
    composerCommandDefinitions,
    composerCommandMenu,
    composerPreferences,
    fileSearchFiles: fileSearchQuery.data?.files,
    fileSearchIsFetching: fileSearchQuery.isFetching,
    isCommandAutocompleteOpen,
    isMentionAutocompleteOpen,
    isSkillAutocompleteOpen,
    mcpServerStatusEntries: mcpServerStatusQuery.data?.data,
    models: modelsQuery.data ?? [],
    normalizedDeferredComposerQuery,
    setComposerAutocompleteIndex,
    skills: skillsQuery.data ?? [],
    skillsIsFetching: skillsQuery.isFetching,
    supportsPlanMode,
  })
  const {
    activeComposerApproval,
    activeContextCompactionFeedback,
    contextUsage,
    displayedTurns,
    liveTimelineEntries,
    latestDisplayedTurn,
    resolvedThreadTokenUsage,
    selectedCommandSession,
    settledMessageAutoScrollKey,
    threadContentKey,
    timelineItemCount,
    turnCount,
    isSelectedThreadLoaded,
  } = useThreadPageDisplayState({
    activePendingTurn,
    approvals: approvalsQuery.data ?? [],
    commandSessions,
    contextCompactionFeedback,
    liveThreadDetail,
    loadedThreadIds: loadedThreadsQuery.data,
    selectedProcessId,
    selectedThread,
    selectedThreadEvents,
    selectedThreadId,
    selectedThreadTokenUsage,
    setContextCompactionFeedback,
    workspaceEvents,
    workspaceId,
  })
  const {
    composerDockRef,
    handleJumpToLatest,
    handleThreadViewportScroll,
    hasUnreadThreadUpdates,
    isThreadPinnedToLatest,
    scrollThreadToLatest,
    threadLogStyle,
    threadViewportRef,
  } = useThreadViewportState({
    displayedTurnsLength: displayedTurns.length,
    selectedThreadId,
    settledMessageAutoScrollKey,
    threadContentKey,
    threadDetailIsLoading: threadDetailQuery.isLoading,
  })
  const {
    activeCommandCount,
    autoSyncIntervalMs,
    chromeState,
    compactDisabledReason,
    composerActivityDetail,
    composerActivityTitle,
    composerStatusInfo,
    composerStatusMessage,
    composerStatusRetryLabel,
    isApprovalDialogOpen,
    isComposerLocked,
    isHeaderSyncBusy,
    isInterruptMode,
    isMobileWorkbenchOverlayOpen,
    isSendBusy,
    isThreadProcessing,
    isWaitingForThreadData,
    lastTimelineEventTs,
    requiresOpenAIAuth,
    sendButtonLabel,
    shouldShowComposerSpinner,
    showJumpToLatestButton,
    syncCountdownLabel,
    terminalDockClassName,
    threadRuntimeNotice,
  } = useThreadPageStatusState({
    account: accountQuery.data,
    accountError: accountQuery.error,
    activeComposerApproval,
    activeContextCompactionFeedback,
    activePendingTurn,
    approvalsDataUpdatedAt: approvalsQuery.dataUpdatedAt,
    approvalsIsFetching: approvalsQuery.isFetching,
    commandSessions,
    displayedTurnsLength: displayedTurns.length,
    hasUnreadThreadUpdates,
    interruptPending: interruptTurnMutation.isPending,
    isInspectorExpanded,
    isMobileViewport,
    isSelectedThreadLoaded,
    isTerminalDockExpanded,
    isTerminalDockResizing,
    isThreadPinnedToLatest,
    latestDisplayedTurn,
    liveThreadStatus: liveThreadDetail?.status,
    selectedThread,
    selectedThreadEvents,
    selectedThreadId,
    sendError,
    streamState,
    surfacePanelView,
    syncClock,
    threadDetailDataUpdatedAt: threadDetailQuery.dataUpdatedAt,
    threadDetailIsFetching: threadDetailQuery.isFetching,
    threadsDataUpdatedAt: threadsQuery.dataUpdatedAt,
    threadsIsFetching: threadsQuery.isFetching,
    workspaceEvents,
    workspaceId,
  })

  useThreadPageEffects({
    activePendingTurn,
    autoSyncIntervalMs,
    clearPendingTurn,
    contextCompactionFeedback,
    chromeState,
    currentThreads: threadsQuery.data ?? [],
    isHeaderSyncBusy,
    isMobileViewport,
    isMobileWorkbenchOverlayOpen,
    isThreadProcessing,
    latestThreadDetailId: threadDetailQuery.data?.id,
    liveThreadTurns: liveThreadDetail?.turns,
    mobileThreadToolsOpen,
    queryClient,
    resetMobileThreadChrome,
    selectedThread,
    selectedThreadEvents,
    selectedThreadId,
    setContextCompactionFeedback,
    setIsInspectorExpanded,
    setMobileThreadChrome,
    setMobileThreadToolsOpen,
    setSelectedThread,
    setSelectedWorkspace,
    setSurfacePanelView,
    setSyncClock,
    streamState,
    syncCountdownLabel,
    workspaceActivityEvents,
    workspaceId,
  })
  const {
    handleComposerKeyDown,
    handleComposerMessageChange,
    handleRetryServerRequest,
    handleSelectComposerAutocompleteItem,
  } = useThreadComposerActions({
    activeComposerMatchMode: activeComposerMatch?.mode,
    applyComposerMessage,
    clearComposerTriggerToken,
    composerAutocompleteItem,
    composerAutocompleteItemsLength: composerAutocompleteItems.length,
    dismissComposerAutocomplete,
    insertComposerText,
    isCommandAutocompleteOpen,
    isMentionAutocompleteOpen,
    isSkillAutocompleteOpen,
    message,
    sendError,
    setActiveComposerPanel,
    setComposerAutocompleteIndex,
    setComposerCaret,
    setComposerCommandMenu,
    setComposerPreferences,
    setDismissedComposerAutocompleteKey,
    setMessage,
    setSendError,
    supportsPlanMode,
  })
  const {
    handleApprovalAnswerChange,
    handleClearCompletedCommandSessions,
    handleCloseDeleteThreadDialog,
    handleCompactSelectedThread,
    handleConfirmDeleteThreadDialog,
    handleDeleteSelectedThread,
    handlePrimaryComposerAction,
    handleRemoveCommandSession,
    handleRespondApproval,
    handleSendMessage,
    handleSendStdin,
    handleStartCommand,
    handleSubmitRenameSelectedThread,
    handleTerminateSelectedCommandSession,
    handleToggleArchiveSelectedThread,
  } = useThreadPageActions({
    archiveThreadMutation,
    clearCompletedCommandSessions,
    closeDeleteThreadDialog,
    command,
    commandSessions,
    compactDisabledReason,
    compactThreadMutation,
    composerPreferences,
    confirmingThreadDelete,
    deleteThreadMutation,
    editingThreadName,
    interruptTurnMutation,
    invalidateThreadQueries,
    isInterruptMode,
    message,
    queryClient,
    removeCommandSession,
    renameThreadMutation,
    requestDeleteSelectedThread,
    respondApprovalMutation,
    scrollThreadToLatest,
    selectedCommandSession,
    selectedProcessId,
    selectedThread,
    selectedThreadId,
    setActiveComposerPanel,
    setApprovalAnswers,
    setComposerCaret,
    setComposerCommandMenu,
    setDismissedComposerAutocompleteKey,
    setIsTerminalDockExpanded,
    setMessage,
    setSelectedProcessId,
    setSendError,
    startCommandMutation,
    startTurnMutation,
    stdinValue,
    terminateCommandMutation,
    unarchiveThreadMutation,
    updatePendingTurn,
    workspaceId,
    writeCommandMutation,
  })
  const {
    handleChangeCollaborationMode,
    handleChangeModel,
    handleChangePermissionPreset,
    handleChangeReasoningEffort,
    handleCloseComposerPanel,
    handleRetryComposerStatus,
  } = useThreadPageComposerCallbacks({
    hasAccountError: Boolean(accountQuery.error),
    queryClient,
    requiresOpenAIAuth,
    sendError,
    setActiveComposerPanel,
    setComposerPreferences,
    setSendError,
  })

  return (
    <section className={isMobileViewport ? 'screen workbench-screen workbench-screen--mobile' : 'screen workbench-screen'}>
      {isMobileWorkbenchOverlayOpen ? (
        <button
          aria-label="Close workbench panel"
          className="workbench-mobile-backdrop"
          onClick={closeWorkbenchOverlay}
          type="button"
        />
      ) : null}
      <div className="workbench-layout" style={workbenchLayoutStyle}>
        <section className="workbench-main">
          <section className="workbench-surface workbench-surface--ide">
            <ThreadWorkbenchSurface
              activePendingTurnPhase={activePendingTurn?.phase}
              activeSurfacePanelSide={activeSurfacePanelSide}
              approvalAnswers={approvalAnswers}
              approvalErrors={approvalErrors}
              approvals={approvalsQuery.data}
              displayedTurns={displayedTurns}
              isMobileViewport={isMobileViewport}
              isSurfacePanelResizing={isSurfacePanelResizing}
              isThreadPinnedToLatest={isThreadPinnedToLatest}
              isThreadProcessing={isThreadProcessing}
              isWaitingForThreadData={isWaitingForThreadData}
              liveTimelineEntries={liveTimelineEntries}
              onChangeApprovalAnswer={handleApprovalAnswerChange}
              onCloseWorkbenchOverlay={closeWorkbenchOverlay}
              onRespondApproval={handleRespondApproval}
              onRetryServerRequest={handleRetryServerRequest}
              onRetryThreadLoad={() =>
                void queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] })
              }
              onSurfacePanelResizeStart={handleSurfacePanelResizeStart}
              onThreadViewportScroll={handleThreadViewportScroll}
              onToggleSurfacePanelSide={() =>
                surfacePanelView &&
                setSurfacePanelSides((current) => ({
                  ...current,
                  [surfacePanelView]:
                    current[surfacePanelView] === 'right' ? 'left' : 'right',
                }))
              }
              respondingToApproval={respondApprovalMutation.isPending}
              selectedThread={selectedThread}
              surfacePanelView={surfacePanelView}
              threadDetailError={threadDetailQuery.error}
              threadDetailIsLoading={threadDetailQuery.isLoading}
              threadLoadErrorMessage={getErrorMessage(threadDetailQuery.error)}
              threadLogStyle={threadLogStyle}
              threadRuntimeNotice={threadRuntimeNotice}
              threadViewportRef={threadViewportRef}
            >
              <ThreadComposerDock
                accountEmail={accountQuery.data?.email}
                activeComposerApproval={activeComposerApproval}
                activeComposerPanel={activeComposerPanel}
                approvalAnswers={approvalAnswers}
                approvalErrors={approvalErrors}
                approvalsCount={approvalsQuery.data?.length ?? 0}
                autoPruneDays={autoPruneDays}
                compactDisabledReason={compactDisabledReason}
                compactFeedback={activeContextCompactionFeedback}
                compactPending={compactThreadMutation.isPending}
                composerActivityDetail={composerActivityDetail}
                composerActivityTitle={composerActivityTitle}
                composerAutocompleteIndex={composerAutocompleteIndex}
                composerAutocompleteSectionGroups={composerAutocompleteSectionGroups}
                composerDockRef={composerDockRef}
                composerInputRef={composerInputRef}
                composerPreferences={composerPreferences}
                composerStatusInfo={composerStatusInfo}
                composerStatusMessage={composerStatusMessage}
                composerStatusRetryLabel={composerStatusRetryLabel}
                contextWindow={contextUsage.contextWindow}
                customInstructions={customInstructions}
                desktopModelOptions={desktopModelOptions}
                fileSearchIsFetching={fileSearchQuery.isFetching}
                hasUnreadThreadUpdates={hasUnreadThreadUpdates}
                interruptPending={interruptTurnMutation.isPending}
                isApprovalDialogOpen={isApprovalDialogOpen}
                isCommandAutocompleteOpen={isCommandAutocompleteOpen}
                isComposerLocked={isComposerLocked}
                isInterruptMode={isInterruptMode}
                isMentionAutocompleteOpen={isMentionAutocompleteOpen}
                isMobileViewport={isMobileViewport}
                isSendBusy={isSendBusy}
                isSkillAutocompleteOpen={isSkillAutocompleteOpen}
                isThreadProcessing={isThreadProcessing}
                isWaitingForThreadData={isWaitingForThreadData}
                maxWorktrees={maxWorktrees}
                mcpServerStates={mcpServerStates}
                mcpServerStatusLoading={mcpServerStatusQuery.isLoading}
                message={message}
                mobileCollaborationModeOptions={mobileCollaborationModeOptions}
                mobileModelOptions={mobileModelOptions}
                mobilePermissionOptions={mobilePermissionOptions}
                mobileReasoningOptions={mobileReasoningOptions}
                modelsLoading={modelsQuery.isLoading}
                onChangeApprovalAnswer={handleApprovalAnswerChange}
                onChangeCollaborationMode={handleChangeCollaborationMode}
                onChangeComposerAutocompleteIndex={setComposerAutocompleteIndex}
                onChangeComposerMessage={handleComposerMessageChange}
                onChangeModel={handleChangeModel}
                onChangePermissionPreset={handleChangePermissionPreset}
                onChangeReasoningEffort={handleChangeReasoningEffort}
                onCloseComposerPanel={handleCloseComposerPanel}
                onCompactSelectedThread={handleCompactSelectedThread}
                onComposerKeyDown={handleComposerKeyDown}
                onComposerSelect={setComposerCaret}
                onJumpToLatest={handleJumpToLatest}
                onPrimaryComposerAction={handlePrimaryComposerAction}
                onRespondApproval={handleRespondApproval}
                onRetryComposerStatus={handleRetryComposerStatus}
                onSelectComposerAutocompleteItem={handleSelectComposerAutocompleteItem}
                onSubmit={handleSendMessage}
                percent={contextUsage.percent}
                rateLimits={rateLimitsQuery.data}
                rateLimitsError={rateLimitsQuery.error}
                rateLimitsLoading={rateLimitsQuery.isLoading}
                resolvedThreadTokenUsage={resolvedThreadTokenUsage}
                respondingToApproval={respondApprovalMutation.isPending}
                responseTone={responseTone}
                reuseBranches={reuseBranches}
                runtimeStatus={workspaceQuery.data?.runtimeStatus ?? 'unknown'}
                selectedThread={selectedThread}
                selectedThreadId={selectedThreadId}
                sendButtonLabel={sendButtonLabel}
                shouldShowComposerSpinner={shouldShowComposerSpinner}
                showJumpToLatestButton={showJumpToLatestButton}
                showMentionSearchHint={showMentionSearchHint}
                showSkillSearchLoading={showSkillSearchLoading}
                totalTokens={contextUsage.totalTokens}
                workspaceId={workspaceId}
              />
            </ThreadWorkbenchSurface>

            {!isMobileViewport ? (
              <ThreadTerminalDock
                activeCommandCount={activeCommandCount}
                className={terminalDockClassName}
                commandSessions={commandSessions}
                isExpanded={isTerminalDockExpanded}
                onChangeStdinValue={setStdinValue}
                onClearCompletedSessions={handleClearCompletedCommandSessions}
                onRemoveSession={handleRemoveCommandSession}
                onResizeStart={handleTerminalResizeStart}
                onSelectSession={setSelectedProcessId}
                onSubmitStdin={handleSendStdin}
                onTerminateSelectedSession={handleTerminateSelectedCommandSession}
                onToggleExpanded={() => setIsTerminalDockExpanded((current) => !current)}
                selectedCommandSession={selectedCommandSession}
                stdinValue={stdinValue}
                terminateDisabled={!selectedCommandSession?.id}
              />
            ) : null}
          </section>
        </section>

        <ThreadWorkbenchRail
          command={command}
          commandCount={commandSessions.length}
          deletePending={deleteThreadMutation.isPending}
          deletingThreadId={deleteThreadMutation.variables}
          editingThreadId={editingThreadId}
          editingThreadName={editingThreadName}
          isExpanded={isInspectorExpanded}
          isMobileViewport={isMobileViewport}
          isResizing={isInspectorResizing}
          isThreadToolsExpanded={isThreadToolsExpanded}
          isWorkbenchToolsExpanded={isWorkbenchToolsExpanded}
          lastTimelineEventTs={lastTimelineEventTs}
          liveThreadCwd={liveThreadDetail?.cwd}
          pendingApprovalsCount={approvalsQuery.data?.length ?? 0}
          rootPath={workspaceQuery.data?.rootPath}
          selectedThread={selectedThread}
          startCommandPending={startCommandMutation.isPending}
          streamState={streamState}
          surfacePanelView={surfacePanelView}
          threadCount={threadsQuery.data?.length ?? 0}
          timelineItemCount={timelineItemCount}
          turnCount={turnCount}
          workspaceName={workspaceQuery.data?.name}
          onArchiveToggle={handleToggleArchiveSelectedThread}
          onBeginRenameThread={beginRenameSelectedThread}
          onCancelRenameThread={cancelRenameSelectedThread}
          onChangeCommand={setCommand}
          onChangeEditingThreadName={setEditingThreadName}
          onCloseWorkbenchOverlay={closeWorkbenchOverlay}
          onDeleteThread={handleDeleteSelectedThread}
          onHideSurfacePanel={hideSurfacePanel}
          onInspectorResizeStart={handleInspectorResizeStart}
          onOpenInspector={openInspector}
          onOpenSurfacePanel={openSurfacePanel}
          onResetInspectorWidth={handleResetInspectorWidth}
          onStartCommand={handleStartCommand}
          onSubmitRenameThread={handleSubmitRenameSelectedThread}
          onToggleThreadToolsExpanded={toggleThreadToolsExpanded}
          onToggleWorkbenchToolsExpanded={toggleWorkbenchToolsExpanded}
        />
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


