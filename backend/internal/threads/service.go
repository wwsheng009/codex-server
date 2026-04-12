package threads

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"

	"codex-server/backend/internal/appserver"
	"codex-server/backend/internal/bridge"
	appconfig "codex-server/backend/internal/config"
	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	store    *store.MemoryStore
	runtimes *runtime.Manager
}

const (
	threadContentModeFull    = "full"
	threadContentModeSummary = "summary"
	threadOutputModeTail     = "tail"
	threadSortKeyCreatedAt   = "created_at"
	threadSortKeyUpdatedAt   = "updated_at"
	threadRuntimeReadTimeout = 5 * time.Second
	threadRuntimeListTimeout = 5 * time.Second

	threadSummaryPreviewLimit                = 400
	threadSummaryPlanTextLimit               = 1_200
	threadSummaryCommandLimit                = 400
	threadSummaryCommandOutputPreviewLimit   = 800
	threadExpandedCommandOutputPreviewLimit  = 8_000
	threadExpandedCommandOutputTailLineLimit = 1_200
	threadSummaryMessageTextLimit            = 1_600
	threadSummaryNestedStringLimit           = 1_200
	threadListPageDefaultLimit               = 50
	threadListPageMaxLimit                   = 200

	ThreadStartSourceStartup       = "startup"
	ThreadStartSourceClear         = "clear"
	threadSessionStartSourceResume = "resume"
)

type CreateInput struct {
	Name               string
	Model              string
	PermissionPreset   string
	SessionStartSource string
}

type ListPageInput struct {
	Archived     *bool
	Cursor       string
	Limit        int
	SortKey      string
	PreferCached bool
}

type ThreadListPage struct {
	Data       []store.Thread `json:"data"`
	NextCursor *string        `json:"nextCursor,omitempty"`
}

type ThreadTurnItemOutput struct {
	ItemID            string `json:"itemId"`
	Command           string `json:"command,omitempty"`
	AggregatedOutput  string `json:"aggregatedOutput"`
	OutputLineCount   int    `json:"outputLineCount,omitempty"`
	OutputContentMode string `json:"outputContentMode,omitempty"`
	OutputStartLine   int    `json:"outputStartLine,omitempty"`
	OutputEndLine     int    `json:"outputEndLine,omitempty"`
	OutputStartOffset int    `json:"outputStartOffset,omitempty"`
	OutputEndOffset   int    `json:"outputEndOffset,omitempty"`
	OutputTotalLength int    `json:"outputTotalLength,omitempty"`
	OutputTruncated   bool   `json:"outputTruncated,omitempty"`
}

func NewService(dataStore *store.MemoryStore, runtimeManager *runtime.Manager) *Service {
	return &Service{
		store:    dataStore,
		runtimes: runtimeManager,
	}
}

func (s *Service) List(ctx context.Context, workspaceID string) ([]store.Thread, error) {
	rootPath := normalizePath(s.runtimes.RootPath(workspaceID))
	activeThreads, err := s.listByArchived(ctx, workspaceID, false)
	if err != nil {
		return nil, err
	}

	archivedThreads, err := s.listByArchived(ctx, workspaceID, true)
	if err != nil {
		return nil, err
	}

	items := append(activeThreads, archivedThreads...)
	items = mergeThreads(items, filterStoredThreads(s.store.ListThreads(workspaceID), rootPath))
	items = filterDeletedThreads(items, workspaceID, s.store)
	items = s.enrichThreadListCounts(workspaceID, items)
	sort.Slice(items, func(i int, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items, nil
}

func (s *Service) ListPage(
	ctx context.Context,
	workspaceID string,
	input ListPageInput,
) (ThreadListPage, error) {
	rootPath := normalizePath(s.runtimes.RootPath(workspaceID))
	cursor := strings.TrimSpace(input.Cursor)
	sortKey := normalizeThreadListSortKey(input.SortKey)
	pageLimit := normalizeThreadListPageLimit(input.Limit)
	archived := false
	if input.Archived != nil {
		archived = *input.Archived
	}

	if input.PreferCached && cursor == "" {
		fallback := s.buildStoredThreadListPage(workspaceID, archived, rootPath, pageLimit, sortKey)
		if len(fallback.Data) > 0 {
			return fallback, nil
		}
	}

	if !runtimeStateIsLive(s.runtimes.State(workspaceID).Status) {
		fallback := s.buildStoredThreadListPage(workspaceID, archived, rootPath, pageLimit, sortKey)
		if len(fallback.Data) > 0 {
			return fallback, nil
		}
	}

	items := make([]store.Thread, 0, pageLimit)
	for page := 0; page < 20 && len(items) < pageLimit; page++ {
		var response struct {
			Data       []map[string]any `json:"data"`
			NextCursor *string          `json:"nextCursor"`
		}

		params := map[string]any{
			"archived": archived,
			"limit":    pageLimit - len(items),
		}
		if cursor != "" {
			params["cursor"] = cursor
		}
		if sortKey != "" {
			params["sortKey"] = sortKey
		}

		callCtx, cancel, timeoutApplied := runtimeCallContext(ctx, threadRuntimeListTimeout)
		err := s.runtimes.Call(callCtx, workspaceID, "thread/list", params, &response)
		cancel()
		if err != nil {
			if runtimeCallTimedOut(err, timeoutApplied) {
				s.runtimes.Recycle(workspaceID)
				return s.buildStoredThreadListPage(workspaceID, archived, rootPath, pageLimit, sortKey), nil
			}
			return ThreadListPage{}, err
		}

		for _, thread := range response.Data {
			if !threadBelongsToWorkspace(thread, rootPath) {
				continue
			}

			mapped := mapThread(workspaceID, thread, archived)
			if s.store.IsThreadDeleted(workspaceID, mapped.ID) {
				continue
			}

			s.cacheThread(mapped)
			items = append(items, mapped)
		}

		if response.NextCursor == nil || strings.TrimSpace(*response.NextCursor) == "" {
			cursor = ""
			break
		}

		cursor = *response.NextCursor
	}

	items = s.enrichThreadListCounts(workspaceID, items)
	sortThreadsForListPage(items, sortKey)

	var nextCursor *string
	if cursor != "" {
		next := cursor
		nextCursor = &next
	}

	return ThreadListPage{
		Data:       items,
		NextCursor: nextCursor,
	}, nil
}

func (s *Service) buildStoredThreadListPage(
	workspaceID string,
	archived bool,
	workspaceRoot string,
	limit int,
	sortKey string,
) ThreadListPage {
	items := fallbackStoredThreadsByArchived(workspaceID, archived, workspaceRoot, s.store)
	if len(items) == 0 {
		return ThreadListPage{Data: []store.Thread{}}
	}

	items = s.enrichThreadListCounts(workspaceID, items)
	sortThreadsForListPage(items, sortKey)

	if limit <= 0 || len(items) <= limit {
		return ThreadListPage{
			Data: append([]store.Thread(nil), items...),
		}
	}

	nextCursor := "stored-snapshot"
	return ThreadListPage{
		Data:       append([]store.Thread(nil), items[:limit]...),
		NextCursor: &nextCursor,
	}
}

func (s *Service) Create(ctx context.Context, workspaceID string, input CreateInput) (store.Thread, error) {
	trimmedName := strings.TrimSpace(input.Name)
	sessionStartSource := NormalizeThreadStartSource(input.SessionStartSource)
	if sessionStartSource == "" {
		sessionStartSource = ThreadStartSourceStartup
	}

	var response appserver.ThreadStartResponse

	defaults, err := s.runtimeDefaults()
	if err != nil {
		return store.Thread{}, err
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/start", buildThreadStartRequest(s.runtimes.RootPath(workspaceID), input, defaults), &response); err != nil {
		return store.Thread{}, err
	}

	threadID := strings.TrimSpace(response.Thread.ID)
	if threadID == "" {
		return store.Thread{}, errors.New("thread/start returned empty thread id")
	}

	if trimmedName != "" {
		if _, err := s.Rename(ctx, workspaceID, threadID, trimmedName); err != nil {
			return store.Thread{}, err
		}
	}

	thread, err := s.Get(ctx, workspaceID, threadID)
	if err != nil {
		return store.Thread{}, err
	}
	thread.SessionStartSource = normalizeThreadSessionStartSource(thread.SessionStartSource)
	if thread.SessionStartSource == "" {
		thread.SessionStartSource = sessionStartSource
	}
	s.store.UpsertThread(thread)
	s.store.SetThreadSessionStartSource(workspaceID, thread.ID, thread.SessionStartSource, true)

	return thread, nil
}

type runtimeThreadDefaults struct {
	ApprovalPolicy     string
	SandboxMode        string
	HasSandboxOverride bool
}

func buildThreadStartRequest(rootPath string, input CreateInput, defaults runtimeThreadDefaults) appserver.ThreadStartRequest {
	request := appserver.ThreadStartRequest{
		Cwd: rootPath,
	}
	approvalPolicy := appconfig.ApprovalPolicyJSONValue(defaults.ApprovalPolicy)
	if approvalPolicy == "" {
		approvalPolicy = "on-request"
	}
	request.ApprovalPolicy = approvalPolicy

	sandboxMode := strings.TrimSpace(defaults.SandboxMode)
	switch {
	case sandboxMode != "":
		request.Sandbox = sandboxMode
	case !defaults.HasSandboxOverride:
		request.Sandbox = "workspace-write"
	}

	if model := strings.TrimSpace(input.Model); model != "" {
		request.Model = model
	}
	if source := NormalizeThreadStartSource(input.SessionStartSource); source != "" {
		request.SessionStartSource = source
	}

	switch normalizePermissionPreset(input.PermissionPreset) {
	case "full-access":
		request.ApprovalPolicy = "never"
		request.Sandbox = "danger-full-access"
	}

	return request
}

func buildThreadStartPayload(rootPath string, input CreateInput, defaults runtimeThreadDefaults) map[string]any {
	request := buildThreadStartRequest(rootPath, input, defaults)
	payload := map[string]any{
		"cwd":            request.Cwd,
		"approvalPolicy": request.ApprovalPolicy,
	}
	if strings.TrimSpace(request.Sandbox) != "" {
		payload["sandbox"] = request.Sandbox
	}
	if strings.TrimSpace(request.Model) != "" {
		payload["model"] = request.Model
	}
	if strings.TrimSpace(request.SessionStartSource) != "" {
		payload["sessionStartSource"] = request.SessionStartSource
	}
	return payload
}

func (s *Service) runtimeDefaults() (runtimeThreadDefaults, error) {
	prefs := s.store.GetRuntimePreferences()
	approvalPolicy, err := appconfig.NormalizeApprovalPolicy(prefs.DefaultTurnApprovalPolicy)
	if err != nil {
		return runtimeThreadDefaults{}, err
	}
	sandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(prefs.DefaultTurnSandboxPolicy)
	if err != nil {
		return runtimeThreadDefaults{}, err
	}

	return runtimeThreadDefaults{
		ApprovalPolicy:     approvalPolicy,
		SandboxMode:        appconfig.SandboxModeFromSandboxPolicyMap(sandboxPolicy),
		HasSandboxOverride: len(sandboxPolicy) > 0,
	}, nil
}

func normalizePermissionPreset(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "full-access":
		return "full-access"
	default:
		return "default"
	}
}

func NormalizeThreadStartSource(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case ThreadStartSourceStartup:
		return ThreadStartSourceStartup
	case ThreadStartSourceClear:
		return ThreadStartSourceClear
	default:
		return ""
	}
}

func normalizeThreadSessionStartSource(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case ThreadStartSourceStartup:
		return ThreadStartSourceStartup
	case ThreadStartSourceClear:
		return ThreadStartSourceClear
	case threadSessionStartSourceResume:
		return threadSessionStartSourceResume
	default:
		return ""
	}
}

