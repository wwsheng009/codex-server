package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/scheduleutil"
	"codex-server/backend/internal/store"

	"github.com/robfig/cron/v3"
)

var (
	ErrInvalidInput      = errors.New("invalid background job input")
	ErrExecutorNotFound  = errors.New("background job executor not found")
	ErrJobAlreadyRunning = errors.New("background job is already running")
	ErrJobRunNotActive   = errors.New("background job run is not active")
)

const (
	defaultSchedulerPollInterval = 5 * time.Second
	defaultWorkerCount           = 2
	defaultQueueSize             = 64
)

type CreateInput struct {
	SourceType   string         `json:"sourceType"`
	SourceRefID  string         `json:"sourceRefId"`
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	WorkspaceID  string         `json:"workspaceId"`
	ExecutorKind string         `json:"executorKind"`
	Schedule     string         `json:"schedule"`
	Payload      map[string]any `json:"payload"`
}

type UpdateInput struct {
	SourceType   string         `json:"sourceType"`
	SourceRefID  string         `json:"sourceRefId"`
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	ExecutorKind string         `json:"executorKind"`
	Schedule     string         `json:"schedule"`
	Payload      map[string]any `json:"payload"`
}

type ExecutorDefinition struct {
	Kind             string         `json:"kind"`
	Title            string         `json:"title"`
	Description      string         `json:"description"`
	SupportsSchedule bool           `json:"supportsSchedule"`
	PayloadSchema    map[string]any `json:"payloadSchema,omitempty"`
	ExamplePayload   map[string]any `json:"examplePayload,omitempty"`
}

type ExecutionRequest struct {
	WorkspaceID string
	Job         store.BackgroundJob
	Run         store.BackgroundJobRun
}

type Executor interface {
	Definition() ExecutorDefinition
	Execute(context.Context, ExecutionRequest) (map[string]any, error)
}

type Service struct {
	store    *store.MemoryStore
	events   *events.Hub
	location *time.Location
	now      func() time.Time

	schedulerPollInterval time.Duration
	queue                 chan queuedRun

	mu          sync.Mutex
	started     bool
	runningJobs map[string]string
	runCancels  map[string]context.CancelFunc
	executors   map[string]Executor
}

type queuedRun struct {
	jobID   string
	runID   string
	trigger string
}

func NewService(dataStore *store.MemoryStore, eventHub *events.Hub) *Service {
	service := &Service{
		store:                 dataStore,
		events:                eventHub,
		location:              time.Local,
		now:                   func() time.Time { return time.Now().UTC() },
		schedulerPollInterval: defaultSchedulerPollInterval,
		queue:                 make(chan queuedRun, defaultQueueSize),
		runningJobs:           make(map[string]string),
		runCancels:            make(map[string]context.CancelFunc),
		executors:             make(map[string]Executor),
	}
	service.registerExecutor(noopExecutor{})
	return service
}

func (s *Service) registerExecutor(executor Executor) {
	if s == nil || executor == nil {
		return
	}
	definition := executor.Definition()
	if strings.TrimSpace(definition.Kind) == "" {
		return
	}
	s.executors[definition.Kind] = executor
}

func (s *Service) RegisterExecutor(executor Executor) {
	s.registerExecutor(executor)
}

func (s *Service) Start(ctx context.Context) {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return
	}
	s.started = true
	s.mu.Unlock()

	go s.schedulerLoop(ctx)
	for index := 0; index < defaultWorkerCount; index++ {
		go s.workerLoop(ctx)
	}
	go s.recoverActiveRuns(ctx)
}

func (s *Service) List() []store.BackgroundJob {
	items := s.store.ListBackgroundJobs()
	for index := range items {
		items[index] = s.hydrate(items[index])
	}
	return items
}

func (s *Service) Get(jobID string) (store.BackgroundJob, error) {
	job, ok := s.store.GetBackgroundJob(jobID)
	if !ok {
		return store.BackgroundJob{}, store.ErrBackgroundJobNotFound
	}
	return s.hydrate(job), nil
}

func (s *Service) ListRuns(jobID string) []store.BackgroundJobRun {
	return s.store.ListBackgroundJobRuns(strings.TrimSpace(jobID))
}

