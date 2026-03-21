package automations

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
)

var (
	ErrInvalidInput             = errors.New("invalid automation input")
	ErrExecutionUnavailable     = errors.New("automation execution is unavailable")
	ErrAutomationAlreadyRunning = errors.New("automation is already running")
	ErrImmutableTemplate        = errors.New("automation template is immutable")
)

const (
	defaultSchedulePollInterval = 5 * time.Second
	defaultRunPollInterval      = 2 * time.Second
	defaultRunTimeout           = 30 * time.Minute
)

type threadExecutor interface {
	Create(ctx context.Context, workspaceID string, input threads.CreateInput) (store.Thread, error)
	GetDetail(ctx context.Context, workspaceID string, threadID string) (store.ThreadDetail, error)
}

type turnExecutor interface {
	Start(ctx context.Context, workspaceID string, threadID string, input string, options turns.StartOptions) (turns.Result, error)
}

type Service struct {
	store *store.MemoryStore

	threads threadExecutor
	turns   turnExecutor
	events  *events.Hub

	now                  func() time.Time
	schedulePollInterval time.Duration
	runPollInterval      time.Duration
	runTimeout           time.Duration
	location             *time.Location

	mu                    sync.Mutex
	started               bool
	activeRunByAutomation map[string]string
	activeRunByThread     map[string]string
	activeRunByThreadTurn map[string]string
	finalizingRuns        map[string]struct{}
}

type CreateInput struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Prompt      string `json:"prompt"`
	WorkspaceID string `json:"workspaceId"`
	Schedule    string `json:"schedule"`
	Model       string `json:"model"`
	Reasoning   string `json:"reasoning"`
}