func (s *Service) Get(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	threadData, err := s.readThread(ctx, workspaceID, threadID, false)
	if err != nil {
		return store.Thread{}, err
	}
	if !threadBelongsToWorkspace(threadData, normalizePath(s.runtimes.RootPath(workspaceID))) {
		return store.Thread{}, store.ErrThreadNotFound
	}

	thread := mapThread(workspaceID, threadData, isArchived(threadData))
	s.cacheThread(thread)
	return thread, nil
}

func (s *Service) GetDetail(ctx context.Context, workspaceID string, threadID string) (store.ThreadDetail, error) {
	return s.GetDetailWindow(ctx, workspaceID, threadID, 0, "", threadContentModeFull)
}

func (s *Service) GetTurn(
	ctx context.Context,
	workspaceID string,
	threadID string,
	turnID string,
	contentMode string,
) (store.ThreadTurn, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.ThreadTurn{}, err
	}

	contentMode = normalizeThreadContentMode(contentMode)
	if cachedDetail, ok := s.cachedThreadDetail(workspaceID, threadID); ok {
		if turn, found := findThreadTurnByID(cachedDetail.Turns, turnID); found {
			if contentMode == threadContentModeSummary {
				return summarizeThreadTurn(turn), nil
			}
			return cloneThreadTurn(turn), nil
		}
	}

	detail, err := s.GetDetailWindow(ctx, workspaceID, threadID, 0, "", threadContentModeFull)
	if err != nil {
		return store.ThreadTurn{}, err
	}

	turn, found := findThreadTurnByID(detail.Turns, turnID)
	if !found {
		return store.ThreadTurn{}, store.ErrThreadNotFound
	}

	if contentMode == threadContentModeSummary {
		return summarizeThreadTurn(turn), nil
	}

	return cloneThreadTurn(turn), nil
}

func (s *Service) GetTurnItem(
	ctx context.Context,
	workspaceID string,
	threadID string,
	turnID string,
	itemID string,
	contentMode string,
) (map[string]any, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return nil, err
	}

	contentMode = normalizeThreadContentMode(contentMode)
	if cachedDetail, ok := s.cachedThreadDetail(workspaceID, threadID); ok {
		if turn, found := findThreadTurnByID(cachedDetail.Turns, turnID); found {
			if item, itemFound := findThreadTurnItemByID(turn.Items, itemID); itemFound {
				if contentMode == threadContentModeSummary {
					return summarizeThreadItem(item), nil
				}
				return cloneItem(item), nil
			}
		}
	}

	detail, err := s.GetDetailWindow(ctx, workspaceID, threadID, 0, "", threadContentModeFull)
	if err != nil {
		return nil, err
	}

	turn, found := findThreadTurnByID(detail.Turns, turnID)
	if !found {
		return nil, store.ErrThreadNotFound
	}

	item, found := findThreadTurnItemByID(turn.Items, itemID)
	if !found {
		return nil, store.ErrThreadNotFound
	}

	if contentMode == threadContentModeSummary {
		return summarizeThreadItem(item), nil
	}

	return cloneItem(item), nil
}

func (s *Service) GetTurnItemOutput(
	ctx context.Context,
	workspaceID string,
	threadID string,
	turnID string,
	itemID string,
	outputMode string,
	tailLines int,
	beforeLine int,
) (ThreadTurnItemOutput, error) {
	item, err := s.GetTurnItem(
		ctx,
		workspaceID,
		threadID,
		turnID,
		itemID,
		threadContentModeFull,
	)
	if err != nil {
		return ThreadTurnItemOutput{}, err
	}

	if stringValue(item["type"]) != "commandExecution" {
		return ThreadTurnItemOutput{}, store.ErrThreadNotFound
	}

	outputMode = normalizeThreadOutputContentMode(outputMode)
	result := buildThreadTurnItemOutputFromItem(itemID, item)
	output := result.AggregatedOutput

	if outputMode == threadContentModeSummary {
		if preview, truncated := truncateMiddleSummaryString(output, threadExpandedCommandOutputPreviewLimit); truncated {
			result.AggregatedOutput = preview
			result.OutputContentMode = threadContentModeSummary
			result.OutputTruncated = true
		}
	} else if outputMode == threadOutputModeTail {
		if result.OutputTruncated && result.OutputContentMode == threadOutputModeTail {
			result = buildTailThreadTurnItemOutputFromStoredWindow(
				result,
				output,
				normalizeThreadOutputTailLines(tailLines),
				normalizeThreadOutputBeforeLine(beforeLine, result.OutputEndLine),
			)
		} else {
			result = buildTailThreadTurnItemOutput(
				result,
				output,
				normalizeThreadOutputTailLines(tailLines),
				normalizeThreadOutputBeforeLine(beforeLine, result.OutputLineCount),
			)
		}
	}

	return result, nil
}

func (s *Service) GetDetailWindow(
	ctx context.Context,
	workspaceID string,
	threadID string,
	turnLimit int,
	beforeTurnID string,
	contentMode string,
) (store.ThreadDetail, error) {
	requestStartedAt := time.Now()
	contentMode = normalizeThreadContentMode(contentMode)
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.ThreadDetail{}, err
	}

	if beforeTurnID != "" {
		if cachedDetail, beforeFound, ok, projectionReadSource, projectionScannedTurns := s.cachedThreadDetailWindow(workspaceID, threadID, turnLimit, beforeTurnID); ok && beforeFound {
			diagnostics.LogThreadTrace(
				workspaceID,
				threadID,
				"thread detail served from cache",
				appendThreadDetailPerformanceTraceAttrs(
					appendThreadDetailWindowReadTraceAttrs(
						appendThreadDetailTraceAttrs(
							[]any{
								"reason", "before_turn_cached",
								"beforeTurnId", beforeTurnID,
								"requestedTurnLimit", turnLimit,
								"contentMode", contentMode,
							},
							cachedDetail,
						),
						projectionReadSource,
						projectionScannedTurns,
					),
					time.Since(requestStartedAt),
				)...,
			)
			return finalizeWindowedThreadDetailResponse(cachedDetail, contentMode), nil
		}
	}

	if turnLimit > 0 && beforeTurnID == "" && s.shouldServeCurrentWindowFromCache(workspaceID, threadID) {
		if cachedDetail, _, ok, projectionReadSource, projectionScannedTurns := s.cachedThreadDetailWindow(workspaceID, threadID, turnLimit, ""); ok {
			diagnostics.LogThreadTrace(
				workspaceID,
				threadID,
				"thread detail served from cache",
				appendThreadDetailPerformanceTraceAttrs(
					appendThreadDetailWindowReadTraceAttrs(
						appendThreadDetailTraceAttrs(
							[]any{
								"reason", "current_window_cached",
								"requestedTurnLimit", turnLimit,
								"contentMode", contentMode,
							},
							cachedDetail,
						),
						projectionReadSource,
						projectionScannedTurns,
					),
					time.Since(requestStartedAt),
				)...,
			)
			return finalizeWindowedThreadDetailResponse(cachedDetail, contentMode), nil
		}
	}

	if turnLimit > 0 && !runtimeStateIsLive(s.runtimes.State(workspaceID).Status) {
		if cachedDetail, _, ok, projectionReadSource, projectionScannedTurns := s.cachedThreadDetailWindow(workspaceID, threadID, turnLimit, beforeTurnID); ok {
			diagnostics.LogThreadTrace(
				workspaceID,
				threadID,
				"thread detail served from cache",
				appendThreadDetailPerformanceTraceAttrs(
					appendThreadDetailWindowReadTraceAttrs(
						appendThreadDetailTraceAttrs(
							[]any{
								"reason", "runtime_not_live_cached",
								"requestedTurnLimit", turnLimit,
								"contentMode", contentMode,
							},
							cachedDetail,
						),
						projectionReadSource,
						projectionScannedTurns,
					),
					time.Since(requestStartedAt),
				)...,
			)
			return finalizeWindowedThreadDetailResponse(cachedDetail, contentMode), nil
		}
	}

	runtimeReadElapsed := time.Duration(0)
	runtimeReadIncludeTurns := true
	runtimeReadFallbackUsed := false
	readStartedAt := time.Now()
	threadData, err := s.readThread(ctx, workspaceID, threadID, true)
	runtimeReadElapsed += time.Since(readStartedAt)
	if err != nil {
		if !isThreadTurnsUnavailableBeforeFirstUserMessage(err) {
			if turnLimit > 0 {
				if cachedDetail, _, ok, projectionReadSource, projectionScannedTurns := s.cachedThreadDetailWindow(workspaceID, threadID, turnLimit, beforeTurnID); ok {
					diagnostics.LogThreadTrace(
						workspaceID,
						threadID,
						"thread detail served from cache after runtime read failure",
						appendThreadDetailRuntimeReadTraceAttrs(
							appendThreadDetailPerformanceTraceAttrs(
								appendThreadDetailWindowReadTraceAttrs(
									appendThreadDetailTraceAttrs(
										[]any{
											"reason", "runtime_read_failed_cached",
											"error", err,
											"requestedTurnLimit", turnLimit,
											"contentMode", contentMode,
										},
										cachedDetail,
									),
									projectionReadSource,
									projectionScannedTurns,
								),
								time.Since(requestStartedAt),
							),
							runtimeReadElapsed,
							runtimeReadIncludeTurns,
							runtimeReadFallbackUsed,
						)...,
					)
					return finalizeWindowedThreadDetailResponse(cachedDetail, contentMode), nil
				}
			}
			if cachedDetail, ok := s.cachedThreadDetail(workspaceID, threadID); ok {
				diagnostics.LogThreadTrace(
					workspaceID,
					threadID,
					"thread detail served from cache after runtime read failure",
					appendThreadDetailRuntimeReadTraceAttrs(
						appendThreadDetailPerformanceTraceAttrs(
							appendThreadDetailTraceAttrs(
								[]any{
									"reason", "runtime_read_failed_cached",
									"error", err,
									"requestedTurnLimit", turnLimit,
									"contentMode", contentMode,
								},
								cachedDetail,
							),
							time.Since(requestStartedAt),
						),
						runtimeReadElapsed,
						runtimeReadIncludeTurns,
						runtimeReadFallbackUsed,
					)...,
				)
				return finalizeThreadDetailResponse(cachedDetail, turnLimit, beforeTurnID, contentMode), nil
			}
			return store.ThreadDetail{}, err
		}

		runtimeReadFallbackUsed = true
		runtimeReadIncludeTurns = false
		readStartedAt = time.Now()
		threadData, err = s.readThread(ctx, workspaceID, threadID, false)
		runtimeReadElapsed += time.Since(readStartedAt)
		if err != nil {
			if turnLimit > 0 {
				if cachedDetail, _, ok, projectionReadSource, projectionScannedTurns := s.cachedThreadDetailWindow(workspaceID, threadID, turnLimit, beforeTurnID); ok {
					diagnostics.LogThreadTrace(
						workspaceID,
						threadID,
						"thread detail served from cache after turns-unavailable fallback failed",
						appendThreadDetailRuntimeReadTraceAttrs(
							appendThreadDetailPerformanceTraceAttrs(
								appendThreadDetailWindowReadTraceAttrs(
									appendThreadDetailTraceAttrs(
										[]any{
											"reason", "turns_unavailable_cached",
											"error", err,
											"requestedTurnLimit", turnLimit,
											"contentMode", contentMode,
										},
										cachedDetail,
									),
									projectionReadSource,
									projectionScannedTurns,
								),
								time.Since(requestStartedAt),
							),
							runtimeReadElapsed,
							runtimeReadIncludeTurns,
							runtimeReadFallbackUsed,
						)...,
					)
					return finalizeWindowedThreadDetailResponse(cachedDetail, contentMode), nil
				}
			}
			if cachedDetail, ok := s.cachedThreadDetail(workspaceID, threadID); ok {
				diagnostics.LogThreadTrace(
					workspaceID,
					threadID,
					"thread detail served from cache after turns-unavailable fallback failed",
					appendThreadDetailRuntimeReadTraceAttrs(
						appendThreadDetailPerformanceTraceAttrs(
							appendThreadDetailTraceAttrs(
								[]any{
									"reason", "turns_unavailable_cached",
									"error", err,
									"requestedTurnLimit", turnLimit,
									"contentMode", contentMode,
								},
								cachedDetail,
							),
							time.Since(requestStartedAt),
						),
						runtimeReadElapsed,
						runtimeReadIncludeTurns,
						runtimeReadFallbackUsed,
					)...,
				)
				return finalizeThreadDetailResponse(cachedDetail, turnLimit, beforeTurnID, contentMode), nil
			}
			return store.ThreadDetail{}, err
		}
	}
	if !threadBelongsToWorkspace(threadData, normalizePath(s.runtimes.RootPath(workspaceID))) {
		return store.ThreadDetail{}, store.ErrThreadNotFound
	}

	thread := mapThread(workspaceID, threadData, isArchived(threadData))
	s.cacheThread(thread)

	turns := mapTurns(threadData["turns"])
	if turns == nil {
		turns = []store.ThreadTurn{}
	}

	detail := store.ThreadDetail{
		Thread:       thread,
		Cwd:          stringValue(threadData["cwd"]),
		Preview:      stringValue(threadData["preview"]),
		Path:         stringValue(threadData["path"]),
		Source:       stringValue(threadData["source"]),
		TokenUsage:   mapThreadTokenUsage(threadData["tokenUsage"]),
		TurnCount:    len(turns),
		MessageCount: countThreadMessages(turns),
		HasMoreTurns: false,
		Turns:        turns,
	}
	diagnostics.LogThreadTrace(
		workspaceID,
		threadID,
		"thread detail loaded from runtime snapshot",
		appendThreadDetailRuntimeReadTraceAttrs(
			appendThreadDetailPerformanceTraceAttrs(
				appendThreadDetailTraceAttrs(
					[]any{
						"contentMode", contentMode,
						"requestedTurnLimit", turnLimit,
						"beforeTurnId", beforeTurnID,
					},
					detail,
				),
				time.Since(requestStartedAt),
			),
			runtimeReadElapsed,
			runtimeReadIncludeTurns,
			runtimeReadFallbackUsed,
		)...,
	)

	projectionMergeStartedAt := time.Now()
	projectedDetail := applyStoredProjection(detail, s.store, s.runtimes, workspaceID, threadID)
	projectedDetail = reconcileSettledThreadDetail(projectedDetail, s.runtimes.ActiveTurnID(workspaceID, threadID))
	projectedDetail.TurnCount = len(projectedDetail.Turns)
	projectedDetail.MessageCount = countThreadMessages(projectedDetail.Turns)
	projectionMergeElapsed := time.Since(projectionMergeStartedAt)
	projectionPersistStartedAt := time.Now()
	s.store.UpsertThreadProjectionSnapshot(projectedDetail)
	projectionPersistElapsed := time.Since(projectionPersistStartedAt)
	diagnostics.LogThreadTrace(
		workspaceID,
		threadID,
		"thread detail merged with projection",
		appendThreadDetailProjectionWorkTraceAttrs(
			appendThreadDetailRuntimeReadTraceAttrs(
				appendThreadDetailPerformanceTraceAttrs(
					appendThreadDetailTraceAttrs(
						[]any{
							"contentMode", contentMode,
							"requestedTurnLimit", turnLimit,
							"beforeTurnId", beforeTurnID,
							"activeTurnId", s.runtimes.ActiveTurnID(workspaceID, threadID),
						},
						projectedDetail,
					),
					time.Since(requestStartedAt),
				),
				runtimeReadElapsed,
				runtimeReadIncludeTurns,
				runtimeReadFallbackUsed,
			),
			projectionMergeElapsed,
			projectionPersistElapsed,
		)...,
	)

	return finalizeThreadDetailResponse(projectedDetail, turnLimit, beforeTurnID, contentMode), nil
}

