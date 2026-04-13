package runtime

import (
	"context"

	"codex-server/backend/internal/appserver"
)

func (m *Manager) ThreadStart(ctx context.Context, workspaceID string, request appserver.ThreadStartRequest) (appserver.ThreadStartResponse, error) {
	var response appserver.ThreadStartResponse
	err := m.Call(ctx, workspaceID, "thread/start", request, &response)
	return response, err
}

func (m *Manager) ThreadList(ctx context.Context, workspaceID string, request appserver.ThreadListRequest) (appserver.ThreadListResponse, error) {
	var response appserver.ThreadListResponse
	err := m.Call(ctx, workspaceID, "thread/list", request, &response)
	return response, err
}

func (m *Manager) ThreadRead(ctx context.Context, workspaceID string, request appserver.ThreadReadRequest) (appserver.ThreadReadResponse, error) {
	var response appserver.ThreadReadResponse
	err := m.Call(ctx, workspaceID, "thread/read", request, &response)
	return response, err
}

func (m *Manager) ThreadLoadedList(ctx context.Context, workspaceID string, request appserver.ThreadLoadedListRequest) (appserver.ThreadLoadedListResponse, error) {
	var response appserver.ThreadLoadedListResponse
	err := m.Call(ctx, workspaceID, "thread/loaded/list", request, &response)
	return response, err
}

func (m *Manager) ThreadMetadataUpdate(ctx context.Context, workspaceID string, request appserver.ThreadMetadataUpdateRequest) (appserver.ThreadMetadataUpdateResponse, error) {
	var response appserver.ThreadMetadataUpdateResponse
	err := m.Call(ctx, workspaceID, "thread/metadata/update", request, &response)
	return response, err
}

func (m *Manager) ThreadCompactStart(ctx context.Context, workspaceID string, request appserver.ThreadCompactStartRequest) error {
	return m.Call(ctx, workspaceID, "thread/compact/start", request, nil)
}

func (m *Manager) ThreadResume(ctx context.Context, workspaceID string, request appserver.ThreadResumeRequest) (appserver.ThreadResumeResponse, error) {
	var response appserver.ThreadResumeResponse
	err := m.Call(ctx, workspaceID, "thread/resume", request, &response)
	return response, err
}

func (m *Manager) ThreadFork(ctx context.Context, workspaceID string, request appserver.ThreadForkRequest) (appserver.ThreadForkResponse, error) {
	var response appserver.ThreadForkResponse
	err := m.Call(ctx, workspaceID, "thread/fork", request, &response)
	return response, err
}

func (m *Manager) ThreadArchive(ctx context.Context, workspaceID string, request appserver.ThreadArchiveRequest) error {
	return m.Call(ctx, workspaceID, "thread/archive", request, nil)
}

func (m *Manager) ThreadUnarchive(ctx context.Context, workspaceID string, request appserver.ThreadUnarchiveRequest) error {
	return m.Call(ctx, workspaceID, "thread/unarchive", request, nil)
}

func (m *Manager) ThreadSetName(ctx context.Context, workspaceID string, request appserver.ThreadSetNameRequest) error {
	return m.Call(ctx, workspaceID, "thread/name/set", request, nil)
}

func (m *Manager) ThreadRollback(ctx context.Context, workspaceID string, request appserver.ThreadRollbackRequest) error {
	return m.Call(ctx, workspaceID, "thread/rollback", request, nil)
}

func (m *Manager) ThreadUnsubscribe(ctx context.Context, workspaceID string, request appserver.ThreadUnsubscribeRequest) (appserver.ThreadUnsubscribeResponse, error) {
	var response appserver.ThreadUnsubscribeResponse
	err := m.Call(ctx, workspaceID, "thread/unsubscribe", request, &response)
	return response, err
}

func (m *Manager) ThreadShellCommand(ctx context.Context, workspaceID string, request appserver.ThreadShellCommandRequest) error {
	return m.Call(ctx, workspaceID, "thread/shellCommand", request, nil)
}

func (m *Manager) TurnStart(ctx context.Context, workspaceID string, request appserver.TurnStartRequest) (appserver.TurnStartResponse, error) {
	var response appserver.TurnStartResponse
	err := m.Call(ctx, workspaceID, "turn/start", request, &response)
	return response, err
}

func (m *Manager) TurnSteer(ctx context.Context, workspaceID string, request appserver.TurnSteerRequest) (appserver.TurnSteerResponse, error) {
	var response appserver.TurnSteerResponse
	err := m.Call(ctx, workspaceID, "turn/steer", request, &response)
	return response, err
}

func (m *Manager) TurnInterrupt(ctx context.Context, workspaceID string, request appserver.TurnInterruptRequest) error {
	return m.Call(ctx, workspaceID, "turn/interrupt", request, nil)
}

func (m *Manager) ReviewStart(ctx context.Context, workspaceID string, request appserver.ReviewStartRequest) (appserver.ReviewStartResponse, error) {
	var response appserver.ReviewStartResponse
	err := m.Call(ctx, workspaceID, "review/start", request, &response)
	return response, err
}

func (m *Manager) CollaborationModeList(ctx context.Context, workspaceID string, request appserver.CollaborationModeListRequest) (appserver.CollaborationModeListResponse, error) {
	var response appserver.CollaborationModeListResponse
	err := m.Call(ctx, workspaceID, "collaborationMode/list", request, &response)
	return response, err
}