type TemplateInput struct {
	Category    string `json:"category"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Prompt      string `json:"prompt"`
}

var builtInTemplates = []store.AutomationTemplate{
	{
		ID:          "status-standup",
		Category:    "Status Reports",
		Title:       "Summarize Yesterday's Git Activity",
		Description: "Generate a concise standup-ready summary of recent code movement and risk.",
		Prompt:      "Summarize yesterday's git activity for standup and highlight any release risk.",
		IsBuiltIn:   true,
	},
	{
		ID:          "status-weekly",
		Category:    "Status Reports",
		Title:       "Weekly PR and Incident Summary",
		Description: "Synthesize recent PRs, incidents, rollouts, and reviews into a weekly update.",
		Prompt:      "Synthesize this week's PRs, incidents, rollouts, and reviews into a weekly update.",
		IsBuiltIn:   true,
	},
	{
		ID:          "release-notes",
		Category:    "Release Prep",
		Title:       "Draft Release Notes",
		Description: "Create release notes from merged PRs and include links where possible.",
		Prompt:      "Draft release notes from merged PRs and include relevant links where available.",
		IsBuiltIn:   true,
	},
	{
		ID:          "release-verify",
		Category:    "Release Prep",
		Title:       "Pre-Tag Verification",
		Description: "Verify changelog, migrations, feature flags, and tests before tagging.",
		Prompt:      "Before tagging, verify changelog, migrations, feature flags, and tests.",
		IsBuiltIn:   true,
	},
	{
		ID:          "repo-maintenance",
		Category:    "Repo Maintenance",
		Title:       "Dependency Drift Check",
		Description: "Scan outdated dependencies and propose safe upgrades with minimal changes.",
		Prompt:      "Scan outdated dependencies and propose safe upgrades with minimal changes.",
		IsBuiltIn:   true,
	},
}

func NewService(
	dataStore *store.MemoryStore,
	threadService threadExecutor,
	turnService turnExecutor,
	eventHub *events.Hub,
) *Service {
	return &Service{
		store:                 dataStore,
		threads:               threadService,
		turns:                 turnService,
		events:                eventHub,
		now:                   func() time.Time { return time.Now().UTC() },
		schedulePollInterval:  defaultSchedulePollInterval,
		runPollInterval:       defaultRunPollInterval,
		runTimeout:            defaultRunTimeout,
		location:              time.Local,
		activeRunByAutomation: make(map[string]string),
		activeRunByThread:     make(map[string]string),
		activeRunByThreadTurn: make(map[string]string),
		finalizingRuns:        make(map[string]struct{}),
	}
}

func (s *Service) Start(ctx context.Context) {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return
	}
	s.started = true
	s.mu.Unlock()

	if s.events != nil {
		eventsCh, cancel := s.events.SubscribeAll()
		go func() {
			defer cancel()
			for {
				select {
				case <-ctx.Done():
					return
				case event, ok := <-eventsCh:
					if !ok {
						return
					}
					s.handleEvent(ctx, event)
				}
			}
		}()
	}

	go s.recoverActiveRuns(ctx)
	go s.schedulerLoop(ctx)
}

func (s *Service) List() []store.Automation {
	items := s.store.ListAutomations()
	for index := range items {
		items[index] = s.hydrate(items[index])
	}

	return items
}

func (s *Service) Get(automationID string) (store.Automation, error) {
	automation, ok := s.store.GetAutomation(automationID)
	if !ok {
		return store.Automation{}, store.ErrAutomationNotFound
	}

	return s.hydrate(automation), nil
}

func (s *Service) ListTemplates() []store.AutomationTemplate {
	items := make([]store.AutomationTemplate, 0, len(builtInTemplates)+len(s.store.ListAutomationTemplates()))
	items = append(items, builtInTemplates...)
	items = append(items, s.store.ListAutomationTemplates()...)
	return items
}

func (s *Service) GetTemplate(templateID string) (store.AutomationTemplate, error) {
	if template, ok := builtInTemplateByID(templateID); ok {
		return template, nil
	}

	template, ok := s.store.GetAutomationTemplate(templateID)
	if !ok {
		return store.AutomationTemplate{}, store.ErrAutomationTemplateNotFound
	}

	return template, nil
}

func (s *Service) CreateTemplate(input TemplateInput) (store.AutomationTemplate, error) {
	template, err := normalizeTemplateInput(input)
	if err != nil {
		return store.AutomationTemplate{}, err
	}

	return s.store.CreateAutomationTemplate(store.AutomationTemplate{
		Category:    template.Category,
		Title:       template.Title,
		Description: template.Description,
		Prompt:      template.Prompt,
		IsBuiltIn:   false,
	})
}

func (s *Service) UpdateTemplate(templateID string, input TemplateInput) (store.AutomationTemplate, error) {
	if _, ok := builtInTemplateByID(templateID); ok {
		return store.AutomationTemplate{}, ErrImmutableTemplate
	}

	template, err := normalizeTemplateInput(input)
	if err != nil {
		return store.AutomationTemplate{}, err
	}

	return s.store.UpdateAutomationTemplate(templateID, func(current store.AutomationTemplate) store.AutomationTemplate {
		current.Category = template.Category
		current.Title = template.Title
		current.Description = template.Description
		current.Prompt = template.Prompt
		return current
	})
}

func (s *Service) DeleteTemplate(templateID string) error {
	if _, ok := builtInTemplateByID(templateID); ok {
		return ErrImmutableTemplate
	}

	return s.store.DeleteAutomationTemplate(templateID)
}

func (s *Service) ListRuns(automationID string) []store.AutomationRun {
	return s.store.ListAutomationRuns(automationID)
}

func (s *Service) GetRun(runID string) (store.AutomationRun, error) {
	run, ok := s.store.GetAutomationRun(runID)
	if !ok {
		return store.AutomationRun{}, store.ErrAutomationRunNotFound
	}

	return run, nil
}

func (s *Service) Create(input CreateInput) (store.Automation, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		return store.Automation{}, fmt.Errorf("%w: automation title is required", ErrInvalidInput)
	}

	prompt := strings.TrimSpace(input.Prompt)
	if prompt == "" {
		return store.Automation{}, fmt.Errorf("%w: automation prompt is required", ErrInvalidInput)
	}

	workspaceID := strings.TrimSpace(input.WorkspaceID)
	if workspaceID == "" {
		return store.Automation{}, fmt.Errorf("%w: automation workspaceId is required", ErrInvalidInput)
	}

	workspace, ok := s.store.GetWorkspace(workspaceID)
	if !ok {
		return store.Automation{}, store.ErrWorkspaceNotFound
	}

	schedule := normalizeSchedule(input.Schedule)
	now := s.now()
	nextRunAt := nextScheduledTime(now, schedule, s.location)

	automation, err := s.store.CreateAutomation(store.Automation{
		Title:         title,
		Description:   strings.TrimSpace(input.Description),
		Prompt:        prompt,
		WorkspaceID:   workspace.ID,
		WorkspaceName: workspace.Name,
		Schedule:      schedule,
		ScheduleLabel: scheduleLabel(schedule),
		Model:         normalizeModel(input.Model),
		Reasoning:     normalizeReasoning(input.Reasoning),
		Status:        "active",
		NextRun:       formatNextRunLabel(nextRunAt, s.location),
		NextRunAt:     nextRunAt,
	})
	if err != nil {
		return store.Automation{}, err
	}

	return s.hydrate(automation), nil
}

func (s *Service) Pause(automationID string) (store.Automation, error) {
	automation, err := s.store.UpdateAutomation(automationID, func(current store.Automation) store.Automation {
		current.Status = "paused"
		current.NextRunAt = nil
		current.NextRun = "Paused"
		return current
	})
	if err != nil {
		return store.Automation{}, err
	}

	return s.hydrate(automation), nil
}

func (s *Service) Resume(automationID string) (store.Automation, error) {
	now := s.now()
	automation, err := s.store.UpdateAutomation(automationID, func(current store.Automation) store.Automation {
		current.Status = "active"
		current.NextRunAt = nextScheduledTime(now, current.Schedule, s.location)
		current.NextRun = formatNextRunLabel(current.NextRunAt, s.location)
		return current
	})
	if err != nil {
		return store.Automation{}, err
	}

	return s.hydrate(automation), nil
}

func (s *Service) Fix(automationID string) (store.Automation, error) {
	now := s.now()
	automation, err := s.store.UpdateAutomation(automationID, func(current store.Automation) store.Automation {
		current.Schedule = normalizeSchedule(current.Schedule)
		current.ScheduleLabel = scheduleLabel(current.Schedule)
		current.Model = normalizeModel(current.Model)
		current.Reasoning = normalizeReasoning(current.Reasoning)
		if current.Status == "active" && current.NextRunAt == nil {
			current.NextRunAt = nextScheduledTime(now, current.Schedule, s.location)
		}
		current.NextRun = formatAutomationNextRun(current.Status, current.NextRunAt, s.location)
		return current
	})
	if err != nil {
		return store.Automation{}, err
	}

	return s.hydrate(automation), nil
}

func (s *Service) Delete(automationID string) error {
	s.clearActiveAutomation(automationID)
	return s.store.DeleteAutomation(automationID)
}

func (s *Service) Trigger(ctx context.Context, automationID string) (store.AutomationRun, error) {
	automation, ok := s.store.GetAutomation(automationID)
	if !ok {
		return store.AutomationRun{}, store.ErrAutomationNotFound
	}

	return s.startRun(ctx, s.hydrate(automation), "manual")
}

func (s *Service) schedulerLoop(ctx context.Context) {
	s.runDueAutomations(ctx)

	ticker := time.NewTicker(s.schedulePollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.runDueAutomations(ctx)
		}
	}
}

func (s *Service) recoverActiveRuns(ctx context.Context) {
	for _, run := range s.store.ListActiveAutomationRuns() {
		s.registerActiveRun(run)
		go s.watchRun(ctx, run.ID)
	}
}

func (s *Service) runDueAutomations(ctx context.Context) {
	now := s.now()
	for _, automation := range s.store.ListAutomations() {
		automation = s.hydrate(automation)
		if automation.Status != "active" || automation.NextRunAt == nil || now.Before(*automation.NextRunAt) {
			continue
		}

		if _, err := s.startRun(ctx, automation, "schedule"); err != nil {
			if errors.Is(err, ErrAutomationAlreadyRunning) {
				s.skipAutomationRun(automation, now)
				continue
			}

			s.failToSchedule(automation, now, err)
		}
	}
}

func (s *Service) startRun(ctx context.Context, automation store.Automation, trigger string) (store.AutomationRun, error) {
	if s.threads == nil || s.turns == nil {
		return store.AutomationRun{}, ErrExecutionUnavailable
	}
	if s.isAutomationRunning(automation.ID) {
		return store.AutomationRun{}, ErrAutomationAlreadyRunning
	}

	run, err := s.store.CreateAutomationRun(store.AutomationRun{
		AutomationID:    automation.ID,
		AutomationTitle: automation.Title,
		WorkspaceID:     automation.WorkspaceID,
		WorkspaceName:   automation.WorkspaceName,
		Trigger:         trigger,
		Status:          "queued",
		StartedAt:       s.now(),
	})
	if err != nil {
		return store.AutomationRun{}, err
	}

	s.appendRunLog(run.ID, "info", "run.queued", "Automation run queued")

	threadID, automation, err := s.ensureThread(ctx, automation)
	if err != nil {
		s.failRun(run.ID, automation, "Failed to prepare automation thread", err)
		return store.AutomationRun{}, err
	}

	run, err = s.store.UpdateAutomationRun(run.ID, func(current store.AutomationRun) store.AutomationRun {
		current.ThreadID = threadID
		return current
	})
	if err != nil {
		return store.AutomationRun{}, err
	}

	result, err := s.turns.Start(ctx, automation.WorkspaceID, threadID, automation.Prompt, turns.StartOptions{
		Model:            automation.Model,
		ReasoningEffort:  automation.Reasoning,
		PermissionPreset: "full-access",
	})
	if err != nil {
		s.failRun(run.ID, automation, "Failed to start automation turn", err)
		return store.AutomationRun{}, err
	}

	run, err = s.store.UpdateAutomationRun(run.ID, func(current store.AutomationRun) store.AutomationRun {
		current.Status = "running"
		current.ThreadID = threadID
		current.TurnID = result.TurnID
		return current
	})
	if err != nil {
		return store.AutomationRun{}, err
	}

	if trigger == "schedule" {
		nextRunAt := nextScheduledTime(s.now(), automation.Schedule, s.location)
		if _, err := s.store.UpdateAutomation(automation.ID, func(current store.Automation) store.Automation {
			current.NextRunAt = nextRunAt
			current.NextRun = formatAutomationNextRun(current.Status, nextRunAt, s.location)
			return current
		}); err == nil {
			automation, _ = s.Get(automation.ID)
		}
	}

	s.registerActiveRun(run)
	s.appendRunLog(run.ID, "info", "thread.ready", "Automation thread ready")
	s.appendRunLog(run.ID, "info", "turn.started", "Automation turn started")
	s.publishAutomationEvent(run.WorkspaceID, run.ThreadID, run.TurnID, "automation/run/started", map[string]any{
		"automationId":    run.AutomationID,
		"automationTitle": run.AutomationTitle,
		"runId":           run.ID,
		"threadId":        run.ThreadID,
		"turnId":          run.TurnID,
		"trigger":         run.Trigger,
		"status":          run.Status,
	})

	go s.watchRun(context.Background(), run.ID)

	return run, nil
}

func (s *Service) watchRun(ctx context.Context, runID string) {
	ticker := time.NewTicker(s.runPollInterval)
	defer ticker.Stop()

	startedAt := s.now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			finalized, err := s.tryFinalizeRun(ctx, runID)
			if finalized {
				return
			}
			if err != nil {
				continue
			}

			if s.now().Sub(startedAt) >= s.runTimeout {
				run, ok := s.store.GetAutomationRun(runID)
				if !ok {
					return
				}
				automation, _ := s.store.GetAutomation(run.AutomationID)
				s.completeRun(runID, s.hydrate(automation), "failed", "", "Automation run timed out")
				return
			}
		}
	}
}

func (s *Service) tryFinalizeRun(ctx context.Context, runID string) (bool, error) {
	run, ok := s.store.GetAutomationRun(runID)
	if !ok {
		return true, nil
	}
	if run.Status != "queued" && run.Status != "running" {
		return true, nil
	}
	if run.ThreadID == "" || run.TurnID == "" {
		return false, nil
	}

	detail, err := s.threads.GetDetail(ctx, run.WorkspaceID, run.ThreadID)
	if err != nil {
		if errors.Is(err, store.ErrThreadNotFound) {
			automation, _ := s.store.GetAutomation(run.AutomationID)
			s.completeRun(run.ID, s.hydrate(automation), "failed", "", "Automation thread was not found")
			return true, nil
		}
		return false, err
	}

	turn, ok := findTurn(detail, run.TurnID)
	if !ok {
		return false, nil
	}
	if !strings.EqualFold(strings.TrimSpace(turn.Status), "completed") {
		return false, nil
	}

	automation, _ := s.store.GetAutomation(run.AutomationID)
	if errMessage := formatTurnError(turn.Error); errMessage != "" {
		s.completeRun(run.ID, s.hydrate(automation), "failed", "", errMessage)
		return true, nil
	}

	summary := summarizeTurn(turn)
	s.completeRun(run.ID, s.hydrate(automation), "completed", summary, "")
	return true, nil
}

func (s *Service) completeRun(
	runID string,
	automation store.Automation,
	status string,
	summary string,
	errorMessage string,
) {
	if !s.beginFinalization(runID) {
		return
	}
	defer s.endFinalization(runID)

	run, ok := s.store.GetAutomationRun(runID)
	if !ok {
		return
	}
	if run.Status != "queued" && run.Status != "running" {
		s.unregisterActiveRun(run)
		return
	}

	now := s.now()
	if status == "completed" {
		s.appendRunLog(runID, "success", "run.completed", "Automation run completed")
		if strings.TrimSpace(summary) != "" {
			s.appendRunLog(runID, "success", "run.summary", summarizeNotificationMessage(summary))
		}
	} else {
		s.appendRunLog(runID, "error", "run.failed", firstNonEmpty(errorMessage, "Automation run failed"))
	}

	updatedRun, err := s.store.UpdateAutomationRun(runID, func(current store.AutomationRun) store.AutomationRun {
		current.Status = status
		current.Summary = strings.TrimSpace(summary)
		current.Error = strings.TrimSpace(errorMessage)
		current.FinishedAt = &now
		return current
	})
	if err != nil {
		return
	}

	s.unregisterActiveRun(updatedRun)

	_, _ = s.store.UpdateAutomation(automation.ID, func(current store.Automation) store.Automation {
		current.LastRun = &now
		current.NextRun = formatAutomationNextRun(current.Status, current.NextRunAt, s.location)
		return current
	})

	notification := s.createNotificationForRun(updatedRun, automation)
	s.publishAutomationEvent(updatedRun.WorkspaceID, updatedRun.ThreadID, updatedRun.TurnID, "automation/run/completed", map[string]any{
		"automationId":    updatedRun.AutomationID,
		"automationTitle": updatedRun.AutomationTitle,
		"runId":           updatedRun.ID,
		"status":          updatedRun.Status,
		"summary":         updatedRun.Summary,
		"error":           updatedRun.Error,
		"notificationId":  notification.ID,
		"finishedAt":      now.Format(time.RFC3339),
	})
}

func (s *Service) failRun(runID string, automation store.Automation, message string, err error) {
	reason := message
	if err != nil {
		reason = fmt.Sprintf("%s: %s", message, err.Error())
	}
	s.completeRun(runID, automation, "failed", "", reason)
}

func (s *Service) failToSchedule(automation store.Automation, now time.Time, err error) {
	nextRunAt := nextScheduledTime(now, automation.Schedule, s.location)
	_, _ = s.store.UpdateAutomation(automation.ID, func(current store.Automation) store.Automation {
		current.NextRunAt = nextRunAt
		current.NextRun = formatAutomationNextRun(current.Status, nextRunAt, s.location)
		return current
	})

	notification, notificationErr := s.store.CreateNotification(store.Notification{
		WorkspaceID:     automation.WorkspaceID,
		WorkspaceName:   automation.WorkspaceName,
		AutomationID:    automation.ID,
		AutomationTitle: automation.Title,
		Kind:            "automation_run_failed",
		Title:           "Automation scheduling failed",
		Message:         fmt.Sprintf("%s: %s", automation.Title, err.Error()),
		Level:           "error",
	})
	if notificationErr == nil {
		s.publishAutomationEvent(automation.WorkspaceID, automation.ThreadID, "", "notification/created", map[string]any{
			"notificationId": notification.ID,
			"kind":           notification.Kind,
			"title":          notification.Title,
			"message":        notification.Message,
			"level":          notification.Level,
		})
	}
}

func (s *Service) skipAutomationRun(automation store.Automation, now time.Time) {
	nextRunAt := nextScheduledTime(now, automation.Schedule, s.location)
	_, _ = s.store.UpdateAutomation(automation.ID, func(current store.Automation) store.Automation {
		current.NextRunAt = nextRunAt
		current.NextRun = formatAutomationNextRun(current.Status, nextRunAt, s.location)
		return current
	})

	notification, err := s.store.CreateNotification(store.Notification{
		WorkspaceID:     automation.WorkspaceID,
		WorkspaceName:   automation.WorkspaceName,
		AutomationID:    automation.ID,
		AutomationTitle: automation.Title,
		Kind:            "automation_run_skipped",
		Title:           "Automation skipped",
		Message:         fmt.Sprintf("%s skipped because a previous run is still active.", automation.Title),
		Level:           "warning",
	})
	if err == nil {
		s.publishAutomationEvent(automation.WorkspaceID, automation.ThreadID, "", "notification/created", map[string]any{
			"notificationId": notification.ID,
			"kind":           notification.Kind,
			"title":          notification.Title,
			"message":        notification.Message,
			"level":          notification.Level,
		})
	}
}

func (s *Service) ensureThread(ctx context.Context, automation store.Automation) (string, store.Automation, error) {
	if automation.ThreadID != "" {
		if _, err := s.threads.GetDetail(ctx, automation.WorkspaceID, automation.ThreadID); err == nil {
			return automation.ThreadID, automation, nil
		}
	}

	thread, err := s.threads.Create(ctx, automation.WorkspaceID, threads.CreateInput{
		Name:  "Automation · " + automation.Title,
		Model: automation.Model,
	})
	if err != nil {
		return "", automation, err
	}

	updatedAutomation, err := s.store.UpdateAutomation(automation.ID, func(current store.Automation) store.Automation {
		current.ThreadID = thread.ID
		return current
	})
	if err != nil {
		return "", automation, err
	}

	return thread.ID, s.hydrate(updatedAutomation), nil
}

func (s *Service) createNotificationForRun(run store.AutomationRun, automation store.Automation) store.Notification {
	kind := "automation_run_completed"
	title := "Automation completed"
	message := fmt.Sprintf("%s completed successfully.", automation.Title)
	level := "success"

	if run.Status != "completed" {
		kind = "automation_run_failed"
		title = "Automation failed"
		message = fmt.Sprintf("%s failed: %s", automation.Title, firstNonEmpty(run.Error, "Unknown error"))
		level = "error"
	} else if strings.TrimSpace(run.Summary) != "" {
		message = fmt.Sprintf("%s: %s", automation.Title, summarizeNotificationMessage(run.Summary))
	}

	notification, err := s.store.CreateNotification(store.Notification{
		WorkspaceID:     run.WorkspaceID,
		WorkspaceName:   run.WorkspaceName,
		AutomationID:    run.AutomationID,
		AutomationTitle: run.AutomationTitle,
		RunID:           run.ID,
		Kind:            kind,
		Title:           title,
		Message:         message,
		Level:           level,
	})
	if err != nil {
		return store.Notification{}
	}

	s.publishAutomationEvent(run.WorkspaceID, run.ThreadID, run.TurnID, "notification/created", map[string]any{
		"notificationId": notification.ID,
		"automationId":   notification.AutomationID,
		"runId":          notification.RunID,
		"kind":           notification.Kind,
		"title":          notification.Title,
		"message":        notification.Message,
		"level":          notification.Level,
		"read":           notification.Read,
	})

	return notification
}

func (s *Service) handleEvent(ctx context.Context, event store.EventEnvelope) {
	runID := s.matchActiveRun(event)
	if runID == "" {
		return
	}

	if entry, ok := buildRunLogEntry(event); ok {
		s.appendRunLog(runID, entry.Level, entry.EventType, entry.Message)
	}

	if event.Method == "turn/completed" {
		go func() {
			_, _ = s.tryFinalizeRun(ctx, runID)
		}()
	}
}

func (s *Service) hydrate(automation store.Automation) store.Automation {
	if workspace, ok := s.store.GetWorkspace(automation.WorkspaceID); ok {
		automation.WorkspaceName = workspace.Name
	}

	if strings.TrimSpace(automation.Schedule) == "" {
		automation.Schedule = "hourly"
	}
	if strings.TrimSpace(automation.ScheduleLabel) == "" {
		automation.ScheduleLabel = scheduleLabel(automation.Schedule)
	}
	if strings.TrimSpace(automation.Model) == "" {
		automation.Model = "gpt-5.4"
	}
	if strings.TrimSpace(automation.Reasoning) == "" {
		automation.Reasoning = "medium"
	}
	if automation.Status == "" {
		automation.Status = "active"
	}
	if automation.Status == "active" && automation.NextRunAt == nil {
		automation.NextRunAt = nextScheduledTime(s.now(), automation.Schedule, s.location)
	}
	automation.NextRun = formatAutomationNextRun(automation.Status, automation.NextRunAt, s.location)

	return automation
}

func (s *Service) appendRunLog(runID string, level string, eventType string, message string) {
	if strings.TrimSpace(message) == "" {
		return
	}

	_, _ = s.store.AppendAutomationRunLog(runID, store.AutomationRunLogEntry{
		TS:        s.now(),
		Level:     level,
		EventType: eventType,
		Message:   message,
	})
}

func (s *Service) publishAutomationEvent(workspaceID string, threadID string, turnID string, method string, payload map[string]any) {
	if s.events == nil {
		return
	}

	event := store.EventEnvelope{
		WorkspaceID: workspaceID,
		ThreadID:    threadID,
		TurnID:      turnID,
		Method:      method,
		Payload:     payload,
		TS:          s.now(),
	}
	s.events.Publish(event)
}

func (s *Service) isAutomationRunning(automationID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, ok := s.activeRunByAutomation[automationID]
	return ok
}

func (s *Service) registerActiveRun(run store.AutomationRun) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.activeRunByAutomation[run.AutomationID] = run.ID
	if run.ThreadID != "" {
		s.activeRunByThread[run.ThreadID] = run.ID
	}
	if run.ThreadID != "" && run.TurnID != "" {
		s.activeRunByThreadTurn[threadTurnKey(run.ThreadID, run.TurnID)] = run.ID
	}
}

func (s *Service) unregisterActiveRun(run store.AutomationRun) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if currentRunID, ok := s.activeRunByAutomation[run.AutomationID]; ok && currentRunID == run.ID {
		delete(s.activeRunByAutomation, run.AutomationID)
	}
	if currentRunID, ok := s.activeRunByThread[run.ThreadID]; ok && currentRunID == run.ID {
		delete(s.activeRunByThread, run.ThreadID)
	}
	if currentRunID, ok := s.activeRunByThreadTurn[threadTurnKey(run.ThreadID, run.TurnID)]; ok && currentRunID == run.ID {
		delete(s.activeRunByThreadTurn, threadTurnKey(run.ThreadID, run.TurnID))
	}
}

func (s *Service) clearActiveAutomation(automationID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.activeRunByAutomation, automationID)
}

func (s *Service) matchActiveRun(event store.EventEnvelope) string {
	s.mu.Lock()
	defer s.mu.Unlock()

	if event.ThreadID != "" && event.TurnID != "" {
		if runID, ok := s.activeRunByThreadTurn[threadTurnKey(event.ThreadID, event.TurnID)]; ok {
			return runID
		}
	}
	if event.ThreadID != "" {
		if runID, ok := s.activeRunByThread[event.ThreadID]; ok {
			return runID
		}
	}
	return ""
}

func (s *Service) beginFinalization(runID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.finalizingRuns[runID]; ok {
		return false
	}
	s.finalizingRuns[runID] = struct{}{}
	return true
}

func (s *Service) endFinalization(runID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.finalizingRuns, runID)
}

func normalizeSchedule(value string) string {
	switch strings.TrimSpace(value) {
	case "", "hourly":
		return "hourly"
	case "daily-0800":
		return "daily-0800"
	case "daily-1800":
		return "daily-1800"
	default:
		return strings.TrimSpace(value)
	}
}

func normalizeModel(value string) string {
	if strings.TrimSpace(value) == "" {
		return "gpt-5.4"
	}

	return strings.TrimSpace(value)
}

func normalizeReasoning(value string) string {
	if strings.TrimSpace(value) == "" {
		return "medium"
	}

	return strings.TrimSpace(value)
}

func normalizeTemplateInput(input TemplateInput) (store.AutomationTemplate, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		return store.AutomationTemplate{}, fmt.Errorf("%w: template title is required", ErrInvalidInput)
	}

	prompt := strings.TrimSpace(input.Prompt)
	if prompt == "" {
		return store.AutomationTemplate{}, fmt.Errorf("%w: template prompt is required", ErrInvalidInput)
	}

	category := strings.TrimSpace(input.Category)
	if category == "" {
		category = "Custom"
	}

	return store.AutomationTemplate{
		Category:    category,
		Title:       title,
		Description: strings.TrimSpace(input.Description),
		Prompt:      prompt,
	}, nil
}

func scheduleLabel(schedule string) string {
	switch schedule {
	case "hourly":
		return "Every hour"
	case "daily-0800":
		return "Daily at 08:00"
	case "daily-1800":
		return "Daily at 18:00"
	default:
		return schedule
	}
}

func nextScheduledTime(now time.Time, schedule string, location *time.Location) *time.Time {
	localNow := now.In(location)

	switch schedule {
	case "daily-0800":
		next := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 8, 0, 0, 0, location)
		if !next.After(localNow) {
			next = next.Add(24 * time.Hour)
		}
		nextUTC := next.UTC()
		return &nextUTC
	case "daily-1800":
		next := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 18, 0, 0, 0, location)
		if !next.After(localNow) {
			next = next.Add(24 * time.Hour)
		}
		nextUTC := next.UTC()
		return &nextUTC
	default:
		next := localNow.Truncate(time.Hour).Add(time.Hour)
		nextUTC := next.UTC()
		return &nextUTC
	}
}

func formatAutomationNextRun(status string, nextRunAt *time.Time, location *time.Location) string {
	if strings.TrimSpace(status) == "paused" {
		return "Paused"
	}

	return formatNextRunLabel(nextRunAt, location)
}

func formatNextRunLabel(nextRunAt *time.Time, location *time.Location) string {
	if nextRunAt == nil {
		return "Scheduled"
	}

	return nextRunAt.In(location).Format("2006-01-02 15:04")
}

func summarizeNotificationMessage(value string) string {
	text := strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
	if text == "" {
		return ""
	}
	if newline := strings.Index(text, "\n"); newline >= 0 {
		text = text[:newline]
	}

	runes := []rune(text)
	if len(runes) <= 140 {
		return text
	}

	return strings.TrimSpace(string(runes[:140])) + "..."
}

func findTurn(detail store.ThreadDetail, turnID string) (store.ThreadTurn, bool) {
	for _, turn := range detail.Turns {
		if turn.ID == turnID {
			return turn, true
		}
	}
	return store.ThreadTurn{}, false
}

func formatTurnError(value any) string {
	if value == nil {
		return ""
	}

	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case map[string]any:
		if message, ok := typed["message"].(string); ok {
			return strings.TrimSpace(message)
		}
		if code, ok := typed["code"].(string); ok && code != "" {
			return strings.TrimSpace(code)
		}
	default:
		return fmt.Sprintf("%v", typed)
	}

	return ""
}

func summarizeTurn(turn store.ThreadTurn) string {
	for itemIndex := len(turn.Items) - 1; itemIndex >= 0; itemIndex-- {
		item := turn.Items[itemIndex]
		if stringValue(item["type"]) != "agentMessage" {
			continue
		}

		text := strings.TrimSpace(stringValue(item["text"]))
		if text != "" {
			return text
		}
	}

	return ""
}

func buildRunLogEntry(event store.EventEnvelope) (store.AutomationRunLogEntry, bool) {
	payload, _ := event.Payload.(map[string]any)

	switch event.Method {
	case "thread/status/changed":
		status, _ := payload["status"].(map[string]any)
		return store.AutomationRunLogEntry{
			TS:        event.TS,
			Level:     "info",
			EventType: event.Method,
			Message:   "Thread status changed to " + stringValue(status["type"]),
		}, true
	case "turn/started":
		return store.AutomationRunLogEntry{TS: event.TS, Level: "info", EventType: event.Method, Message: "Turn started"}, true
	case "turn/completed":
		return store.AutomationRunLogEntry{TS: event.TS, Level: "info", EventType: event.Method, Message: "Turn completed"}, true
	case "item/started":
		item, _ := payload["item"].(map[string]any)
		return store.AutomationRunLogEntry{
			TS:        event.TS,
			Level:     "info",
			EventType: event.Method,
			Message:   "Started " + firstNonEmpty(stringValue(item["type"]), "item"),
		}, true
	case "item/completed":
		item, _ := payload["item"].(map[string]any)
		itemType := firstNonEmpty(stringValue(item["type"]), "item")
		message := "Completed " + itemType
		if itemType == "agentMessage" {
			if text := summarizeNotificationMessage(stringValue(item["text"])); text != "" {
				message = "Assistant response completed: " + text
			} else {
				message = "Assistant response completed"
			}
		}
		if itemType == "commandExecution" {
			if output := summarizeNotificationMessage(stringValue(item["aggregatedOutput"])); output != "" {
				message = "Command output: " + output
			}
		}
		return store.AutomationRunLogEntry{
			TS:        event.TS,
			Level:     "info",
			EventType: event.Method,
			Message:   message,
		}, true
	case "server/request/resolved":
		return store.AutomationRunLogEntry{TS: event.TS, Level: "info", EventType: event.Method, Message: "Server request resolved"}, true
	case "server/request/expired":
		return store.AutomationRunLogEntry{TS: event.TS, Level: "warning", EventType: event.Method, Message: "Server request expired"}, true
	case "item/commandExecution/requestApproval", "execCommandApproval", "item/fileChange/requestApproval", "applyPatchApproval", "item/tool/requestUserInput", "item/permissions/requestApproval", "mcpServer/elicitation/request", "item/tool/call":
		return store.AutomationRunLogEntry{TS: event.TS, Level: "warning", EventType: event.Method, Message: "Run requested approval or user input"}, true
	default:
		return store.AutomationRunLogEntry{}, false
	}
}

func threadTurnKey(threadID string, turnID string) string {
	return threadID + "\x00" + turnID
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}

	return ""
}

func builtInTemplateByID(templateID string) (store.AutomationTemplate, bool) {
	for _, template := range builtInTemplates {
		if template.ID == templateID {
			return template, true
		}
	}

	return store.AutomationTemplate{}, false
}