func finalizeThreadDetailResponse(
	detail store.ThreadDetail,
	turnLimit int,
	beforeTurnID string,
	contentMode string,
) store.ThreadDetail {
	if turnLimit > 0 {
		detail = sliceThreadDetailTurns(detail, turnLimit, beforeTurnID)
	}

	if contentMode == threadContentModeSummary {
		detail = summarizeThreadDetailContent(detail)
	}

	return detail
}

func finalizeWindowedThreadDetailResponse(
	detail store.ThreadDetail,
	contentMode string,
) store.ThreadDetail {
	if contentMode == threadContentModeSummary {
		detail = summarizeThreadDetailContent(detail)
	}
	return detail
}

func (s *Service) cachedThreadDetail(workspaceID string, threadID string) (store.ThreadDetail, bool) {
	projection, ok := s.store.GetThreadProjection(workspaceID, threadID)
	if !ok || !projection.SnapshotComplete {
		return store.ThreadDetail{}, false
	}

	thread, foundThread := s.store.GetThread(workspaceID, threadID)
	if !foundThread {
		thread = store.Thread{
			ID:          threadID,
			WorkspaceID: workspaceID,
			Name:        "Untitled Thread",
			Status:      fallbackString(projection.Status, "idle"),
			UpdatedAt:   projection.UpdatedAt,
		}
	}

	detail := buildCachedThreadDetail(thread, projection)
	detail.Turns = reconcileServerRequestStatuses(detail.Turns, s.runtimes)
	detail = reconcileSettledThreadDetail(detail, s.runtimes.ActiveTurnID(workspaceID, threadID))
	detail.TurnCount = len(detail.Turns)
	detail.MessageCount = countThreadMessages(detail.Turns)
	return detail, true
}

func (s *Service) cachedThreadDetailWindow(
	workspaceID string,
	threadID string,
	turnLimit int,
	beforeTurnID string,
) (store.ThreadDetail, bool, bool, string, int) {
	window, ok := s.store.GetThreadProjectionWindow(workspaceID, threadID, turnLimit, beforeTurnID)
	if !ok || !window.Projection.SnapshotComplete {
		return store.ThreadDetail{}, false, false, "", 0
	}

	thread, foundThread := s.store.GetThread(workspaceID, threadID)
	if !foundThread {
		thread = store.Thread{
			ID:          threadID,
			WorkspaceID: workspaceID,
			Name:        "Untitled Thread",
			Status:      fallbackString(window.Projection.Status, "idle"),
			UpdatedAt:   window.Projection.UpdatedAt,
		}
	}

	detail := buildCachedThreadDetail(thread, window.Projection)
	detail.HasMoreTurns = window.HasMore
	detail.Turns = reconcileServerRequestStatuses(detail.Turns, s.runtimes)
	detail = reconcileSettledThreadDetail(detail, s.runtimes.ActiveTurnID(workspaceID, threadID))
	if window.Projection.TurnCount > 0 {
		detail.TurnCount = window.Projection.TurnCount
	}
	if window.Projection.MessageCount > 0 {
		detail.MessageCount = window.Projection.MessageCount
	}
	detail.HasMoreTurns = window.HasMore
	return detail, window.BeforeTurnFound, true, window.ReadSource, window.ScannedTurns
}

func sliceThreadDetailTurns(
	detail store.ThreadDetail,
	turnLimit int,
	beforeTurnID string,
) store.ThreadDetail {
	if turnLimit <= 0 || len(detail.Turns) <= turnLimit && beforeTurnID == "" {
		detail.HasMoreTurns = false
		return detail
	}

	endIndex := len(detail.Turns)
	if beforeTurnID != "" {
		for index, turn := range detail.Turns {
			if turn.ID == beforeTurnID {
				endIndex = index
				break
			}
		}
	}

	if endIndex < 0 {
		endIndex = 0
	}
	if endIndex > len(detail.Turns) {
		endIndex = len(detail.Turns)
	}

	startIndex := endIndex - turnLimit
	if startIndex < 0 {
		startIndex = 0
	}

	detail.HasMoreTurns = startIndex > 0
	detail.Turns = append([]store.ThreadTurn{}, detail.Turns[startIndex:endIndex]...)
	return detail
}

func buildCachedThreadDetail(thread store.Thread, projection store.ThreadProjection) store.ThreadDetail {
	detail := store.ThreadDetail{
		Thread:       thread,
		Cwd:          fallbackString(projection.Cwd, thread.Cwd),
		Preview:      projection.Preview,
		Path:         projection.Path,
		Source:       projection.Source,
		TokenUsage:   cloneThreadTokenUsageLocal(projection.TokenUsage),
		TurnCount:    projection.TurnCount,
		MessageCount: projection.MessageCount,
		HasMoreTurns: false,
		Turns:        normalizeStoredThreadTurnsForClient(projection.Turns),
	}

	if detail.TurnCount == 0 && len(projection.Turns) > 0 {
		detail.TurnCount = storeProjectedConversationTurnCount(projection.Turns)
	}
	if detail.MessageCount == 0 && len(projection.Turns) > 0 {
		detail.MessageCount = countThreadMessages(projection.Turns)
	}

	if projection.Status != "" {
		detail.Status = projection.Status
	}
	if projection.UpdatedAt.After(detail.UpdatedAt) {
		detail.UpdatedAt = projection.UpdatedAt
	}

	return detail
}

func storeProjectedConversationTurnCount(turns []store.ThreadTurn) int {
	count := 0
	for _, turn := range turns {
		if strings.TrimSpace(turn.ID) == "thread-governance" {
			continue
		}
		count += 1
	}
	return count
}

func normalizeStoredThreadTurnsForClient(turns []store.ThreadTurn) []store.ThreadTurn {
	nextTurns := cloneThreadTurnsLocal(turns)
	for turnIndex := range nextTurns {
		for itemIndex := range nextTurns[turnIndex].Items {
			nextTurns[turnIndex].Items[itemIndex] = normalizeStoredThreadTurnItemForClient(nextTurns[turnIndex].Items[itemIndex])
		}
	}
	return nextTurns
}

func normalizeStoredThreadTurnItemForClient(item map[string]any) map[string]any {
	next := cloneTurnItemLocal(item)
	if stringValue(next["type"]) != "commandExecution" {
		return next
	}

	output := stringValue(next["aggregatedOutput"])
	totalLength := int(int64Value(next["outputTotalLength"]))
	if totalLength < len(output) {
		totalLength = len(output)
	}

	totalLines := int(int64Value(next["outputLineCount"]))
	if totalLines < countOutputLines(output) {
		totalLines = countOutputLines(output)
	}

	storedTruncated := boolValue(next["outputTruncated"]) || totalLength > len(output)
	if !storedTruncated {
		return next
	}

	startOffset := int(int64Value(next["outputStartOffset"]))
	if startOffset < 0 || startOffset > totalLength {
		startOffset = totalLength - len(output)
	}
	if startOffset < 0 {
		startOffset = 0
	}

	endOffset := int(int64Value(next["outputEndOffset"]))
	if endOffset < startOffset || endOffset > totalLength {
		endOffset = startOffset + trimOutputLineBreakSuffix(output)
		if endOffset > totalLength {
			endOffset = totalLength
		}
	}

	storedLineCount := countOutputLines(output)
	startLine := int(int64Value(next["outputStartLine"]))
	endLine := int(int64Value(next["outputEndLine"]))
	if endLine <= 0 || endLine > totalLines {
		endLine = totalLines
	}
	if storedLineCount > 0 {
		expectedStartLine := endLine - storedLineCount
		if expectedStartLine < 0 {
			expectedStartLine = 0
		}
		if startLine < 0 || startLine > endLine {
			startLine = expectedStartLine
		}
	}

	next["outputContentMode"] = threadOutputModeTail
	next["outputTruncated"] = true
	next["outputStartOffset"] = startOffset
	next["outputEndOffset"] = endOffset
	next["outputTotalLength"] = totalLength
	next["outputStartLine"] = startLine
	next["outputEndLine"] = endLine
	next["outputLineCount"] = totalLines
	next["summaryTruncated"] = true
	return next
}

