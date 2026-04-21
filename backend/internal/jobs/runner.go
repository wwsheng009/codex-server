package jobs

import (
	"context"
	"sort"
	"strings"

	"codex-server/backend/internal/store"
)

// Runner is the extensibility abstraction for background jobs.
//
// A runner owns three phases for a specific executor kind:
//   - NormalizeCreateInput: shape/validate user input before persistence
//   - ValidateStoredJob: re-check references for retries and legacy jobs
//   - Execute: perform the actual job run
//
// Existing lightweight executors can still be registered through RegisterExecutor;
// they are automatically adapted into a Runner with no-op normalization hooks.
type Runner interface {
	Definition() ExecutorDefinition
	NormalizeCreateInput(*CreateInput) error
	ValidateStoredJob(store.BackgroundJob) error
	Execute(context.Context, ExecutionRequest) (map[string]any, error)
}

type runnerRegistry struct {
	items map[string]Runner
}

func newRunnerRegistry() *runnerRegistry {
	return &runnerRegistry{
		items: make(map[string]Runner),
	}
}

func (r *runnerRegistry) RegisterRunner(runner Runner) {
	if r == nil || runner == nil {
		return
	}
	definition := runner.Definition()
	kind := strings.TrimSpace(definition.Kind)
	if kind == "" {
		return
	}
	r.items[kind] = runner
}

func (r *runnerRegistry) RegisterExecutor(executor Executor) {
	r.RegisterRunner(wrapExecutorAsRunner(executor))
}

func (r *runnerRegistry) Get(kind string) (Runner, bool) {
	if r == nil {
		return nil, false
	}
	runner, ok := r.items[strings.TrimSpace(kind)]
	return runner, ok
}

func (r *runnerRegistry) ListDefinitions() []ExecutorDefinition {
	if r == nil {
		return nil
	}
	items := make([]ExecutorDefinition, 0, len(r.items))
	for _, runner := range r.items {
		items = append(items, runner.Definition())
	}
	sort.Slice(items, func(i int, j int) bool {
		return items[i].Kind < items[j].Kind
	})
	return items
}

type executorRunnerAdapter struct {
	Executor
}

func wrapExecutorAsRunner(executor Executor) Runner {
	if executor == nil {
		return nil
	}
	if runner, ok := executor.(Runner); ok {
		return runner
	}
	return executorRunnerAdapter{Executor: executor}
}

func (executorRunnerAdapter) NormalizeCreateInput(*CreateInput) error {
	return nil
}

func (executorRunnerAdapter) ValidateStoredJob(store.BackgroundJob) error {
	return nil
}