func (s *Service) GetRun(runID string) (store.BackgroundJobRun, error) {
	run, ok := s.store.GetBackgroundJobRun(runID)
	if !ok {
		return store.BackgroundJobRun{}, store.ErrBackgroundJobRunNotFound
	}
	return run, nil
}

func (s *Service) ListExecutors() []ExecutorDefinition {
	items := make([]ExecutorDefinition, 0, len(s.executors))
	for _, executor := range s.executors {
		items = append(items, executor.Definition())
	}
	sort.Slice(items, func(i int, j int) bool {
		return items[i].Kind < items[j].Kind
	})
	return items
}

func (s *Service) FindBySource(sourceType string, sourceRefID string) (store.BackgroundJob, bool) {
	normalizedType := strings.TrimSpace(sourceType)
	normalizedRefID := strings.TrimSpace(sourceRefID)
	if normalizedType == "" || normalizedRefID == "" {
		return store.BackgroundJob{}, false
	}
	for _, job := range s.store.ListBackgroundJobs() {
		if strings.EqualFold(strings.TrimSpace(job.SourceType), normalizedType) && strings.TrimSpace(job.SourceRefID) == normalizedRefID {
			return s.hydrate(job), true
		}
	}
	return store.BackgroundJob{}, false
}

func (s *Service) Create(input CreateInput) (store.BackgroundJob, error) {
	normalized, err := s.normalizeCreateInput(input)
	if err != nil {
		return store.BackgroundJob{}, err
	}

	job, err := s.store.CreateBackgroundJob(store.BackgroundJob{
		SourceType:    normalized.SourceType,
		SourceRefID:   normalized.SourceRefID,
		Name:          normalized.Name,
		Description:   normalized.Description,
		WorkspaceID:   normalized.WorkspaceID,
		ExecutorKind:  normalized.ExecutorKind,
		Schedule:      normalized.Schedule,
		ScheduleLabel: scheduleutil.Label(normalized.Schedule),
		Status:        "active",
		Payload:       normalized.Payload,
		NextRunAt:     scheduleutil.NextRunAt(s.now(), normalized.Schedule, s.location),
	})
	if err != nil {
		return store.BackgroundJob{}, err
	}

	return s.hydrate(job), nil
}

func (s *Service) Update(jobID string, input UpdateInput) (store.BackgroundJob, error) {
	current, ok := s.store.GetBackgroundJob(jobID)
	if !ok {
		return store.BackgroundJob{}, store.ErrBackgroundJobNotFound
	}
	if s.isRunning(jobID) {
		return store.BackgroundJob{}, ErrJobAlreadyRunning
	}
	normalized, err := s.normalizeCreateInput(CreateInput{
		SourceType:   input.SourceType,
		SourceRefID:  input.SourceRefID,
		Name:         input.Name,
		Description:  input.Description,
		WorkspaceID:  current.WorkspaceID,
		ExecutorKind: input.ExecutorKind,
		Schedule:     input.Schedule,
		Payload:      input.Payload,
	})
	if err != nil {
		return store.BackgroundJob{}, err
	}

	job, err := s.store.UpdateBackgroundJob(jobID, func(job store.BackgroundJob) store.BackgroundJob {
		job.Name = normalized.Name
		job.SourceType = normalized.SourceType
		job.SourceRefID = normalized.SourceRefID
		job.Description = normalized.Description
		job.ExecutorKind = normalized.ExecutorKind
		job.Schedule = normalized.Schedule
		job.ScheduleLabel = scheduleutil.Label(normalized.Schedule)
		job.Payload = normalized.Payload
		if job.Status == "active" {
			job.NextRunAt = scheduleutil.NextRunAt(s.now(), normalized.Schedule, s.location)
		}
		return job
	})
	if err != nil {
		return store.BackgroundJob{}, err
	}
	s.publishJobEvent(job, "background/job/updated", map[string]any{
		"jobId": job.ID,
	})
	return s.hydrate(job), nil
}