func (s *Service) shouldServeCurrentWindowFromCache(workspaceID string, threadID string) bool {
	projection, ok := s.store.GetThreadProjectionSummary(workspaceID, threadID)
	if !ok || !projection.SnapshotComplete {
		return false
	}

	if s.runtimes.ActiveTurnID(workspaceID, threadID) != "" {
		return false
	}

	if projectionLooksActive(projection) {
		return false
	}

	thread, ok := s.store.GetThread(workspaceID, threadID)
	if !ok {
		return true
	}

	return !projection.UpdatedAt.Before(thread.UpdatedAt)
}

func projectionLooksActive(projection store.ThreadProjection) bool {
	if statusLooksActive(projection.Status) {
		return true
	}

	for _, turn := range projection.Turns {
		if statusLooksActive(turn.Status) {
			return true
		}

		for _, item := range turn.Items {
			if itemLooksActive(item) {
				return true
			}
		}
	}

	return false
}

func itemLooksActive(item map[string]any) bool {
	if statusLooksActive(stringValue(item["status"])) {
		return true
	}

	if strings.EqualFold(strings.TrimSpace(stringValue(item["phase"])), "streaming") {
		return true
	}

	return stringValue(item["type"]) == "serverRequest" &&
		strings.EqualFold(strings.TrimSpace(stringValue(item["status"])), "pending")
}

func statusLooksActive(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "_", "")
	normalized = strings.ReplaceAll(normalized, "-", "")

	switch normalized {
	case "active", "running", "processing", "sending", "waiting", "inprogress", "started":
		return true
	default:
		return false
	}
}

func reconcileSettledThreadDetail(detail store.ThreadDetail, activeTurnID string) store.ThreadDetail {
	if strings.TrimSpace(activeTurnID) != "" {
		return detail
	}

	changed := false
	nextTurns := cloneThreadTurnsLocal(detail.Turns)
	for turnIndex, turn := range nextTurns {
		nextTurn, turnChanged := reconcileSettledThreadTurn(
			turn,
			detail.UpdatedAt,
			turnIndex < len(nextTurns)-1,
		)
		if !turnChanged {
			continue
		}

		nextTurns[turnIndex] = nextTurn
		changed = true
	}

	nextDetail := detail
	if changed {
		nextDetail.Turns = nextTurns
		nextDetail.TurnCount = len(nextTurns)
		nextDetail.MessageCount = countThreadMessages(nextTurns)
	}
	if len(nextDetail.Turns) > 0 && statusLooksActive(nextDetail.Status) && !threadTurnsLookActive(nextDetail.Turns) {
		nextDetail.Status = "idle"
		changed = true
	}

	if !changed {
		return detail
	}

	return nextDetail
}

func reconcileSettledThreadTurn(turn store.ThreadTurn, ts time.Time, hasLaterTurn bool) (store.ThreadTurn, bool) {
	if turnHasPendingServerRequest(turn) {
		return turn, false
	}

	settlementStatus, shouldSettle := settledTurnStatus(turn, hasLaterTurn)
	if !shouldSettle {
		return turn, false
	}

	turnChanged := false
	nextTurn := cloneThreadTurn(turn)
	if statusLooksActive(turn.Status) {
		nextTurn.Status = settlementStatus
		turnChanged = true
	}

	nextItems := cloneItems(turn.Items)
	itemChanged := false
	for itemIndex, item := range nextItems {
		nextItem, changed := reconcileSettledThreadItem(item, ts, settlementStatus)
		nextItems[itemIndex] = nextItem
		itemChanged = itemChanged || changed
	}

	if itemChanged {
		nextTurn.Items = nextItems
		turnChanged = true
	}

	return nextTurn, turnChanged
}

func reconcileSettledThreadItem(item map[string]any, ts time.Time, settlementStatus string) (map[string]any, bool) {
	status := stringValue(item["status"])
	phase := strings.TrimSpace(stringValue(item["phase"]))
	itemType := stringValue(item["type"])

	if itemType == "serverRequest" {
		return item, false
	}
	if !statusLooksActive(status) && !strings.EqualFold(phase, "streaming") {
		return item, false
	}

	nextItem := cloneItem(item)
	changed := false

	if statusLooksActive(status) {
		nextItem["status"] = settlementStatus
		changed = true
	}

	if strings.EqualFold(phase, "streaming") {
		delete(nextItem, "phase")
		changed = true
	}

	return nextItem, changed
}

func settledTurnStatus(turn store.ThreadTurn, hasLaterTurn bool) (string, bool) {
	if !turnLooksActive(turn) {
		return "", false
	}
	if turn.Error != nil {
		return "failed", true
	}
	if hasLaterTurn || turnHasFinalAnswer(turn) || !turnHasActiveItemSignals(turn) {
		return "completed", true
	}
	return "interrupted", true
}

func threadTurnsLookActive(turns []store.ThreadTurn) bool {
	for _, turn := range turns {
		if turnLooksActive(turn) {
			return true
		}
	}

	return false
}

func turnLooksActive(turn store.ThreadTurn) bool {
	if statusLooksActive(turn.Status) {
		return true
	}

	return turnHasActiveItemSignals(turn)
}

func turnHasActiveItemSignals(turn store.ThreadTurn) bool {
	for _, item := range turn.Items {
		if itemLooksActive(item) {
			return true
		}
	}

	return false
}

func turnHasPendingServerRequest(turn store.ThreadTurn) bool {
	for _, item := range turn.Items {
		if stringValue(item["type"]) != "serverRequest" {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(stringValue(item["status"])), "pending") {
			return true
		}
	}

	return false
}

func turnHasFinalAnswer(turn store.ThreadTurn) bool {
	for _, item := range turn.Items {
		if stringValue(item["type"]) != "agentMessage" {
			continue
		}

		phase := strings.ToLower(strings.TrimSpace(stringValue(item["phase"])))
		phase = strings.ReplaceAll(phase, "_", "")
		phase = strings.ReplaceAll(phase, "-", "")
		if phase == "finalanswer" {
			return true
		}
	}

	return false
}

func runtimeStateIsLive(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "ready", "active", "connected", "starting":
		return true
	default:
		return false
	}
}

func runtimeCallContext(
	ctx context.Context,
	timeout time.Duration,
) (context.Context, context.CancelFunc, bool) {
	if timeout <= 0 {
		callCtx, cancel := context.WithCancel(ctx)
		return callCtx, cancel, false
	}

	if deadline, ok := ctx.Deadline(); ok {
		if time.Until(deadline) <= timeout {
			callCtx, cancel := context.WithCancel(ctx)
			return callCtx, cancel, false
		}
	}

	callCtx, cancel := context.WithTimeout(ctx, timeout)
	return callCtx, cancel, true
}

func runtimeCallTimedOut(err error, timeoutApplied bool) bool {
	return timeoutApplied && errors.Is(err, context.DeadlineExceeded)
}

func threadDetailHasTurnID(detail store.ThreadDetail, turnID string) bool {
	if turnID == "" {
		return false
	}

	for _, turn := range detail.Turns {
		if turn.ID == turnID {
			return true
		}
	}

	return false
}

func cloneThreadTokenUsageLocal(usage *store.ThreadTokenUsage) *store.ThreadTokenUsage {
	if usage == nil {
		return nil
	}

	cloned := *usage
	if usage.ModelContextWindow != nil {
		value := *usage.ModelContextWindow
		cloned.ModelContextWindow = &value
	}
	return &cloned
}

func cloneThreadTurnsLocal(turns []store.ThreadTurn) []store.ThreadTurn {
	if len(turns) == 0 {
		return []store.ThreadTurn{}
	}

	cloned := make([]store.ThreadTurn, 0, len(turns))
	for _, turn := range turns {
		cloned = append(cloned, store.ThreadTurn{
			ID:     turn.ID,
			Status: turn.Status,
			Items:  cloneTurnItemsLocal(turn.Items),
			Error:  turn.Error,
		})
	}

	return cloned
}

func cloneTurnItemsLocal(items []map[string]any) []map[string]any {
	if len(items) == 0 {
		return []map[string]any{}
	}

	cloned := make([]map[string]any, 0, len(items))
	for _, item := range items {
		cloned = append(cloned, cloneTurnItemLocal(item))
	}

	return cloned
}

func cloneTurnItemLocal(item map[string]any) map[string]any {
	next := make(map[string]any, len(item))
	for key, value := range item {
		next[key] = value
	}
	return next
}

func (s *Service) readThread(ctx context.Context, workspaceID string, threadID string, includeTurns bool) (map[string]any, error) {
	var response struct {
		Thread map[string]any `json:"thread"`
	}

	callCtx, cancel, timeoutApplied := runtimeCallContext(ctx, threadRuntimeReadTimeout)
	defer cancel()

	if err := s.runtimes.Call(callCtx, workspaceID, "thread/read", map[string]any{
		"includeTurns": includeTurns,
		"threadId":     threadID,
	}, &response); err != nil {
		if runtimeCallTimedOut(err, timeoutApplied) {
			s.runtimes.Recycle(workspaceID)
		}
		return nil, err
	}

	return response.Thread, nil
}

func (s *Service) ListLoaded(ctx context.Context, workspaceID string) ([]string, error) {
	if !runtimeStateIsLive(s.runtimes.State(workspaceID).Status) {
		fallback := fallbackStoredLoadedThreadIDs(workspaceID, s.store)
		if len(fallback) > 0 {
			return fallback, nil
		}
	}

	var response struct {
		Data []string `json:"data"`
	}

	callCtx, cancel, timeoutApplied := runtimeCallContext(ctx, threadRuntimeListTimeout)
	defer cancel()

	if err := s.runtimes.Call(callCtx, workspaceID, "thread/loaded/list", map[string]any{
		"limit": 200,
	}, &response); err != nil {
		if runtimeCallTimedOut(err, timeoutApplied) {
			s.runtimes.Recycle(workspaceID)
			return fallbackStoredLoadedThreadIDs(workspaceID, s.store), nil
		}
		return nil, err
	}

	return response.Data, nil
}

func (s *Service) UpdateMetadata(ctx context.Context, workspaceID string, threadID string, gitInfo map[string]any) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	var response struct {
		Thread map[string]any `json:"thread"`
	}

	params := map[string]any{
		"threadId": threadID,
	}
	if len(gitInfo) > 0 {
		params["gitInfo"] = gitInfo
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/metadata/update", params, &response); err != nil {
		return store.Thread{}, err
	}

	thread := mapThread(workspaceID, response.Thread, isArchived(response.Thread))
	s.cacheThread(thread)
	return thread, nil
}

func (s *Service) Compact(ctx context.Context, workspaceID string, threadID string) error {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return err
	}

	return s.runtimes.Call(ctx, workspaceID, "thread/compact/start", map[string]any{
		"threadId": threadID,
	}, nil)
}

func (s *Service) Resume(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	var response struct {
		Thread map[string]any `json:"thread"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/resume", map[string]any{
		"cwd":      s.runtimes.RootPath(workspaceID),
		"threadId": threadID,
	}, &response); err != nil {
		return store.Thread{}, err
	}

	thread := mapThread(workspaceID, response.Thread, isArchived(response.Thread))
	thread.SessionStartSource = threadSessionStartSourceResume
	s.cacheThread(thread)
	s.store.SetThreadSessionStartSource(workspaceID, thread.ID, thread.SessionStartSource, true)
	return thread, nil
}

func (s *Service) Fork(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	var response struct {
		Thread map[string]any `json:"thread"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/fork", map[string]any{
		"cwd":      s.runtimes.RootPath(workspaceID),
		"threadId": threadID,
	}, &response); err != nil {
		return store.Thread{}, err
	}

	thread := mapThread(workspaceID, response.Thread, false)
	s.cacheThread(thread)
	return thread, nil
}

