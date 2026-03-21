package automations

import (
	"errors"
	"fmt"
	"strings"

	"codex-server/backend/internal/store"
)

var ErrInvalidInput = errors.New("invalid automation input")

type Service struct {
	store *store.MemoryStore
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

func NewService(dataStore *store.MemoryStore) *Service {
	return &Service{store: dataStore}
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
	model := normalizeModel(input.Model)
	reasoning := normalizeReasoning(input.Reasoning)

	automation, err := s.store.CreateAutomation(store.Automation{
		Title:         title,
		Description:   strings.TrimSpace(input.Description),
		Prompt:        prompt,
		WorkspaceID:   workspace.ID,
		WorkspaceName: workspace.Name,
		Schedule:      schedule,
		ScheduleLabel: scheduleLabel(schedule),
		Model:         model,
		Reasoning:     reasoning,
		Status:        "active",
		NextRun:       nextRunLabel(schedule),
	})
	if err != nil {
		return store.Automation{}, err
	}

	return s.hydrate(automation), nil
}

func (s *Service) Pause(automationID string) (store.Automation, error) {
	return s.changeStatus(automationID, "paused")
}

func (s *Service) Resume(automationID string) (store.Automation, error) {
	return s.changeStatus(automationID, "active")
}

func (s *Service) Fix(automationID string) (store.Automation, error) {
	automation, err := s.store.UpdateAutomation(automationID, func(current store.Automation) store.Automation {
		current.ScheduleLabel = scheduleLabel(current.Schedule)
		current.NextRun = nextRunLabel(current.Schedule)
		return current
	})
	if err != nil {
		return store.Automation{}, err
	}

	return s.hydrate(automation), nil
}

func (s *Service) Delete(automationID string) error {
	return s.store.DeleteAutomation(automationID)
}

func (s *Service) changeStatus(automationID string, status string) (store.Automation, error) {
	automation, err := s.store.UpdateAutomation(automationID, func(current store.Automation) store.Automation {
		current.Status = status
		return current
	})
	if err != nil {
		return store.Automation{}, err
	}

	return s.hydrate(automation), nil
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
	if strings.TrimSpace(automation.NextRun) == "" {
		automation.NextRun = nextRunLabel(automation.Schedule)
	}
	if strings.TrimSpace(automation.Model) == "" {
		automation.Model = "gpt-5.4"
	}
	if strings.TrimSpace(automation.Reasoning) == "" {
		automation.Reasoning = "medium"
	}

	return automation
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

func nextRunLabel(schedule string) string {
	switch schedule {
	case "hourly":
		return "Today at next hour"
	case "daily-0800":
		return "Tomorrow at 08:00"
	case "daily-1800":
		return "Today at 18:00"
	default:
		return "Scheduled"
	}
}