func (s *Service) Pause(jobID string) (store.BackgroundJob, error) {
	job, err := s.store.UpdateBackgroundJob(jobID, func(current store.BackgroundJob) store.BackgroundJob {
		current.Status = "paused"
		current.NextRunAt = nil
		return current
	})
	if err != nil {
		return store.BackgroundJob{}, err
	}

	s.publishJobEvent(job, "background/job/updated", map[string]any{
		"jobId":  job.ID,
		"status": job.Status,
	})
	return s.hydrate(job), nil
}

func (s *Service) Resume(jobID string) (store.BackgroundJob, error) {
	job, err := s.store.UpdateBackgroundJob(jobID, func(current store.BackgroundJob) store.BackgroundJob {
		current.Status = "active"
		current.NextRunAt = scheduleutil.NextRunAt(s.now(), current.Schedule, s.location)
		return current
	})
	if err != nil {
		return store.BackgroundJob{}, err
	}

	s.publishJobEvent(job, "background/job/updated", map[string]any{
		"jobId":     job.ID,
		"status":    job.Status,
		"nextRunAt": formatOptionalTime(job.NextRunAt),
	})
	return s.hydrate(job), nil
}

func (s *Service) Delete(jobID string) error {
	job, ok := s.store.GetBackgroundJob(jobID)
	if !ok {
		return store.ErrBackgroundJobNotFound
	}
	if err := s.store.DeleteBackgroundJob(jobID); err != nil {
		return err
	}
	s.publishJobEvent(job, "background/job/deleted", map[string]any{
		"jobId": job.ID,
	})
	return nil
}

func (s *Service) Trigger(ctx context.Context, jobID string, trigger string) (store.BackgroundJobRun, error) {
	job, ok := s.store.GetBackgroundJob(jobID)
	if !ok {
		return store.BackgroundJobRun{}, store.ErrBackgroundJobNotFound
	}
	job = s.hydrate(job)
	if s.isRunning(job.ID) {
		return store.BackgroundJobRun{}, ErrJobAlreadyRunning
	}

	run, err := s.store.CreateBackgroundJobRun(store.BackgroundJobRun{
		JobID:         job.ID,
		JobName:       job.Name,
		WorkspaceID:   job.WorkspaceID,
		WorkspaceName: job.WorkspaceName,
		ExecutorKind:  job.ExecutorKind,
		Trigger:       firstNonEmpty(strings.TrimSpace(trigger), "manual"),
		Status:        "queued",
		StartedAt:     s.now(),
	})
	if err != nil {
		return store.BackgroundJobRun{}, err
	}

	_, _ = s.store.UpdateBackgroundJob(job.ID, func(current store.BackgroundJob) store.BackgroundJob {
		current.LastRunID = run.ID
		current.LastRunStatus = "queued"
		current.LastError = ""
		if strings.EqualFold(strings.TrimSpace(trigger), "schedule") {
			current.NextRunAt = scheduleutil.NextRunAt(s.now(), current.Schedule, s.location)
		}
		return current
	})
	s.appendRunLog(run.ID, "info", "run.queued", "Background job queued")
	s.publishJobEvent(job, "background/job/run_queued", map[string]any{
		"jobId":   job.ID,
		"runId":   run.ID,
		"trigger": run.Trigger,
		"status":  run.Status,
	})

	select {
	case <-ctx.Done():
		return store.BackgroundJobRun{}, ctx.Err()
	case s.queue <- queuedRun{jobID: job.ID, runID: run.ID, trigger: run.Trigger}:
	}

	return run, nil
}

func (s *Service) RetryRun(ctx context.Context, runID string) (store.BackgroundJobRun, error) {
	run, ok := s.store.GetBackgroundJobRun(runID)
	if !ok {
		return store.BackgroundJobRun{}, store.ErrBackgroundJobRunNotFound
	}
	return s.Trigger(ctx, run.JobID, "retry")
}