func (s *Service) Archive(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/archive", map[string]any{
		"threadId": threadID,
	}, nil); err != nil {
		return store.Thread{}, err
	}

	thread, err := s.Get(ctx, workspaceID, threadID)
	if err != nil {
		return store.Thread{}, err
	}

	thread.Archived = true
	s.cacheThread(thread)
	return thread, nil
}

func (s *Service) Unarchive(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/unarchive", map[string]any{
		"threadId": threadID,
	}, nil); err != nil {
		return store.Thread{}, err
	}

	thread, err := s.Get(ctx, workspaceID, threadID)
	if err != nil {
		return store.Thread{}, err
	}

	thread.Archived = false
	s.cacheThread(thread)
	return thread, nil
}

func (s *Service) Rename(ctx context.Context, workspaceID string, threadID string, name string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	if strings.TrimSpace(name) == "" {
		return store.Thread{}, errors.New("thread name is required")
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/name/set", map[string]any{
		"name":     name,
		"threadId": threadID,
	}, nil); err != nil {
		return store.Thread{}, err
	}

	thread, err := s.Get(ctx, workspaceID, threadID)
	if err != nil {
		return store.Thread{}, err
	}

	return thread, nil
}

func (s *Service) Rollback(ctx context.Context, workspaceID string, threadID string) error {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return err
	}

	return s.runtimes.Call(ctx, workspaceID, "thread/rollback", map[string]any{
		"numTurns": 1,
		"threadId": threadID,
	}, nil)
}

func (s *Service) Delete(ctx context.Context, workspaceID string, threadID string) error {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return err
	}

	if _, ok := s.store.GetWorkspace(workspaceID); !ok {
		return store.ErrWorkspaceNotFound
	}

	if _, ok := s.store.GetThread(workspaceID, threadID); !ok {
		if _, err := s.Get(ctx, workspaceID, threadID); err != nil {
			return err
		}
	}

	state := s.runtimes.State(workspaceID).Status
	if state == "ready" || state == "active" || state == "connected" {
		var response struct {
			Status string `json:"status"`
		}
		_ = s.runtimes.Call(ctx, workspaceID, "thread/unsubscribe", map[string]any{
			"threadId": threadID,
		}, &response)
	}

	return s.store.DeleteThread(workspaceID, threadID)
}

func (s *Service) ShellCommand(ctx context.Context, workspaceID string, threadID string, command string) error {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return err
	}
	if strings.TrimSpace(command) == "" {
		return errors.New("shell command is required")
	}

	if err := s.runThreadShellCommand(ctx, workspaceID, threadID, command); err != nil {
		if !isThreadResumeRequired(err) {
			return err
		}
		if _, resumeErr := s.Resume(ctx, workspaceID, threadID); resumeErr != nil {
			return resumeErr
		}
		return s.runThreadShellCommand(ctx, workspaceID, threadID, command)
	}

	return nil
}

func (s *Service) runThreadShellCommand(ctx context.Context, workspaceID string, threadID string, command string) error {
	return s.runtimes.Call(ctx, workspaceID, "thread/shellCommand", map[string]any{
		"threadId": threadID,
		"command":  command,
	}, nil)
}

func (s *Service) listByArchived(ctx context.Context, workspaceID string, archived bool) ([]store.Thread, error) {
	rootPath := normalizePath(s.runtimes.RootPath(workspaceID))
	if !runtimeStateIsLive(s.runtimes.State(workspaceID).Status) {
		fallback := fallbackStoredThreadsByArchived(workspaceID, archived, rootPath, s.store)
		if len(fallback) > 0 {
			return fallback, nil
		}
	}

	cursor := ""
	items := make([]store.Thread, 0)

	for page := 0; page < 20; page++ {
		var response struct {
			Data       []map[string]any `json:"data"`
			NextCursor *string          `json:"nextCursor"`
		}

		params := map[string]any{
			"archived": archived,
			"limit":    200,
		}
		if cursor != "" {
			params["cursor"] = cursor
		}

		callCtx, cancel, timeoutApplied := runtimeCallContext(ctx, threadRuntimeListTimeout)
		err := s.runtimes.Call(callCtx, workspaceID, "thread/list", params, &response)
		cancel()
		if err != nil {
			if runtimeCallTimedOut(err, timeoutApplied) {
				s.runtimes.Recycle(workspaceID)
				return fallbackStoredThreadsByArchived(workspaceID, archived, rootPath, s.store), nil
			}
			return nil, err
		}

		for _, thread := range response.Data {
			if !threadBelongsToWorkspace(thread, rootPath) {
				continue
			}

			mapped := mapThread(workspaceID, thread, archived)
			if s.store.IsThreadDeleted(workspaceID, mapped.ID) {
				continue
			}
			s.cacheThread(mapped)
			items = append(items, mapped)
		}

		if response.NextCursor == nil || strings.TrimSpace(*response.NextCursor) == "" {
			break
		}

		cursor = *response.NextCursor
	}

	return items, nil
}

func mergeThreads(primary []store.Thread, secondary []store.Thread) []store.Thread {
	byID := make(map[string]store.Thread, len(primary)+len(secondary))
	for _, thread := range secondary {
		byID[thread.ID] = thread
	}
	for _, thread := range primary {
		byID[thread.ID] = thread
	}

	items := make([]store.Thread, 0, len(byID))
	for _, thread := range byID {
		items = append(items, thread)
	}

	return items
}

func filterStoredThreads(items []store.Thread, workspaceRoot string) []store.Thread {
	filtered := make([]store.Thread, 0, len(items))
	for _, thread := range items {
		if storedThreadBelongsToWorkspace(thread, workspaceRoot) {
			filtered = append(filtered, thread)
		}
	}

	return filtered
}

func filterThreadsByArchived(items []store.Thread, archived bool) []store.Thread {
	filtered := make([]store.Thread, 0, len(items))
	for _, thread := range items {
		if thread.Archived == archived {
			filtered = append(filtered, thread)
		}
	}

	return filtered
}

func fallbackStoredThreadsByArchived(
	workspaceID string,
	archived bool,
	workspaceRoot string,
	dataStore *store.MemoryStore,
) []store.Thread {
	items := filterStoredThreads(dataStore.ListThreads(workspaceID), workspaceRoot)
	items = filterThreadsByArchived(items, archived)
	items = filterDeletedThreads(items, workspaceID, dataStore)
	return items
}

func sortThreadsForListPage(items []store.Thread, sortKey string) {
	sort.SliceStable(items, func(i int, j int) bool {
		switch sortKey {
		case threadSortKeyCreatedAt:
			if items[i].CreatedAt.Equal(items[j].CreatedAt) {
				return items[i].UpdatedAt.After(items[j].UpdatedAt)
			}
			return items[i].CreatedAt.After(items[j].CreatedAt)
		default:
			if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
				return items[i].CreatedAt.After(items[j].CreatedAt)
			}
			return items[i].UpdatedAt.After(items[j].UpdatedAt)
		}
	})
}

func fallbackStoredLoadedThreadIDs(workspaceID string, dataStore *store.MemoryStore) []string {
	threads := dataStore.ListThreads(workspaceID)
	ids := make([]string, 0, len(threads))
	for _, thread := range threads {
		if strings.TrimSpace(thread.ID) == "" || thread.Archived {
			continue
		}
		ids = append(ids, thread.ID)
	}

	return ids
}

func filterDeletedThreads(items []store.Thread, workspaceID string, dataStore *store.MemoryStore) []store.Thread {
	filtered := make([]store.Thread, 0, len(items))
	for _, thread := range items {
		if dataStore.IsThreadDeleted(workspaceID, thread.ID) {
			continue
		}
		filtered = append(filtered, thread)
	}

	return filtered
}

func mapTurns(value any) []store.ThreadTurn {
	rawTurns, ok := value.([]any)
	if !ok {
		return nil
	}

	turns := make([]store.ThreadTurn, 0, len(rawTurns))
	for _, rawTurn := range rawTurns {
		turnObject, ok := rawTurn.(map[string]any)
		if !ok {
			continue
		}

		items := make([]map[string]any, 0)
		if rawItems, ok := turnObject["items"].([]any); ok {
			for _, rawItem := range rawItems {
				if item, ok := rawItem.(map[string]any); ok {
					items = append(items, item)
				}
			}
		}

		turns = append(turns, store.ThreadTurn{
			ID:     stringValue(turnObject["id"]),
			Status: stringValue(turnObject["status"]),
			Items:  items,
			Error:  turnObject["error"],
		})
	}

	return turns
}

func mapThreadTokenUsage(value any) *store.ThreadTokenUsage {
	rawUsage, ok := value.(map[string]any)
	if !ok {
		return nil
	}

	total, ok := rawUsage["total"].(map[string]any)
	if !ok {
		return nil
	}

	last, _ := rawUsage["last"].(map[string]any)
	if last == nil {
		last = map[string]any{}
	}

	usage := &store.ThreadTokenUsage{
		Last: store.TokenUsageBreakdown{
			CachedInputTokens:     int64Value(last["cachedInputTokens"]),
			InputTokens:           int64Value(last["inputTokens"]),
			OutputTokens:          int64Value(last["outputTokens"]),
			ReasoningOutputTokens: int64Value(last["reasoningOutputTokens"]),
			TotalTokens:           int64Value(last["totalTokens"]),
		},
		Total: store.TokenUsageBreakdown{
			CachedInputTokens:     int64Value(total["cachedInputTokens"]),
			InputTokens:           int64Value(total["inputTokens"]),
			OutputTokens:          int64Value(total["outputTokens"]),
			ReasoningOutputTokens: int64Value(total["reasoningOutputTokens"]),
			TotalTokens:           int64Value(total["totalTokens"]),
		},
	}

	if modelContextWindow := int64Value(rawUsage["modelContextWindow"]); modelContextWindow > 0 {
		usage.ModelContextWindow = &modelContextWindow
	}

	return usage
}

func applyStoredProjection(
	detail store.ThreadDetail,
	dataStore *store.MemoryStore,
	runtimes *runtime.Manager,
	workspaceID string,
	threadID string,
) store.ThreadDetail {
	projection, ok := dataStore.GetThreadProjection(workspaceID, threadID)
	if !ok {
		diagnostics.LogThreadTrace(workspaceID, threadID, "no stored thread projection available")
		return detail
	}
	diagnostics.LogThreadTrace(
		workspaceID,
		threadID,
		"applying stored thread projection",
		appendProjectionTraceAttrs(nil, projection)...,
	)

	if projection.Status != "" {
		detail.Status = projection.Status
	}
	if projection.TokenUsage != nil {
		detail.TokenUsage = projection.TokenUsage
	}
	if projection.UpdatedAt.After(detail.UpdatedAt) {
		detail.UpdatedAt = projection.UpdatedAt
	}
	detail.Turns = mergeProjectedTurns(detail.Turns, projection.Turns)
	detail.Turns = reconcileServerRequestStatuses(detail.Turns, runtimes)
	if runtimes != nil {
		detail = reconcileSettledThreadDetail(detail, runtimes.ActiveTurnID(workspaceID, threadID))
	}
	diagnostics.LogThreadTrace(
		workspaceID,
		threadID,
		"stored thread projection applied",
		appendThreadDetailTraceAttrs(nil, detail)...,
	)

	return detail
}

func appendProjectionTraceAttrs(attrs []any, projection store.ThreadProjection) []any {
	attrs = append(attrs,
		"projectionStatus", projection.Status,
		"projectionTurnCount", len(projection.Turns),
		"projectionMessageCount", projection.MessageCount,
		"projectionSnapshotComplete", projection.SnapshotComplete,
	)
	if !projection.UpdatedAt.IsZero() {
		attrs = append(attrs, "projectionUpdatedAt", projection.UpdatedAt.Format(time.RFC3339))
	}
	return attrs
}

func appendThreadDetailTraceAttrs(attrs []any, detail store.ThreadDetail) []any {
	attrs = append(attrs,
		"status", detail.Status,
		"turnCount", len(detail.Turns),
		"messageCount", countThreadMessages(detail.Turns),
		"hasMoreTurns", detail.HasMoreTurns,
	)
	if !detail.UpdatedAt.IsZero() {
		attrs = append(attrs, "updatedAt", detail.UpdatedAt.Format(time.RFC3339))
	}
	return attrs
}

func appendThreadDetailPerformanceTraceAttrs(attrs []any, elapsed time.Duration) []any {
	return append(attrs, "elapsedMs", durationMilliseconds(elapsed))
}

func appendThreadDetailRuntimeReadTraceAttrs(
	attrs []any,
	runtimeReadElapsed time.Duration,
	runtimeReadIncludeTurns bool,
	runtimeReadFallbackUsed bool,
) []any {
	attrs = append(attrs,
		"runtimeReadMs", durationMilliseconds(runtimeReadElapsed),
		"runtimeReadIncludeTurns", runtimeReadIncludeTurns,
	)
	if runtimeReadFallbackUsed {
		attrs = append(attrs, "runtimeReadFallbackUsed", true)
	}
	return attrs
}

func appendThreadDetailProjectionWorkTraceAttrs(
	attrs []any,
	projectionMergeElapsed time.Duration,
	projectionPersistElapsed time.Duration,
) []any {
	return append(attrs,
		"projectionMergeMs", durationMilliseconds(projectionMergeElapsed),
		"projectionPersistMs", durationMilliseconds(projectionPersistElapsed),
	)
}

func appendThreadDetailWindowReadTraceAttrs(attrs []any, projectionReadSource string, projectionScannedTurns int) []any {
	if strings.TrimSpace(projectionReadSource) != "" {
		attrs = append(attrs, "projectionReadSource", projectionReadSource)
	}
	if projectionScannedTurns > 0 {
		attrs = append(attrs, "projectionScannedTurns", projectionScannedTurns)
	}
	return attrs
}

func durationMilliseconds(elapsed time.Duration) int64 {
	if elapsed <= 0 {
		return 0
	}
	return elapsed.Milliseconds()
}

func mergeProjectedTurns(base []store.ThreadTurn, overlay []store.ThreadTurn) []store.ThreadTurn {
	if len(overlay) == 0 {
		return base
	}

	nextTurns := append([]store.ThreadTurn{}, base...)
	insertedLeadingGovernance := false
	for _, projectedTurn := range overlay {
		index := -1
		for turnIndex, turn := range nextTurns {
			if turn.ID == projectedTurn.ID {
				index = turnIndex
				break
			}
		}

		if index < 0 {
			if !insertedLeadingGovernance && strings.TrimSpace(projectedTurn.ID) == "thread-governance" {
				nextTurns = append([]store.ThreadTurn{cloneThreadTurn(projectedTurn)}, nextTurns...)
				insertedLeadingGovernance = true
				continue
			}
			nextTurns = append(nextTurns, cloneThreadTurn(projectedTurn))
			continue
		}

		nextTurns[index] = mergeProjectedTurn(nextTurns[index], projectedTurn)
	}

	return nextTurns
}

func mergeProjectedTurn(base store.ThreadTurn, overlay store.ThreadTurn) store.ThreadTurn {
	next := cloneThreadTurn(base)
	if overlay.Status != "" {
		next.Status = overlay.Status
	}
	if overlay.Error != nil {
		next.Error = overlay.Error
	}
	next.Items = mergeProjectedItemsPreserveOverlayOrder(next.Items, overlay.Items)
	return next
}

func mergeProjectedItems(base []map[string]any, overlay []map[string]any) []map[string]any {
	if len(overlay) == 0 {
		return cloneItems(base)
	}

	nextItems := cloneItems(base)
	for _, projectedItem := range overlay {
		projectedID := stringValue(projectedItem["id"])
		if projectedID == "" {
			nextItems = append(nextItems, cloneItem(projectedItem))
			continue
		}

		index := -1
		for itemIndex, item := range nextItems {
			if stringValue(item["id"]) == projectedID {
				index = itemIndex
				break
			}
		}

		semanticMatch := false
		if index < 0 {
			index = findEquivalentProjectedItemIndex(nextItems, projectedItem)
			semanticMatch = index >= 0
		}

		if index < 0 {
			nextItems = append(nextItems, cloneItem(projectedItem))
			continue
		}

		merged := mergeProjectedItem(nextItems[index], projectedItem)
		if semanticMatch {
			merged["id"] = chooseCanonicalProjectedItemID(
				stringValue(nextItems[index]["id"]),
				projectedID,
			)
		}
		nextItems[index] = merged
	}

	return nextItems
}

func mergeProjectedItemsPreserveOverlayOrder(base []map[string]any, overlay []map[string]any) []map[string]any {
	if len(overlay) == 0 {
		return cloneItems(base)
	}

	result := make([]map[string]any, 0, len(base)+len(overlay))
	usedBase := make([]bool, len(base))

	for _, projectedItem := range overlay {
		projectedID := stringValue(projectedItem["id"])
		index := -1
		semanticMatch := false

		if projectedID != "" {
			for itemIndex, item := range base {
				if usedBase[itemIndex] {
					continue
				}
				if stringValue(item["id"]) == projectedID {
					index = itemIndex
					break
				}
			}
		}

		if index < 0 {
			index = findEquivalentProjectedItemIndexSkippingUsed(base, usedBase, projectedItem)
			semanticMatch = index >= 0
		}

		if index < 0 {
			result = append(result, cloneItem(projectedItem))
			continue
		}

		usedBase[index] = true
		merged := mergeProjectedItem(base[index], projectedItem)
		if semanticMatch {
			merged["id"] = chooseCanonicalProjectedItemID(
				stringValue(base[index]["id"]),
				projectedID,
			)
		}
		result = append(result, merged)
	}

	for index, item := range base {
		if usedBase[index] {
			continue
		}
		result = append(result, cloneItem(item))
	}

	return result
}

func findEquivalentProjectedItemIndex(items []map[string]any, candidate map[string]any) int {
	candidateType := stringValue(candidate["type"])
	if candidateType == "" {
		return -1
	}

	candidateText := projectedItemSemanticText(candidate)
	matchingTypeIndices := make([]int, 0, len(items))

	for index, item := range items {
		if stringValue(item["type"]) != candidateType {
			continue
		}

		matchingTypeIndices = append(matchingTypeIndices, index)
		if candidateText != "" && projectedItemSemanticText(item) == candidateText {
			return index
		}
	}

	switch candidateType {
	case "userMessage", "agentMessage", "reasoning":
		if len(matchingTypeIndices) == 1 {
			return matchingTypeIndices[0]
		}
	}

	return -1
}

func findEquivalentProjectedItemIndexSkippingUsed(items []map[string]any, used []bool, candidate map[string]any) int {
	candidateType := stringValue(candidate["type"])
	if candidateType == "" {
		return -1
	}

	candidateText := projectedItemSemanticText(candidate)
	matchingTypeIndices := make([]int, 0, len(items))

	for index, item := range items {
		if index < len(used) && used[index] {
			continue
		}
		if stringValue(item["type"]) != candidateType {
			continue
		}

		matchingTypeIndices = append(matchingTypeIndices, index)
		if candidateText != "" && projectedItemSemanticText(item) == candidateText {
			return index
		}
	}

	switch candidateType {
	case "userMessage", "agentMessage", "reasoning":
		if len(matchingTypeIndices) == 1 {
			return matchingTypeIndices[0]
		}
	}

	return -1
}

func projectedItemSemanticText(item map[string]any) string {
	switch stringValue(item["type"]) {
	case "userMessage":
		return normalizeProjectedItemText(userMessageContentText(item))
	case "agentMessage", "plan":
		return normalizeProjectedItemText(stringValue(item["text"]))
	case "reasoning":
		return normalizeProjectedItemText(
			strings.Join(stringListValue(item["summary"]), "\n") + "\n" + strings.Join(stringListValue(item["content"]), "\n"),
		)
	default:
		return ""
	}
}

func userMessageContentText(item map[string]any) string {
	rawContent, ok := item["content"].([]any)
	if !ok || len(rawContent) == 0 {
		return ""
	}

	lines := make([]string, 0, len(rawContent))
	for _, rawEntry := range rawContent {
		entry, ok := rawEntry.(map[string]any)
		if !ok {
			continue
		}

		text := strings.TrimSpace(stringValue(entry["text"]))
		if text != "" {
			lines = append(lines, text)
		}
	}

	return strings.Join(lines, "\n")
}

func stringListValue(value any) []string {
	rawItems, ok := value.([]any)
	if !ok || len(rawItems) == 0 {
		return nil
	}

	items := make([]string, 0, len(rawItems))
	for _, rawItem := range rawItems {
		text := strings.TrimSpace(stringValue(rawItem))
		if text != "" {
			items = append(items, text)
		}
	}

	return items
}

func normalizeProjectedItemText(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
}

func chooseCanonicalProjectedItemID(baseID string, overlayID string) string {
	if baseID == "" {
		return overlayID
	}
	if overlayID == "" {
		return baseID
	}

	baseTemporary := isTemporaryProjectedItemID(baseID)
	overlayTemporary := isTemporaryProjectedItemID(overlayID)
	switch {
	case baseTemporary && !overlayTemporary:
		return overlayID
	case !baseTemporary && overlayTemporary:
		return baseID
	default:
		return baseID
	}
}

func isTemporaryProjectedItemID(value string) bool {
	if !strings.HasPrefix(value, "item-") {
		return false
	}

	for _, r := range value[len("item-"):] {
		if r < '0' || r > '9' {
			return false
		}
	}

	return len(value) > len("item-")
}

func mergeProjectedItem(base map[string]any, overlay map[string]any) map[string]any {
	next := cloneItem(base)
	for key, value := range overlay {
		next[key] = value
	}

	if stringValue(overlay["type"]) == "agentMessage" && stringValue(overlay["text"]) == "" && stringValue(base["text"]) != "" {
		next["text"] = base["text"]
	}
	if stringValue(overlay["type"]) == "plan" && stringValue(overlay["text"]) == "" && stringValue(base["text"]) != "" {
		next["text"] = base["text"]
	}
	if stringValue(overlay["type"]) == "commandExecution" &&
		stringValue(overlay["aggregatedOutput"]) == "" &&
		stringValue(base["aggregatedOutput"]) != "" {
		next["aggregatedOutput"] = base["aggregatedOutput"]
	}

	return next
}

func reconcileServerRequestStatuses(
	turns []store.ThreadTurn,
	runtimes *runtime.Manager,
) []store.ThreadTurn {
	if len(turns) == 0 {
		return turns
	}

	nextTurns := append([]store.ThreadTurn{}, turns...)
	for turnIndex, turn := range nextTurns {
		nextItems := cloneItems(turn.Items)
		changed := false

		for itemIndex, item := range nextItems {
			if stringValue(item["type"]) != "serverRequest" {
				continue
			}
			if stringValue(item["status"]) != "pending" {
				continue
			}

			requestID := stringValue(item["requestId"])
			if requestID == "" {
				continue
			}
			if _, ok := runtimes.GetPendingRequest(requestID); ok {
				continue
			}

			nextItems[itemIndex]["status"] = "expired"
			if stringValue(nextItems[itemIndex]["expireReason"]) == "" {
				nextItems[itemIndex]["expireReason"] = "request_unavailable"
			}
			changed = true
		}

		if changed {
			nextTurns[turnIndex].Items = nextItems
		}
	}

	return nextTurns
}