func (s *Service) CancelRun(runID string) (store.BackgroundJobRun, error) {
	run, ok := s.store.GetBackgroundJobRun(runID)
	if !ok {
		return store.BackgroundJobRun{}, store.ErrBackgroundJobRunNotFound
	}
	if strings.TrimSpace(run.Status) != "queued" && strings.TrimSpace(run.Status) != "running" {
		return store.BackgroundJobRun{}, ErrJobRunNotActive
	}
	s.cancelRunContext(runID)
	now := s.now()
	run, err := s.store.UpdateBackgroundJobRun(runID, func(current store.BackgroundJobRun) store.BackgroundJobRun {
		current.Status = "canceled"
		current.Error = "Background job canceled"
		current.FinishedAt = &now
		return current
	})
	if err != nil {
		return store.BackgroundJobRun{}, err
	}
	_, _ = s.store.UpdateBackgroundJob(run.JobID, func(current store.BackgroundJob) store.BackgroundJob {
		current.LastRunID = run.ID
		current.LastRunStatus = "canceled"
		current.LastError = "Background job canceled"
		current.LastRunAt = &now
		if current.Status == "active" {
			current.NextRunAt = scheduleutil.NextRunAt(now, current.Schedule, s.location)
		}
		return current
	})
	s.appendRunLog(run.ID, "warning", "run.canceled", "Background job canceled")
	return run, nil
}

func (s *Service) recoverActiveRuns(ctx context.Context) {
	for _, run := range s.store.ListActiveBackgroundJobRuns() {
		if _, ok := s.store.GetBackgroundJob(run.JobID); !ok {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case s.queue <- queuedRun{jobID: run.JobID, runID: run.ID, trigger: "recovered"}:
		}
	}
}

func (s *Service) schedulerLoop(ctx context.Context) {
	s.enqueueDueJobs(ctx)

	ticker := time.NewTicker(s.schedulerPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.enqueueDueJobs(ctx)
		}
	}
}

func (s *Service) enqueueDueJobs(ctx context.Context) {
	now := s.now()
	for _, job := range s.store.ListBackgroundJobs() {
		job = s.hydrate(job)
		if job.Status != "active" || job.NextRunAt == nil || now.Before(*job.NextRunAt) {
			continue
		}
		if _, err := s.Trigger(ctx, job.ID, "schedule"); err != nil && errors.Is(err, ErrJobAlreadyRunning) {
			_, _ = s.store.UpdateBackgroundJob(job.ID, func(current store.BackgroundJob) store.BackgroundJob {
				current.NextRunAt = scheduleutil.NextRunAt(now, current.Schedule, s.location)
				return current
			})
		}
	}
}

func (s *Service) workerLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case queued := <-s.queue:
			s.processRun(ctx, queued)
		}
	}
}

func (s *Service) processRun(ctx context.Context, queued queuedRun) {
	job, ok := s.store.GetBackgroundJob(queued.jobID)
	if !ok {
		return
	}
	run, ok := s.store.GetBackgroundJobRun(queued.runID)
	if !ok {
		return
	}
	if !s.markRunning(job.ID, run.ID) {
		return
	}
	defer s.unmarkRunning(job.ID, run.ID)
	runCtx, cancel := context.WithCancel(ctx)
	s.registerRunCancel(run.ID, cancel)
	defer s.clearRunCancel(run.ID)

	executor, ok := s.executors[job.ExecutorKind]
	if !ok {
		s.failRun(job, run, ErrExecutorNotFound)
		return
	}

	run, _ = s.store.UpdateBackgroundJobRun(run.ID, func(current store.BackgroundJobRun) store.BackgroundJobRun {
		current.Status = "running"
		return current
	})
	_, _ = s.store.UpdateBackgroundJob(job.ID, func(current store.BackgroundJob) store.BackgroundJob {
		current.LastRunID = run.ID
		current.LastRunStatus = "running"
		current.LastError = ""
		current.LastRunAt = ptrTime(run.StartedAt)
		return current
	})
	s.appendRunLog(run.ID, "info", "run.started", "Background job started")
	s.publishJobEvent(job, "background/job/run_started", map[string]any{
		"jobId":  job.ID,
		"runId":  run.ID,
		"status": "running",
	})

	output, err := executor.Execute(runCtx, ExecutionRequest{
		WorkspaceID: job.WorkspaceID,
		Job:         job,
		Run:         run,
	})
	if err != nil {
		s.failRun(job, run, err)
		return
	}

	now := s.now()
	run, _ = s.store.UpdateBackgroundJobRun(run.ID, func(current store.BackgroundJobRun) store.BackgroundJobRun {
		current.Status = "completed"
		current.Output = output
		current.Summary = summarizeOutput(output)
		current.Error = ""
		current.FinishedAt = &now
		return current
	})
	_, _ = s.store.UpdateBackgroundJob(job.ID, func(current store.BackgroundJob) store.BackgroundJob {
		current.LastRunID = run.ID
		current.LastRunStatus = run.Status
		current.LastError = ""
		current.LastRunAt = &now
		if current.Status == "active" {
			current.NextRunAt = scheduleutil.NextRunAt(now, current.Schedule, s.location)
		}
		return current
	})
	s.appendRunLog(run.ID, "success", "run.completed", "Background job completed")
	s.publishJobEvent(job, "background/job/run_completed", map[string]any{
		"jobId":      job.ID,
		"runId":      run.ID,
		"status":     run.Status,
		"summary":    run.Summary,
		"finishedAt": now.Format(time.RFC3339),
	})
}

func (s *Service) failRun(job store.BackgroundJob, run store.BackgroundJobRun, err error) {
	now := s.now()
	message := firstNonEmpty(strings.TrimSpace(errorMessage(err)), "Background job failed")
	run, _ = s.store.UpdateBackgroundJobRun(run.ID, func(current store.BackgroundJobRun) store.BackgroundJobRun {
		current.Status = "failed"
		current.Error = message
		current.FinishedAt = &now
		return current
	})
	_, _ = s.store.UpdateBackgroundJob(job.ID, func(current store.BackgroundJob) store.BackgroundJob {
		current.LastRunID = run.ID
		current.LastRunStatus = "failed"
		current.LastError = message
		current.LastRunAt = &now
		if current.Status == "active" {
			current.NextRunAt = scheduleutil.NextRunAt(now, current.Schedule, s.location)
		}
		return current
	})
	s.appendRunLog(run.ID, "error", "run.failed", message)
	s.publishJobEvent(job, "background/job/run_failed", map[string]any{
		"jobId":      job.ID,
		"runId":      run.ID,
		"status":     run.Status,
		"error":      message,
		"finishedAt": now.Format(time.RFC3339),
	})
}

func (s *Service) appendRunLog(runID string, level string, eventType string, message string) {
	_, _ = s.store.UpdateBackgroundJobRun(runID, func(current store.BackgroundJobRun) store.BackgroundJobRun {
		current.Logs = append(current.Logs, store.BackgroundJobRunLogEntry{
			ID:        store.NewID("joblog"),
			TS:        s.now(),
			Level:     strings.TrimSpace(level),
			Message:   strings.TrimSpace(message),
			EventType: strings.TrimSpace(eventType),
		})
		return current
	})
}

func (s *Service) isRunning(jobID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.runningJobs[jobID]
	return ok
}

func (s *Service) markRunning(jobID string, runID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existingRunID, ok := s.runningJobs[jobID]; ok && existingRunID != runID {
		return false
	}
	s.runningJobs[jobID] = runID
	return true
}

func (s *Service) unmarkRunning(jobID string, runID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if currentRunID, ok := s.runningJobs[jobID]; ok && currentRunID == runID {
		delete(s.runningJobs, jobID)
	}
}

func (s *Service) registerRunCancel(runID string, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.runCancels[runID] = cancel
}

func (s *Service) clearRunCancel(runID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.runCancels, runID)
}

func (s *Service) cancelRunContext(runID string) {
	s.mu.Lock()
	cancel := s.runCancels[runID]
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *Service) hydrate(job store.BackgroundJob) store.BackgroundJob {
	if workspace, ok := s.store.GetWorkspace(job.WorkspaceID); ok {
		job.WorkspaceName = workspace.Name
	}
	job.ScheduleLabel = scheduleutil.Label(job.Schedule)
	return job
}