func cloneThreadTurn(turn store.ThreadTurn) store.ThreadTurn {
	return store.ThreadTurn{
		ID:     turn.ID,
		Status: turn.Status,
		Items:  cloneItems(turn.Items),
		Error:  turn.Error,
	}
}

func findThreadTurnByID(turns []store.ThreadTurn, turnID string) (store.ThreadTurn, bool) {
	for _, turn := range turns {
		if turn.ID == turnID {
			return turn, true
		}
	}

	return store.ThreadTurn{}, false
}

func findThreadTurnItemByID(items []map[string]any, itemID string) (map[string]any, bool) {
	for _, item := range items {
		if stringValue(item["id"]) == itemID {
			return item, true
		}
	}

	return nil, false
}

func cloneItems(items []map[string]any) []map[string]any {
	if len(items) == 0 {
		return []map[string]any{}
	}

	cloned := make([]map[string]any, 0, len(items))
	for _, item := range items {
		cloned = append(cloned, cloneItem(item))
	}
	return cloned
}

func cloneItem(item map[string]any) map[string]any {
	if item == nil {
		return map[string]any{}
	}

	cloned := make(map[string]any, len(item))
	for key, value := range item {
		cloned[key] = value
	}
	return cloned
}

func normalizeThreadContentMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case threadContentModeSummary:
		return threadContentModeSummary
	default:
		return threadContentModeFull
	}
}

func normalizeThreadOutputContentMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case threadContentModeSummary:
		return threadContentModeSummary
	case threadOutputModeTail:
		return threadOutputModeTail
	default:
		return threadContentModeFull
	}
}

func normalizeThreadOutputTailLines(value int) int {
	if value <= 0 {
		return threadExpandedCommandOutputTailLineLimit
	}

	return value
}

func normalizeThreadListPageLimit(value int) int {
	switch {
	case value <= 0:
		return threadListPageDefaultLimit
	case value > threadListPageMaxLimit:
		return threadListPageMaxLimit
	default:
		return value
	}
}

func normalizeThreadListSortKey(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", threadSortKeyCreatedAt:
		return threadSortKeyCreatedAt
	case threadSortKeyUpdatedAt:
		return threadSortKeyUpdatedAt
	default:
		return ""
	}
}

func normalizeThreadOutputBeforeLine(value int, totalLines int) int {
	if totalLines <= 0 {
		return 0
	}

	if value <= 0 || value > totalLines {
		return totalLines
	}

	return value
}

func buildTailThreadTurnItemOutput(
	result ThreadTurnItemOutput,
	fullOutput string,
	tailLines int,
	beforeLine int,
) ThreadTurnItemOutput {
	lineRanges := buildOutputLineRanges(fullOutput)
	totalLines := len(lineRanges)
	if totalLines == 0 {
		result.OutputContentMode = threadContentModeFull
		return result
	}

	endLine := beforeLine
	if endLine <= 0 || endLine > totalLines {
		endLine = totalLines
	}
	startLine := endLine - tailLines
	if startLine < 0 {
		startLine = 0
	}

	startOffset := lineRanges[startLine].start
	endOffset := lineRanges[endLine-1].end

	result.OutputStartLine = startLine
	result.OutputEndLine = endLine
	result.OutputStartOffset = startOffset
	result.OutputEndOffset = endOffset
	result.AggregatedOutput = fullOutput[startOffset:endOffset]
	if startLine == 0 && endLine == totalLines {
		result.OutputContentMode = threadContentModeFull
		return result
	}

	result.OutputContentMode = threadOutputModeTail
	result.OutputTruncated = true
	return result
}

func buildTailThreadTurnItemOutputFromStoredWindow(
	result ThreadTurnItemOutput,
	storedOutput string,
	tailLines int,
	beforeLine int,
) ThreadTurnItemOutput {
	lineRanges := buildOutputLineRanges(storedOutput)
	if len(lineRanges) == 0 {
		return result
	}

	storedStartLine := result.OutputStartLine
	storedEndLine := result.OutputEndLine
	if storedEndLine <= storedStartLine {
		storedEndLine = storedStartLine + len(lineRanges)
	}

	if beforeLine <= storedStartLine {
		return result
	}
	if beforeLine > storedEndLine {
		beforeLine = storedEndLine
	}

	startLine := beforeLine - tailLines
	if startLine < storedStartLine {
		startLine = storedStartLine
	}
	if startLine >= beforeLine {
		startLine = beforeLine - 1
		if startLine < storedStartLine {
			startLine = storedStartLine
		}
	}

	relativeStartLine := startLine - storedStartLine
	if relativeStartLine < 0 {
		relativeStartLine = 0
	}
	relativeEndLine := beforeLine - storedStartLine
	if relativeEndLine > len(lineRanges) {
		relativeEndLine = len(lineRanges)
	}
	if relativeEndLine <= 0 {
		relativeEndLine = len(lineRanges)
	}

	startOffset := result.OutputStartOffset + lineRanges[relativeStartLine].start
	endOffset := result.OutputStartOffset + lineRanges[relativeEndLine-1].end
	result.OutputStartLine = startLine
	result.OutputEndLine = beforeLine
	result.OutputStartOffset = startOffset
	result.OutputEndOffset = endOffset
	result.AggregatedOutput = storedOutput[lineRanges[relativeStartLine].start:lineRanges[relativeEndLine-1].end]
	result.OutputContentMode = threadOutputModeTail
	result.OutputTruncated = true
	if result.OutputStartLine == 0 &&
		result.OutputLineCount > 0 &&
		result.OutputEndLine == result.OutputLineCount &&
		result.OutputTotalLength == len(result.AggregatedOutput) {
		result.OutputContentMode = threadContentModeFull
		result.OutputTruncated = false
	}
	return result
}

func buildThreadTurnItemOutputFromItem(itemID string, item map[string]any) ThreadTurnItemOutput {
	output := stringValue(item["aggregatedOutput"])
	outputLineCount := countOutputLines(output)
	outputTotalLength := len(output)
	outputStartOffset := 0
	outputEndOffset := trimOutputLineBreakSuffix(output)
	outputStartLine := 0
	outputEndLine := outputLineCount
	outputContentMode := threadContentModeFull
	outputTruncated := false

	if totalLength := int(int64Value(item["outputTotalLength"])); totalLength > outputTotalLength {
		outputTotalLength = totalLength
		outputTruncated = true
		outputContentMode = threadOutputModeTail
	}
	if boolValue(item["outputTruncated"]) {
		outputTruncated = true
	}
	if contentMode := stringValue(item["outputContentMode"]); contentMode != "" {
		outputContentMode = contentMode
	}
	if startOffset := int(int64Value(item["outputStartOffset"])); startOffset >= 0 {
		outputStartOffset = startOffset
	}
	if endOffset := int(int64Value(item["outputEndOffset"])); endOffset > outputStartOffset {
		outputEndOffset = endOffset
	}
	if totalLines := int(int64Value(item["outputLineCount"])); totalLines > outputLineCount {
		outputLineCount = totalLines
	}
	if startLine := int(int64Value(item["outputStartLine"])); startLine >= 0 {
		outputStartLine = startLine
	}
	if endLine := int(int64Value(item["outputEndLine"])); endLine > outputStartLine {
		outputEndLine = endLine
	}
	if outputEndOffset < outputStartOffset {
		outputEndOffset = outputStartOffset
	}
	if outputEndLine < outputStartLine {
		outputEndLine = outputStartLine
	}

	return ThreadTurnItemOutput{
		ItemID:            itemID,
		Command:           stringValue(item["command"]),
		AggregatedOutput:  output,
		OutputLineCount:   outputLineCount,
		OutputContentMode: outputContentMode,
		OutputStartLine:   outputStartLine,
		OutputEndLine:     outputEndLine,
		OutputStartOffset: outputStartOffset,
		OutputEndOffset:   outputEndOffset,
		OutputTotalLength: outputTotalLength,
		OutputTruncated:   outputTruncated,
	}
}

type outputLineRange struct {
	start int
	end   int
}

func buildOutputLineRanges(value string) []outputLineRange {
	displayEnd := trimOutputLineBreakSuffix(value)
	if displayEnd <= 0 {
		return nil
	}

	ranges := make([]outputLineRange, 0, strings.Count(value[:displayEnd], "\n")+1)
	lineStart := 0
	for index := 0; index < displayEnd; index += 1 {
		if value[index] != '\n' {
			continue
		}

		ranges = append(ranges, outputLineRange{
			start: lineStart,
			end:   index + 1,
		})
		lineStart = index + 1
	}

	if lineStart < displayEnd {
		ranges = append(ranges, outputLineRange{
			start: lineStart,
			end:   displayEnd,
		})
	}

	return ranges
}

func trimOutputLineBreakSuffix(value string) int {
	end := len(value)
	for end > 0 {
		switch value[end-1] {
		case '\n', '\r':
			end -= 1
		default:
			return end
		}
	}

	return end
}

func summarizeThreadDetailContent(detail store.ThreadDetail) store.ThreadDetail {
	next := detail
	next.Preview, _ = truncateSummaryString(detail.Preview, threadSummaryPreviewLimit)
	next.Turns = summarizeThreadTurns(detail.Turns)
	return next
}

func summarizeThreadTurns(turns []store.ThreadTurn) []store.ThreadTurn {
	if len(turns) == 0 {
		return []store.ThreadTurn{}
	}

	nextTurns := cloneThreadTurnsLocal(turns)
	for turnIndex := range nextTurns {
		nextTurns[turnIndex] = summarizeThreadTurn(nextTurns[turnIndex])
	}

	return nextTurns
}

func summarizeThreadTurn(turn store.ThreadTurn) store.ThreadTurn {
	nextTurn := cloneThreadTurn(turn)
	for itemIndex := range nextTurn.Items {
		nextTurn.Items[itemIndex] = summarizeThreadItem(nextTurn.Items[itemIndex])
	}

	return nextTurn
}

func summarizeThreadItem(item map[string]any) map[string]any {
	if item == nil {
		return map[string]any{}
	}

	next := cloneItem(item)
	summaryTruncated := false

	switch stringValue(next["type"]) {
	case "userMessage":
		if content, truncated := summarizeUserMessageContent(next["content"]); truncated {
			next["content"] = content
			summaryTruncated = true
		}
	case "agentMessage":
		if text, truncated := truncateSummaryString(
			stringValue(next["text"]),
			threadSummaryMessageTextLimit,
		); truncated {
			next["text"] = text
			summaryTruncated = true
		}
	case "commandExecution":
		output := stringValue(next["aggregatedOutput"])
		if outputPreview, truncated := truncateMiddleSummaryString(
			output,
			threadSummaryCommandOutputPreviewLimit,
		); truncated {
			next["aggregatedOutput"] = outputPreview
			if outputLineCount := countOutputLines(output); outputLineCount > 0 {
				existingOutputLineCount := int(int64Value(next["outputLineCount"]))
				if existingOutputLineCount > outputLineCount {
					outputLineCount = existingOutputLineCount
				}
				next["outputLineCount"] = outputLineCount
			}
			summaryTruncated = true
		}
		if command, truncated := truncateSummaryString(
			stringValue(next["command"]),
			threadSummaryCommandLimit,
		); truncated {
			next["command"] = command
			summaryTruncated = true
		}
	case "reasoning":
		if summary, truncated := summarizeStringSlice(next["summary"]); truncated {
			next["summary"] = summary
			summaryTruncated = true
		}
		if content, truncated := summarizeStringSlice(next["content"]); truncated {
			next["content"] = content
			summaryTruncated = true
		}
	case "plan":
		if text, truncated := truncateSummaryString(
			stringValue(next["text"]),
			threadSummaryPlanTextLimit,
		); truncated {
			next["text"] = text
			summaryTruncated = true
		}
	case "turnPlan":
		if explanation, truncated := truncateSummaryString(
			stringValue(next["explanation"]),
			threadSummaryPlanTextLimit,
		); truncated {
			next["explanation"] = explanation
			summaryTruncated = true
		}
		if steps, truncated := summarizeTurnPlanSteps(next["steps"]); truncated {
			next["steps"] = steps
			summaryTruncated = true
		}
	case "serverRequest":
		var truncated bool
		next["details"], truncated = summarizeNestedValue(next["details"])
		summaryTruncated = summaryTruncated || truncated
		next["error"], truncated = summarizeNestedValue(next["error"])
		summaryTruncated = summaryTruncated || truncated
	case "mcpToolCall", "dynamicToolCall", "collabAgentToolCall":
		for _, key := range []string{"arguments", "result", "contentItems", "agentsStates", "error"} {
			value, truncated := summarizeNestedValue(next[key])
			next[key] = value
			summaryTruncated = summaryTruncated || truncated
		}
	default:
		for _, key := range []string{"error", "message"} {
			value, truncated := summarizeNestedValue(next[key])
			next[key] = value
			summaryTruncated = summaryTruncated || truncated
		}
	}

	if summaryTruncated {
		next["summaryTruncated"] = true
	}

	return next
}