func (s *Service) normalizeCreateInput(input CreateInput) (CreateInput, error) {
	normalized := CreateInput{
		SourceType:   strings.TrimSpace(input.SourceType),
		SourceRefID:  strings.TrimSpace(input.SourceRefID),
		Name:         strings.TrimSpace(input.Name),
		Description:  strings.TrimSpace(input.Description),
		WorkspaceID:  strings.TrimSpace(input.WorkspaceID),
		ExecutorKind: strings.TrimSpace(input.ExecutorKind),
		Schedule:     scheduleutil.Normalize(input.Schedule),
		Payload:      cloneAnyMap(input.Payload),
	}

	switch {
	case normalized.Name == "":
		return CreateInput{}, ErrInvalidInput
	case normalized.WorkspaceID == "":
		return CreateInput{}, ErrInvalidInput
	case normalized.ExecutorKind == "":
		return CreateInput{}, ErrInvalidInput
	}

	executor, ok := s.executors[normalized.ExecutorKind]
	if !ok {
		return CreateInput{}, ErrExecutorNotFound
	}
	if normalized.Schedule != "" && !executor.Definition().SupportsSchedule {
		return CreateInput{}, ErrInvalidInput
	}
	if normalized.Schedule != "" {
		if _, err := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow).Parse(normalized.Schedule); err != nil {
			return CreateInput{}, ErrInvalidInput
		}
	}
	return normalized, nil
}

func (s *Service) publishJobEvent(job store.BackgroundJob, method string, payload map[string]any) {
	if s.events == nil {
		return
	}
	s.events.Publish(store.EventEnvelope{
		WorkspaceID: job.WorkspaceID,
		Method:      method,
		Payload:     payload,
		TS:          s.now(),
	})
}

type noopExecutor struct{}

func (noopExecutor) Definition() ExecutorDefinition {
	return ExecutorDefinition{
		Kind:             "noop",
		Title:            "No-op",
		Description:      "Validate the background job pipeline without changing workspace data.",
		SupportsSchedule: true,
		ExamplePayload: map[string]any{
			"message": "background job smoke test",
		},
		PayloadSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"message": map[string]any{
					"type":        "string",
					"description": "Optional status text returned by the executor.",
				},
			},
		},
	}
}

func (noopExecutor) Execute(_ context.Context, request ExecutionRequest) (map[string]any, error) {
	message, _ := request.Job.Payload["message"].(string)
	message = firstNonEmpty(strings.TrimSpace(message), "background job completed")
	return map[string]any{
		"ok":        true,
		"message":   message,
		"jobId":     request.Job.ID,
		"workspace": request.WorkspaceID,
	}, nil
}

func summarizeOutput(output map[string]any) string {
	if len(output) == 0 {
		return ""
	}
	for _, key := range []string{"message", "detail", "configSource"} {
		if value := readString(output, key); value != "" {
			return value
		}
	}
	raw, err := json.Marshal(output)
	if err != nil {
		return ""
	}
	text := string(raw)
	if len(text) > 180 {
		return text[:180]
	}
	return text
}

func readString(values map[string]any, key string) string {
	if len(values) == 0 {
		return ""
	}
	value, ok := values[key]
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return ""
	}
}

func readBool(values map[string]any, key string) bool {
	if len(values) == 0 {
		return false
	}
	value, ok := values[key]
	if !ok {
		return false
	}
	typed, ok := value.(bool)
	return ok && typed
}

func readStringSlice(values map[string]any, key string) []string {
	if len(values) == 0 {
		return nil
	}
	value, ok := values[key]
	if !ok {
		return nil
	}
	items, ok := value.([]any)
	if ok {
		result := make([]string, 0, len(items))
		for _, item := range items {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				result = append(result, strings.TrimSpace(text))
			}
		}
		return result
	}
	if items, ok := value.([]string); ok {
		result := make([]string, 0, len(items))
		for _, item := range items {
			if strings.TrimSpace(item) != "" {
				result = append(result, strings.TrimSpace(item))
			}
		}
		return result
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func ptrTime(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	next := value
	return &next
}

func formatOptionalTime(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format(time.RFC3339)
}

func cloneAnyMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return nil
	}
	raw, err := json.Marshal(values)
	if err != nil {
		return map[string]any{}
	}
	var cloned map[string]any
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return map[string]any{}
	}
	return cloned
}

func errorMessage(err error) string {
	if err == nil {
		return ""
	}
	return strings.TrimSpace(err.Error())
}