func summarizeStringSlice(value any) ([]any, bool) {
	rawItems, ok := value.([]any)
	if !ok || len(rawItems) == 0 {
		return rawItems, false
	}

	nextItems := make([]any, len(rawItems))
	truncated := false
	for index, rawItem := range rawItems {
		text, didTruncate := truncateSummaryString(stringValue(rawItem), threadSummaryNestedStringLimit)
		nextItems[index] = text
		truncated = truncated || didTruncate
	}

	return nextItems, truncated
}

func summarizeTurnPlanSteps(value any) ([]any, bool) {
	rawItems := make([]map[string]any, 0)
	switch typed := value.(type) {
	case []any:
		for _, rawItem := range typed {
			entry, ok := rawItem.(map[string]any)
			if !ok {
				continue
			}
			rawItems = append(rawItems, entry)
		}
	case []map[string]any:
		rawItems = append(rawItems, typed...)
	default:
		return nil, false
	}
	if len(rawItems) == 0 {
		return []any{}, false
	}

	nextItems := make([]any, len(rawItems))
	truncated := false
	for index, entry := range rawItems {
		nextEntry := cloneItem(entry)
		if text, didTruncate := truncateSummaryString(
			stringValue(nextEntry["step"]),
			threadSummaryNestedStringLimit,
		); didTruncate {
			nextEntry["step"] = text
			truncated = true
		}
		nextItems[index] = nextEntry
	}

	return nextItems, truncated
}

func summarizeUserMessageContent(value any) ([]any, bool) {
	rawItems, ok := value.([]any)
	if !ok || len(rawItems) == 0 {
		return rawItems, false
	}

	nextItems := make([]any, len(rawItems))
	truncated := false
	for index, rawItem := range rawItems {
		entry, ok := rawItem.(map[string]any)
		if !ok {
			nextItems[index] = rawItem
			continue
		}

		nextEntry := cloneItem(entry)
		if text, didTruncate := truncateSummaryString(
			stringValue(nextEntry["text"]),
			threadSummaryMessageTextLimit,
		); didTruncate {
			nextEntry["text"] = text
			truncated = true
		}
		nextItems[index] = nextEntry
	}

	return nextItems, truncated
}

func summarizeNestedValue(value any) (any, bool) {
	switch typed := value.(type) {
	case string:
		return truncateSummaryString(typed, threadSummaryNestedStringLimit)
	case []any:
		nextItems := make([]any, len(typed))
		truncated := false
		for index, item := range typed {
			nextItems[index], truncated = summarizeNestedValueTracked(item, truncated)
		}
		return nextItems, truncated
	case map[string]any:
		next := make(map[string]any, len(typed))
		truncated := false
		for key, item := range typed {
			next[key], truncated = summarizeNestedValueTracked(item, truncated)
		}
		return next, truncated
	default:
		return value, false
	}
}

func summarizeNestedValueTracked(value any, truncated bool) (any, bool) {
	nextValue, didTruncate := summarizeNestedValue(value)
	return nextValue, truncated || didTruncate
}

func truncateSummaryString(value string, maxLen int) (string, bool) {
	if len(value) <= maxLen || maxLen <= 0 {
		return value, false
	}

	return value[:maxLen] + "…", true
}

func truncateMiddleSummaryString(value string, maxLen int) (string, bool) {
	if len(value) <= maxLen || maxLen <= 0 {
		return value, false
	}

	if maxLen < 80 {
		return value[:maxLen] + "…", true
	}

	headLen := maxLen / 2
	tailLen := maxLen - headLen
	return value[:headLen] + "\n…\n" + value[len(value)-tailLen:], true
}

func countOutputLines(value string) int {
	normalized := strings.ReplaceAll(value, "\r\n", "\n")
	trimmed := strings.TrimRightFunc(normalized, unicode.IsSpace)
	if trimmed == "" {
		return 0
	}

	return strings.Count(trimmed, "\n") + 1
}

func mapThread(workspaceID string, raw map[string]any, archived bool) store.Thread {
	return store.Thread{
		ID:                 stringValue(raw["id"]),
		WorkspaceID:        workspaceID,
		Cwd:                stringValue(raw["cwd"]),
		Materialized:       threadIsMaterialized(raw),
		Name:               threadDisplayName(raw),
		Status:             nestedType(raw["status"]),
		Archived:           archived,
		SessionStartSource: normalizeThreadSessionStartSource(stringValue(raw["sessionStartSource"])),
		TurnCount:          int(int64Value(raw["turnCount"])),
		MessageCount:       int(int64Value(raw["messageCount"])),
		CreatedAt:          unixSeconds(raw["createdAt"]),
		UpdatedAt:          unixSeconds(raw["updatedAt"]),
	}
}

func (s *Service) enrichThreadListCounts(workspaceID string, items []store.Thread) []store.Thread {
	if len(items) == 0 {
		return items
	}

	nextItems := append([]store.Thread{}, items...)
	for index := range nextItems {
		projection, ok := s.store.GetThreadProjectionSummary(workspaceID, nextItems[index].ID)
		if !ok || !projection.SnapshotComplete {
			continue
		}

		nextItems[index].TurnCount = projection.TurnCount
		nextItems[index].MessageCount = projection.MessageCount

		if nextItems[index].TurnCount == 0 && len(projection.Turns) > 0 {
			nextItems[index].TurnCount = len(projection.Turns)
		}
		if nextItems[index].MessageCount == 0 && len(projection.Turns) > 0 {
			nextItems[index].MessageCount = countThreadMessages(projection.Turns)
		}
	}

	return nextItems
}

func countThreadMessages(turns []store.ThreadTurn) int {
	count := 0
	for _, turn := range turns {
		for _, item := range turn.Items {
			switch stringValue(item["type"]) {
			case "userMessage", "agentMessage":
				count += 1
			}
		}
	}

	return count
}

func threadDisplayName(raw map[string]any) string {
	if name := strings.TrimSpace(stringValue(raw["name"])); name != "" {
		return name
	}

	preview := strings.TrimSpace(stringValue(raw["preview"]))
	if preview == "" {
		return "Untitled Thread"
	}

	preview = strings.ReplaceAll(preview, "\r\n", "\n")
	preview = strings.ReplaceAll(preview, "\r", "\n")

	firstLine := preview
	if newline := strings.Index(firstLine, "\n"); newline >= 0 {
		firstLine = firstLine[:newline]
	}

	firstLine = strings.TrimSpace(firstLine)
	if firstLine == "" {
		return "Untitled Thread"
	}

	const maxRunes = 80
	runes := []rune(firstLine)
	if len(runes) <= maxRunes {
		return firstLine
	}

	return strings.TrimSpace(string(runes[:maxRunes])) + "..."
}

func isArchived(raw map[string]any) bool {
	if archived, ok := raw["archived"].(bool); ok {
		return archived
	}

	return false
}

func nestedType(value any) string {
	object, ok := value.(map[string]any)
	if !ok {
		return "idle"
	}

	status := stringValue(object["type"])
	if status == "" {
		return "idle"
	}

	return status
}

func unixSeconds(value any) time.Time {
	switch typed := value.(type) {
	case float64:
		return time.Unix(int64(typed), 0).UTC()
	case int64:
		return time.Unix(typed, 0).UTC()
	case int:
		return time.Unix(int64(typed), 0).UTC()
	default:
		return time.Time{}
	}
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

func int64Value(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	default:
		return 0
	}
}

func boolValue(value any) bool {
	typed, ok := value.(bool)
	return ok && typed
}

func fallbackString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}

	return value
}

func threadBelongsToWorkspace(raw map[string]any, workspaceRoot string) bool {
	threadCwd := normalizePath(stringValue(raw["cwd"]))
	if workspaceRoot == "" || threadCwd == "" {
		return false
	}

	return threadCwd == workspaceRoot || strings.HasPrefix(threadCwd, workspaceRoot+string(filepath.Separator))
}

func storedThreadBelongsToWorkspace(thread store.Thread, workspaceRoot string) bool {
	threadCwd := normalizePath(thread.Cwd)
	if workspaceRoot == "" || threadCwd == "" {
		return false
	}

	return threadCwd == workspaceRoot || strings.HasPrefix(threadCwd, workspaceRoot+string(filepath.Separator))
}

func normalizePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}

	path = strings.TrimPrefix(path, `\\?\`)
	path = filepath.Clean(path)

	return strings.ToLower(path)
}

func (s *Service) cacheThread(thread store.Thread) {
	if s.store.IsThreadDeleted(thread.WorkspaceID, thread.ID) {
		s.store.RemoveThread(thread.WorkspaceID, thread.ID)
		return
	}

	existing, hasExisting := s.store.GetThread(thread.WorkspaceID, thread.ID)
	if !thread.Materialized {
		if hasExisting {
			if strings.TrimSpace(thread.SessionStartSource) == "" {
				thread.SessionStartSource = existing.SessionStartSource
			}
			s.store.UpsertThread(thread)
			return
		}
		s.store.RemoveThread(thread.WorkspaceID, thread.ID)
		return
	}

	if hasExisting && strings.TrimSpace(thread.SessionStartSource) == "" {
		thread.SessionStartSource = existing.SessionStartSource
	}

	s.store.UpsertThread(thread)
}

func (s *Service) ensureThreadNotDeleted(workspaceID string, threadID string) error {
	if s.store.IsThreadDeleted(workspaceID, threadID) {
		return store.ErrThreadNotFound
	}

	return nil
}

func threadIsMaterialized(raw map[string]any) bool {
	if strings.TrimSpace(stringValue(raw["path"])) != "" {
		return true
	}

	if strings.TrimSpace(stringValue(raw["preview"])) != "" {
		return true
	}

	rawTurns, ok := raw["turns"].([]any)
	return ok && len(rawTurns) > 0
}

func isThreadTurnsUnavailableBeforeFirstUserMessage(err error) bool {
	var rpcErr *bridge.RPCError
	if !errors.As(err, &rpcErr) {
		return false
	}

	if rpcErr.Code != -32600 {
		return false
	}

	message := strings.ToLower(strings.TrimSpace(rpcErr.Message))
	return strings.Contains(message, "not materialized yet") &&
		strings.Contains(message, "before first user message")
}

func isThreadResumeRequired(err error) bool {
	var rpcErr *bridge.RPCError
	if !errors.As(err, &rpcErr) {
		return false
	}

	if rpcErr.Code != -32600 {
		return false
	}

	message := strings.ToLower(strings.TrimSpace(rpcErr.Message))
	return strings.Contains(message, "thread not loaded") ||
		strings.Contains(message, "thread not found")
}
