package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPersistentStoreRoundTrip(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	firstStore.UpsertThread(Thread{
		ID:          "thread-1",
		WorkspaceID: workspace.ID,
		Name:        "Thread A",
		Status:      "idle",
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	workspaces := secondStore.ListWorkspaces()
	if len(workspaces) != 1 {
		t.Fatalf("expected 1 workspace after reload, got %d", len(workspaces))
	}

	threads := secondStore.ListThreads(workspace.ID)
	if len(threads) != 1 {
		t.Fatalf("expected 1 thread after reload, got %d", len(threads))
	}

	if threads[0].Name != "Thread A" {
		t.Fatalf("expected persisted thread name, got %q", threads[0].Name)
	}
}

func TestPersistentStoreSeedsWorkspaceIDs(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	firstWorkspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	if firstWorkspace.ID == "" {
		t.Fatal("expected first workspace id")
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	secondWorkspace := secondStore.CreateWorkspace("Workspace B", "E:/projects/b")
	if secondWorkspace.ID == firstWorkspace.ID {
		t.Fatalf("expected unique workspace id after reload, got duplicate %q", secondWorkspace.ID)
	}
}

func TestPersistentStoreFlushPersistsForReload(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}
	t.Cleanup(func() {
		_ = firstStore.Close()
	})

	workspace := firstStore.CreateWorkspace("Workspace Flush", "E:/projects/flush")
	firstStore.UpsertThread(Thread{
		ID:          "thread-flush",
		WorkspaceID: workspace.ID,
		Name:        "Flush Thread",
		Status:      "idle",
	})

	if err := firstStore.Flush(); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}
	t.Cleanup(func() {
		_ = secondStore.Close()
	})

	threads := secondStore.ListThreads(workspace.ID)
	if len(threads) != 1 {
		t.Fatalf("expected 1 thread after flush+reload, got %d", len(threads))
	}
	if threads[0].Name != "Flush Thread" {
		t.Fatalf("expected flushed thread name, got %q", threads[0].Name)
	}
}

func TestPersistentStoreDebounceDoesNotLoseFinalState(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}
	t.Cleanup(func() {
		_ = firstStore.Close()
	})

	workspace := firstStore.CreateWorkspace("Workspace Debounce", "E:/projects/debounce")
	time.Sleep(persistentStoreFlushDebounce / 5)
	if _, err := os.Stat(storePath); !os.IsNotExist(err) {
		t.Fatalf("expected debounce worker to avoid immediate persist, stat err = %v", err)
	}

	if _, err := firstStore.SetWorkspaceName(workspace.ID, "Workspace Debounce 1"); err != nil {
		t.Fatalf("SetWorkspaceName(1) error = %v", err)
	}
	if _, err := firstStore.SetWorkspaceName(workspace.ID, "Workspace Debounce Final"); err != nil {
		t.Fatalf("SetWorkspaceName(2) error = %v", err)
	}

	if err := firstStore.Flush(); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}
	t.Cleanup(func() {
		_ = secondStore.Close()
	})

	workspaces := secondStore.ListWorkspaces()
	if len(workspaces) != 1 {
		t.Fatalf("expected 1 workspace after debounce flush, got %d", len(workspaces))
	}
	if workspaces[0].Name != "Workspace Debounce Final" {
		t.Fatalf("expected final debounced name to persist, got %q", workspaces[0].Name)
	}
}

func TestPersistentStoreFlushAndCloseAreIdempotent(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace Close", "E:/projects/close")
	firstStore.UpsertThread(Thread{
		ID:          "thread-close",
		WorkspaceID: workspace.ID,
		Name:        "Close Thread",
		Status:      "idle",
	})

	if err := firstStore.Flush(); err != nil {
		t.Fatalf("first Flush() error = %v", err)
	}
	if err := firstStore.Flush(); err != nil {
		t.Fatalf("second Flush() error = %v", err)
	}
	if err := firstStore.Close(); err != nil {
		t.Fatalf("first Close() error = %v", err)
	}
	if err := firstStore.Flush(); err != nil {
		t.Fatalf("Flush() after Close() error = %v", err)
	}
	if err := firstStore.Close(); err != nil {
		t.Fatalf("second Close() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}
	t.Cleanup(func() {
		_ = secondStore.Close()
	})

	threads := secondStore.ListThreads(workspace.ID)
	if len(threads) != 1 {
		t.Fatalf("expected persisted thread after Close(), got %d", len(threads))
	}
	if threads[0].Name != "Close Thread" {
		t.Fatalf("expected closed store to persist thread name, got %q", threads[0].Name)
	}
}

func TestPersistentStorePersistsThreadProjections(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	firstStore.ApplyThreadEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/started",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":        "tool-1",
				"type":      "dynamicToolCall",
				"tool":      "search_query",
				"status":    "inProgress",
				"arguments": map[string]any{"q": "codex"},
			},
		},
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	projection, ok := secondStore.GetThreadProjection(workspace.ID, "thread-1")
	if !ok {
		t.Fatal("expected thread projection to persist after reload")
	}
	if len(projection.Turns) != 1 {
		t.Fatalf("expected 1 projected turn, got %d", len(projection.Turns))
	}
	if len(projection.Turns[0].Items) != 1 {
		t.Fatalf("expected 1 projected item, got %d", len(projection.Turns[0].Items))
	}
	if got := projection.Turns[0].Items[0]["type"]; got != "dynamicToolCall" {
		t.Fatalf("expected projected tool call item, got %#v", got)
	}
}

func TestPersistentStoreCompactsLegacyCommandOutputInThreadProjections(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-compact",
		WorkspaceID: workspace.ID,
		Name:        "Compact Thread",
		Status:      "completed",
	}
	longOutput := strings.Repeat("output line\n", 4_000)
	firstStore.UpsertThread(thread)
	firstStore.UpsertThreadProjectionSnapshot(ThreadDetail{
		Thread: thread,
		Turns: []ThreadTurn{
			{
				ID:     "turn-1",
				Status: "completed",
				Items: []map[string]any{
					{
						"id":               "cmd-1",
						"type":             "commandExecution",
						"command":          "npm test",
						"aggregatedOutput": longOutput,
					},
				},
			},
		},
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	projection, ok := secondStore.GetThreadProjection(workspace.ID, thread.ID)
	if !ok {
		t.Fatal("expected compacted thread projection after reload")
	}
	item := projection.Turns[0].Items[0]
	gotOutput := stringValue(item["aggregatedOutput"])
	if len(gotOutput) >= len(longOutput) {
		t.Fatalf("expected persisted command output to be compacted on reload, got len=%d", len(gotOutput))
	}
	if got := intValue(item["outputTotalLength"]); got != len(longOutput) {
		t.Fatalf("expected persisted total length %d, got %d", len(longOutput), got)
	}
	if got := stringValue(item["outputContentMode"]); got != "tail" {
		t.Fatalf("expected persisted compacted output mode tail, got %q", got)
	}
}

func TestPersistentStoreKeepsReloadedThreadProjectionTurnsCold(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-cold",
		WorkspaceID: workspace.ID,
		Name:        "Cold Thread",
		Status:      "completed",
	}
	firstStore.UpsertThread(thread)
	firstStore.UpsertThreadProjectionSnapshot(ThreadDetail{
		Thread: thread,
		Turns: []ThreadTurn{
			{
				ID:     "turn-1",
				Status: "completed",
				Items: []map[string]any{
					{
						"id":      "msg-1",
						"type":    "agentMessage",
						"text":    "done",
						"status":  "completed",
						"created": true,
					},
				},
			},
		},
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	key := threadProjectionKey(workspace.ID, thread.ID)
	secondStore.mu.RLock()
	record, ok := secondStore.projections[key]
	secondStore.mu.RUnlock()
	if !ok {
		t.Fatal("expected reloaded projection record")
	}
	if record.Projection.Turns != nil {
		t.Fatal("expected reloaded projection turns to stay cold in memory")
	}
	if len(record.TurnsRaw) == 0 && len(record.TurnsCompressed) == 0 {
		t.Fatal("expected reloaded projection to retain cold turns payload")
	}

	projection, ok := secondStore.GetThreadProjection(workspace.ID, thread.ID)
	if !ok {
		t.Fatal("expected thread projection to materialize from cold record")
	}
	if len(projection.Turns) != 1 {
		t.Fatalf("expected 1 turn after materialization, got %d", len(projection.Turns))
	}

	secondStore.mu.RLock()
	record = secondStore.projections[key]
	secondStore.mu.RUnlock()
	if record.Projection.Turns != nil {
		t.Fatal("expected GetThreadProjection to avoid rehydrating turns into resident store state")
	}
}

func TestMemoryStoreWorkspaceEventReplayAndPersistence(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	first := firstStore.AppendWorkspaceEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		Method:      "turn/started",
		Payload:     map[string]any{"status": "started"},
		Replay:      true,
	})
	second := firstStore.AppendWorkspaceEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		Method:      "turn/completed",
		Payload:     map[string]any{"status": "completed"},
	})

	if first.Seq != 1 || second.Seq != 2 {
		t.Fatalf("expected appended seq values [1,2], got [%d,%d]", first.Seq, second.Seq)
	}
	if first.Replay || second.Replay {
		t.Fatalf("expected stored events to clear replay flag, got first=%v second=%v", first.Replay, second.Replay)
	}

	replayed := firstStore.ListWorkspaceEventsAfter(workspace.ID, 1, 10)
	if len(replayed) != 1 {
		t.Fatalf("expected 1 replay event after seq 1, got %d", len(replayed))
	}
	if !replayed[0].Replay || replayed[0].Seq != 2 {
		t.Fatalf("expected replayed event with seq=2 replay=true, got %#v", replayed[0])
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	if head := secondStore.GetWorkspaceEventHeadSeq(workspace.ID); head != 2 {
		t.Fatalf("expected persisted workspace head seq 2, got %d", head)
	}

	reloadedReplay := secondStore.ListWorkspaceEventsAfter(workspace.ID, 0, 10)
	if len(reloadedReplay) != 2 {
		t.Fatalf("expected 2 replay events after reload, got %d", len(reloadedReplay))
	}
	if !reloadedReplay[0].Replay || !reloadedReplay[1].Replay {
		t.Fatalf("expected replay flag on listed events after reload, got %#v", reloadedReplay)
	}
}

func TestTransientBotConnectionRuntimeStateAndLogsStayInMemoryOnly(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	connection, err := firstStore.CreateBotConnection(BotConnection{
		WorkspaceID: workspace.ID,
		Provider:    "wechat",
		Name:        "WeChat Poller",
		Status:      "active",
		AIBackend:   "workspace_thread",
		Settings: map[string]string{
			"wechat_delivery_mode": "polling",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}

	polledAt := time.Date(2026, time.April, 6, 5, 6, 7, 0, time.UTC)
	_, err = firstStore.UpdateBotConnectionRuntimeStateTransient(workspace.ID, connection.ID, func(current BotConnection) BotConnection {
		current.LastPollAt = &polledAt
		current.LastPollStatus = "failed"
		current.LastPollMessage = "Transient polling failure."
		current.LastError = "transient failure"
		return current
	})
	if err != nil {
		t.Fatalf("UpdateBotConnectionRuntimeStateTransient() error = %v", err)
	}

	if _, err := firstStore.AppendBotConnectionLogTransient(workspace.ID, connection.ID, BotConnectionLogEntry{
		Level:     "error",
		EventType: "poll_failed",
		Message:   "Transient polling failure.",
	}); err != nil {
		t.Fatalf("AppendBotConnectionLogTransient() error = %v", err)
	}

	currentConnection, ok := firstStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected in-memory bot connection after transient update")
	}
	if currentConnection.LastPollAt == nil || currentConnection.LastPollStatus != "failed" {
		t.Fatalf("expected transient polling state in-memory, got %#v", currentConnection)
	}

	currentLogs := firstStore.ListBotConnectionLogs(workspace.ID, connection.ID)
	if len(currentLogs) != 1 || currentLogs[0].EventType != "poll_failed" {
		t.Fatalf("expected transient in-memory polling log, got %#v", currentLogs)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	storedConnection, ok := secondStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected bot connection after reload")
	}
	if storedConnection.LastPollAt != nil || storedConnection.LastPollStatus != "" || storedConnection.LastPollMessage != "" || storedConnection.LastError != "" {
		t.Fatalf("expected transient polling state to stay out of persisted store, got %#v", storedConnection)
	}

	logs := secondStore.ListBotConnectionLogs(workspace.ID, connection.ID)
	if len(logs) != 0 {
		t.Fatalf("expected transient polling logs to stay out of persisted store, got %#v", logs)
	}
}

func TestPersistentStoreLoadsOutOfOrderSectionsWithStreamingDecoder(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	payload := `{
  "botConnectionLogs": [
    {
      "id": "bcl_000010",
      "workspaceId": "ws_000001",
      "connectionId": "bcx_000001",
      "ts": "2026-04-08T12:00:00Z",
      "level": "info",
      "eventType": "poll_ok",
      "message": "poll ok"
    }
  ],
  "unknownSection": {
    "nested": [
      1,
      {
        "skip": [
          "x",
          {
            "y": true
          }
        ]
      }
    ]
  },
  "threadProjections": [
    {
      "workspaceId": "ws_000001",
      "threadId": "thread-1",
      "status": "completed",
      "updatedAt": "2026-04-08T12:00:00Z",
      "turnCount": 1,
      "messageCount": 1,
      "snapshotComplete": true,
      "turns": [
        {
          "id": "turn-1",
          "status": "completed",
          "items": [
            {
              "id": "msg-1",
              "type": "agentMessage",
              "text": "done"
            }
          ]
        }
      ]
    }
  ],
  "botConnections": [
    {
      "id": "bcx_000001",
      "workspaceId": "ws_000001",
      "provider": "wechat",
      "name": "WeChat Poller",
      "status": "active",
      "aiBackend": "workspace_thread",
      "createdAt": "2026-04-08T12:00:00Z",
      "updatedAt": "2026-04-08T12:00:00Z"
    }
  ],
  "workspaces": [
    {
      "id": "ws_000001",
      "name": "Workspace A",
      "rootPath": "E:/projects/a",
      "runtimeStatus": "",
      "createdAt": "2026-04-08T12:00:00Z",
      "updatedAt": "2026-04-08T12:00:00Z"
    }
  ],
  "threads": [
    {
      "id": "thread-1",
      "workspaceId": "ws_000001",
      "name": "Thread A",
      "status": "completed",
      "archived": false,
      "createdAt": "2026-04-08T12:00:00Z",
      "updatedAt": "2026-04-08T12:00:00Z"
    }
  ]
}`
	if err := os.WriteFile(storePath, []byte(payload), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	reloadedStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	logs := reloadedStore.ListBotConnectionLogs("ws_000001", "bcx_000001")
	if len(logs) != 1 {
		t.Fatalf("expected out-of-order bot connection logs to load, got %#v", logs)
	}
	if logs[0].EventType != "poll_ok" {
		t.Fatalf("expected persisted polling log to survive streaming load, got %#v", logs[0])
	}

	key := threadProjectionKey("ws_000001", "thread-1")
	reloadedStore.mu.RLock()
	record, ok := reloadedStore.projections[key]
	reloadedStore.mu.RUnlock()
	if !ok {
		t.Fatal("expected thread projection record after streaming load")
	}
	if record.Projection.Turns != nil {
		t.Fatal("expected streaming load to keep projection turns cold")
	}
	if len(record.TurnsRaw) == 0 && len(record.TurnsCompressed) == 0 {
		t.Fatal("expected streaming load to retain cold turns payload")
	}
}

func TestPersistentStoreCompressesLargeColdThreadProjectionTurnsInMemory(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-compressed",
		WorkspaceID: workspace.ID,
		Name:        "Compressed Thread",
		Status:      "completed",
	}
	firstStore.UpsertThread(thread)

	largeText := strings.Repeat("very long command output line\n", 1500)
	firstStore.UpsertThreadProjectionSnapshot(ThreadDetail{
		Thread: thread,
		Turns: []ThreadTurn{
			{
				ID:     "turn-1",
				Status: "completed",
				Items: []map[string]any{
					{
						"id":               "cmd-1",
						"type":             "commandExecution",
						"aggregatedOutput": largeText,
						"status":           "completed",
					},
				},
			},
		},
	})

	key := threadProjectionKey(workspace.ID, thread.ID)
	firstStore.mu.RLock()
	record, ok := firstStore.projections[key]
	firstStore.mu.RUnlock()
	if !ok {
		t.Fatal("expected in-memory projection record")
	}
	if record.Projection.Turns != nil {
		t.Fatal("expected persisted projection to stay cold in memory")
	}
	if len(record.TurnsCompressed) == 0 {
		t.Fatal("expected large cold projection turns to be compressed in memory")
	}
	if len(record.TurnsRaw) != 0 {
		t.Fatalf("expected compressed cold projection to release raw turns, got %d bytes", len(record.TurnsRaw))
	}

	projection, ok := firstStore.GetThreadProjection(workspace.ID, thread.ID)
	if !ok {
		t.Fatal("expected compressed projection to materialize")
	}
	if len(projection.Turns) != 1 || len(projection.Turns[0].Items) != 1 {
		t.Fatalf("expected compressed projection to round-trip, got %#v", projection.Turns)
	}
	if stringValue(projection.Turns[0].Items[0]["aggregatedOutput"]) == "" {
		t.Fatal("expected decompressed projection to retain command output")
	}
}

func TestPersistentStoreExternalizesLargeThreadProjectionTurnsToSidecar(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-sidecar",
		WorkspaceID: workspace.ID,
		Name:        "Sidecar Thread",
		Status:      "completed",
	}
	firstStore.UpsertThread(thread)

	turns := make([]ThreadTurn, 0, 48)
	messageBody := strings.Repeat("project output segment ", 160)
	for index := 0; index < 48; index++ {
		turns = append(turns, ThreadTurn{
			ID:     "turn-" + NewID("ts"),
			Status: "completed",
			Items: []map[string]any{
				{
					"id":     "msg-" + NewID("itm"),
					"type":   "agentMessage",
					"text":   messageBody,
					"status": "completed",
				},
			},
		})
	}

	firstStore.UpsertThreadProjectionSnapshot(ThreadDetail{
		Thread: thread,
		Turns:  turns,
	})
	if err := firstStore.Flush(); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	key := threadProjectionKey(workspace.ID, thread.ID)
	firstStore.mu.RLock()
	record, ok := firstStore.projections[key]
	firstStore.mu.RUnlock()
	if !ok {
		t.Fatal("expected persisted sidecar projection record")
	}
	if record.TurnsPath == "" {
		t.Fatal("expected large projection turns to be externalized to a sidecar file")
	}
	if record.TurnsManifest == nil {
		t.Fatal("expected large projection turns to persist as a chunked sidecar manifest")
	}
	if len(record.TurnsManifest.ChunkRefs) < 2 {
		t.Fatalf("expected chunked sidecar manifest to contain multiple chunk refs, got %#v", record.TurnsManifest)
	}
	if len(record.TurnsRaw) != 0 || len(record.TurnsCompressed) != 0 {
		t.Fatalf("expected externalized projection to release resident turns payload, got raw=%d compressed=%d", len(record.TurnsRaw), len(record.TurnsCompressed))
	}
	if _, err := os.Stat(record.TurnsPath); err != nil {
		t.Fatalf("expected turns sidecar file to exist: %v", err)
	}

	storeData, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatalf("ReadFile(metadata.json) error = %v", err)
	}

	var snapshot storeSnapshot
	if err := json.Unmarshal(storeData, &snapshot); err != nil {
		t.Fatalf("json.Unmarshal(metadata.json) error = %v", err)
	}
	if len(snapshot.ThreadProjections) != 1 {
		t.Fatalf("expected 1 stored thread projection, got %#v", snapshot.ThreadProjections)
	}
	if strings.TrimSpace(snapshot.ThreadProjections[0].TurnsRef) == "" {
		t.Fatalf("expected thread projection to persist turnsRef, got %#v", snapshot.ThreadProjections[0])
	}
	if len(normalizeThreadProjectionRawJSON(snapshot.ThreadProjections[0].Turns)) != len([]byte("[]")) {
		t.Fatalf("expected externalized thread projection to omit inline turns payload, got %q", string(snapshot.ThreadProjections[0].Turns))
	}

	projection, ok := firstStore.GetThreadProjection(workspace.ID, thread.ID)
	if !ok {
		t.Fatal("expected sidecar-backed projection to materialize")
	}
	if len(projection.Turns) != len(turns) {
		t.Fatalf("expected %d turns from sidecar-backed projection, got %d", len(turns), len(projection.Turns))
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	secondStore.mu.RLock()
	record, ok = secondStore.projections[key]
	secondStore.mu.RUnlock()
	if !ok {
		t.Fatal("expected reloaded sidecar projection record")
	}
	if record.TurnsPath == "" {
		t.Fatal("expected reloaded projection to retain sidecar path")
	}
	if record.TurnsManifest == nil {
		t.Fatal("expected reloaded projection to retain chunked sidecar manifest")
	}
	if len(record.TurnsRaw) != 0 || len(record.TurnsCompressed) != 0 {
		t.Fatalf("expected reloaded sidecar projection to stay file-backed, got raw=%d compressed=%d", len(record.TurnsRaw), len(record.TurnsCompressed))
	}
}

func TestPersistentStoreRemovesThreadProjectionSidecarWhenThreadDeleted(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-sidecar-delete",
		WorkspaceID: workspace.ID,
		Name:        "Delete Sidecar Thread",
		Status:      "completed",
	}
	firstStore.UpsertThread(thread)

	turns := make([]ThreadTurn, 0, 40)
	messageBody := strings.Repeat("projection sidecar cleanup ", 180)
	for index := 0; index < 40; index++ {
		turns = append(turns, ThreadTurn{
			ID:     "turn-" + NewID("td"),
			Status: "completed",
			Items: []map[string]any{
				{
					"id":     "msg-" + NewID("cleanup"),
					"type":   "agentMessage",
					"text":   messageBody,
					"status": "completed",
				},
			},
		})
	}
	firstStore.UpsertThreadProjectionSnapshot(ThreadDetail{
		Thread: thread,
		Turns:  turns,
	})
	if err := firstStore.Flush(); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	key := threadProjectionKey(workspace.ID, thread.ID)
	firstStore.mu.RLock()
	record, ok := firstStore.projections[key]
	firstStore.mu.RUnlock()
	if !ok || record.TurnsPath == "" {
		t.Fatalf("expected sidecar-backed projection before deletion, got %#v", record)
	}
	sidecarPath := record.TurnsPath

	if err := firstStore.DeleteThread(workspace.ID, thread.ID); err != nil {
		t.Fatalf("DeleteThread() error = %v", err)
	}
	if err := firstStore.Flush(); err != nil {
		t.Fatalf("Flush() after DeleteThread() error = %v", err)
	}
	if _, err := os.Stat(sidecarPath); !os.IsNotExist(err) {
		t.Fatalf("expected sidecar file to be removed after thread deletion, stat err=%v", err)
	}
}

func TestInspectMemoryDoesNotMaterializeExternalizedProjectionTurns(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-inspect-sidecar",
		WorkspaceID: workspace.ID,
		Name:        "Inspect Sidecar Thread",
		Status:      "completed",
	}
	firstStore.UpsertThread(thread)

	turns := make([]ThreadTurn, 0, 42)
	for index := 0; index < 42; index++ {
		turns = append(turns, ThreadTurn{
			ID:     "turn-" + NewID("im"),
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "msg-" + NewID("imsg"),
					"type": "agentMessage",
					"text": strings.Repeat("inspect memory payload ", 180),
				},
				{
					"id":               "cmd-" + NewID("icmd"),
					"type":             "commandExecution",
					"aggregatedOutput": strings.Repeat("command output ", 220),
				},
			},
		})
	}
	firstStore.UpsertThreadProjectionSnapshot(ThreadDetail{
		Thread: thread,
		Turns:  turns,
	})

	reloadedStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	key := threadProjectionKey(workspace.ID, thread.ID)
	reloadedStore.mu.RLock()
	before := reloadedStore.projections[key]
	reloadedStore.mu.RUnlock()
	if before.TurnsPath == "" {
		t.Fatal("expected externalized projection before inspection")
	}
	if before.Projection.Turns != nil {
		t.Fatal("expected externalized projection to stay cold before inspection")
	}
	if before.SnapshotBytes <= 0 {
		t.Fatalf("expected cached projection snapshot bytes before inspection, got %d", before.SnapshotBytes)
	}
	if threadProjectionStatsIsZero(before.Stats) {
		t.Fatalf("expected reloaded projection stats to be available, got %#v", before.Stats)
	}

	inspection := reloadedStore.InspectMemory(5)
	if inspection.Threads.HotProjectionCount != 0 {
		t.Fatalf("expected InspectMemory() to avoid heating projections, got hot=%d", inspection.Threads.HotProjectionCount)
	}
	if inspection.Threads.ItemCount != len(turns)*2 {
		t.Fatalf("expected %d items, got %d", len(turns)*2, inspection.Threads.ItemCount)
	}
	if len(inspection.Threads.ItemTypes) == 0 {
		t.Fatal("expected item type stats from cached projection metadata")
	}

	reloadedStore.mu.RLock()
	after := reloadedStore.projections[key]
	reloadedStore.mu.RUnlock()
	if after.Projection.Turns != nil {
		t.Fatal("expected InspectMemory() to keep externalized projection cold")
	}
	if after.TurnsPath == "" {
		t.Fatal("expected sidecar path to remain after inspection")
	}
	if after.SnapshotBytes != before.SnapshotBytes {
		t.Fatalf("expected cached snapshot bytes to stay %d, got %d", before.SnapshotBytes, after.SnapshotBytes)
	}
}

func TestPersistentStoreReloadBackfillsMissingThreadProjectionStats(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-stats-backfill",
		WorkspaceID: workspace.ID,
		Name:        "Stats Backfill Thread",
		Status:      "completed",
	}
	firstStore.UpsertThread(thread)

	turns := make([]ThreadTurn, 0, 36)
	for index := 0; index < 36; index++ {
		turns = append(turns, ThreadTurn{
			ID:     "turn-" + NewID("bf"),
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "msg-" + NewID("bmsg"),
					"type": "agentMessage",
					"text": strings.Repeat("backfill payload ", 220),
				},
			},
		})
	}
	firstStore.UpsertThreadProjectionSnapshot(ThreadDetail{
		Thread: thread,
		Turns:  turns,
	})
	if err := firstStore.Flush(); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	storeData, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatalf("ReadFile(metadata.json) error = %v", err)
	}

	var snapshot storeSnapshot
	if err := json.Unmarshal(storeData, &snapshot); err != nil {
		t.Fatalf("json.Unmarshal(metadata.json) error = %v", err)
	}
	if len(snapshot.ThreadProjections) != 1 {
		t.Fatalf("expected 1 stored projection, got %#v", snapshot.ThreadProjections)
	}
	snapshot.ThreadProjections[0].Stats = nil

	updatedStoreData, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		t.Fatalf("json.MarshalIndent(snapshot) error = %v", err)
	}
	if err := os.WriteFile(storePath, updatedStoreData, 0o644); err != nil {
		t.Fatalf("WriteFile(metadata.json) error = %v", err)
	}

	reloadedStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	key := threadProjectionKey(workspace.ID, thread.ID)
	reloadedStore.mu.RLock()
	record, ok := reloadedStore.projections[key]
	reloadedStore.mu.RUnlock()
	if !ok {
		t.Fatal("expected reloaded projection")
	}
	if threadProjectionStatsIsZero(record.Stats) {
		t.Fatalf("expected reload to backfill projection stats, got %#v", record.Stats)
	}
	if record.SnapshotBytes <= 0 {
		t.Fatalf("expected reload to cache projection snapshot bytes, got %d", record.SnapshotBytes)
	}
	if record.Projection.Turns != nil {
		t.Fatal("expected stats backfill to keep projection cold")
	}
	if err := reloadedStore.Flush(); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	rewrittenStoreData, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatalf("ReadFile(rewritten metadata.json) error = %v", err)
	}

	var rewrittenSnapshot storeSnapshot
	if err := json.Unmarshal(rewrittenStoreData, &rewrittenSnapshot); err != nil {
		t.Fatalf("json.Unmarshal(rewritten metadata.json) error = %v", err)
	}
	if rewrittenSnapshot.ThreadProjections[0].Stats == nil {
		t.Fatalf("expected metadata reload to persist backfilled stats, got %#v", rewrittenSnapshot.ThreadProjections[0])
	}
}

func TestInspectMemoryCacheInvalidatesAfterTransientThreadEvent(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-inspection-event",
		WorkspaceID: workspace.ID,
		Name:        "Inspection Event Thread",
		Status:      "completed",
	}
	dataStore.UpsertThread(thread)
	dataStore.UpsertThreadProjectionSnapshot(ThreadDetail{
		Thread: thread,
		Turns: []ThreadTurn{
			{
				ID:     "turn-1",
				Status: "completed",
				Items: []map[string]any{
					{
						"id":   "msg-1",
						"type": "agentMessage",
						"text": "hello",
					},
				},
			},
		},
	})

	before := dataStore.InspectMemory(5)
	if before.Threads.HotProjectionCount != 0 {
		t.Fatalf("expected cold projection before transient event, got %d", before.Threads.HotProjectionCount)
	}
	if before.Threads.ItemCount != 1 {
		t.Fatalf("expected 1 item before transient event, got %d", before.Threads.ItemCount)
	}

	dataStore.ApplyThreadEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    thread.ID,
		TurnID:      "turn-1",
		Method:      "item/agentMessage/delta",
		Payload: map[string]any{
			"turnId": "turn-1",
			"itemId": "msg-2",
			"delta":  "streaming reply",
		},
	})

	after := dataStore.InspectMemory(5)
	if after.Threads.HotProjectionCount != 1 {
		t.Fatalf("expected transient thread event to invalidate inspection cache, hot=%d", after.Threads.HotProjectionCount)
	}
	if after.Threads.ItemCount != 2 {
		t.Fatalf("expected 2 items after transient thread event, got %d", after.Threads.ItemCount)
	}
}

func TestInspectMemoryCacheInvalidatesAfterTransientBotLog(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	connection, err := dataStore.CreateBotConnection(BotConnection{
		WorkspaceID: workspace.ID,
		Provider:    "telegram",
		Name:        "Bot Connection",
		Status:      "active",
		AIBackend:   "test",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}

	before := dataStore.InspectMemory(5)
	if before.Counts.BotConnectionLogs != 0 {
		t.Fatalf("expected 0 bot connection logs before transient append, got %d", before.Counts.BotConnectionLogs)
	}

	if _, err := dataStore.AppendBotConnectionLogTransient(workspace.ID, connection.ID, BotConnectionLogEntry{
		Level:   "info",
		Message: "poll succeeded",
	}); err != nil {
		t.Fatalf("AppendBotConnectionLogTransient() error = %v", err)
	}

	after := dataStore.InspectMemory(5)
	if after.Counts.BotConnectionLogs != 1 {
		t.Fatalf("expected transient bot log to invalidate inspection cache, got %d logs", after.Counts.BotConnectionLogs)
	}
	if after.SerializedBytes.BotConnectionLogs <= before.SerializedBytes.BotConnectionLogs {
		t.Fatalf("expected bot connection log bytes to increase after transient append, before=%d after=%d", before.SerializedBytes.BotConnectionLogs, after.SerializedBytes.BotConnectionLogs)
	}
}

func TestGetThreadProjectionWindowStreamsCurrentTailFromSidecar(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-window-tail",
		WorkspaceID: workspace.ID,
		Name:        "Window Tail Thread",
		Status:      "completed",
	}
	firstStore.UpsertThread(thread)

	turns := make([]ThreadTurn, 0, 18)
	for index := 1; index <= 18; index++ {
		turns = append(turns, ThreadTurn{
			ID:     "turn-" + string(rune('A'+index-1)),
			Status: "completed",
			Items: []map[string]any{
				{
					"id":     "msg-" + NewID("tail"),
					"type":   "agentMessage",
					"text":   strings.Repeat("window tail payload ", 140),
					"status": "completed",
				},
			},
		})
	}

	firstStore.UpsertThreadProjectionSnapshot(ThreadDetail{
		Thread: thread,
		Turns:  turns,
	})

	reloadedStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	window, ok := reloadedStore.GetThreadProjectionWindow(workspace.ID, thread.ID, 3, "")
	if !ok {
		t.Fatal("expected projection window")
	}
	if !window.HasMore {
		t.Fatalf("expected tail window to report older turns, got %#v", window)
	}
	if !window.BeforeTurnFound {
		t.Fatal("expected current tail window to mark beforeTurnFound=true when beforeTurnId is empty")
	}
	if len(window.Projection.Turns) != 3 {
		t.Fatalf("expected 3 turns in tail window, got %d", len(window.Projection.Turns))
	}
	if window.ReadSource != "sidecar_chunked" {
		t.Fatalf("expected chunked sidecar window source, got %q", window.ReadSource)
	}
	if window.ScannedTurns != 10 {
		t.Fatalf("expected tail window to scan 10 turns from the final chunks, got %d", window.ScannedTurns)
	}
	if window.Projection.Turns[0].ID != turns[len(turns)-3].ID ||
		window.Projection.Turns[1].ID != turns[len(turns)-2].ID ||
		window.Projection.Turns[2].ID != turns[len(turns)-1].ID {
		t.Fatalf("unexpected tail window turns: %#v", window.Projection.Turns)
	}
	if window.Projection.TurnCount != len(turns) {
		t.Fatalf("expected full turn count %d, got %d", len(turns), window.Projection.TurnCount)
	}
}

func TestGetThreadProjectionWindowStreamsBeforeTurnWindowFromChunkedSidecar(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-window-before-sidecar",
		WorkspaceID: workspace.ID,
		Name:        "Window Before Sidecar Thread",
		Status:      "completed",
	}
	firstStore.UpsertThread(thread)

	turns := make([]ThreadTurn, 0, 18)
	for index := 1; index <= 18; index++ {
		turns = append(turns, ThreadTurn{
			ID:     fmt.Sprintf("turn-%02d", index),
			Status: "completed",
			Items: []map[string]any{
				{
					"id":     "msg-" + NewID("chunked"),
					"type":   "agentMessage",
					"text":   strings.Repeat("chunked before-turn payload ", 140),
					"status": "completed",
				},
			},
		})
	}

	firstStore.UpsertThreadProjectionSnapshot(ThreadDetail{
		Thread: thread,
		Turns:  turns,
	})

	reloadedStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	window, ok := reloadedStore.GetThreadProjectionWindow(workspace.ID, thread.ID, 2, "turn-17")
	if !ok {
		t.Fatal("expected projection window")
	}
	if !window.BeforeTurnFound {
		t.Fatalf("expected before turn marker to be found, got %#v", window)
	}
	if !window.HasMore {
		t.Fatalf("expected before-turn window to report older turns, got %#v", window)
	}
	if len(window.Projection.Turns) != 2 {
		t.Fatalf("expected 2 turns in before-turn window, got %d", len(window.Projection.Turns))
	}
	if window.ReadSource != "sidecar_chunked" {
		t.Fatalf("expected chunked sidecar before-turn source, got %q", window.ReadSource)
	}
	if window.ScannedTurns != 8 {
		t.Fatalf("expected before-turn chunked window to scan 8 turns, got %d", window.ScannedTurns)
	}
	if window.Projection.Turns[0].ID != "turn-15" || window.Projection.Turns[1].ID != "turn-16" {
		t.Fatalf("unexpected before-turn window turns: %#v", window.Projection.Turns)
	}
}

func TestGetThreadProjectionWindowStreamsBeforeTurnWindow(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-window-before",
		WorkspaceID: workspace.ID,
		Name:        "Window Before Thread",
		Status:      "completed",
	}
	firstStore.UpsertThread(thread)

	turns := []ThreadTurn{
		{ID: "turn-1", Status: "completed", Items: []map[string]any{{"id": "msg-1", "type": "agentMessage", "text": strings.Repeat("payload ", 120)}}},
		{ID: "turn-2", Status: "completed", Items: []map[string]any{{"id": "msg-2", "type": "agentMessage", "text": strings.Repeat("payload ", 120)}}},
		{ID: "turn-3", Status: "completed", Items: []map[string]any{{"id": "msg-3", "type": "agentMessage", "text": strings.Repeat("payload ", 120)}}},
		{ID: "turn-4", Status: "completed", Items: []map[string]any{{"id": "msg-4", "type": "agentMessage", "text": strings.Repeat("payload ", 120)}}},
		{ID: "turn-5", Status: "completed", Items: []map[string]any{{"id": "msg-5", "type": "agentMessage", "text": strings.Repeat("payload ", 120)}}},
	}
	firstStore.UpsertThreadProjectionSnapshot(ThreadDetail{
		Thread: thread,
		Turns:  turns,
	})

	reloadedStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	window, ok := reloadedStore.GetThreadProjectionWindow(workspace.ID, thread.ID, 2, "turn-5")
	if !ok {
		t.Fatal("expected projection window")
	}
	if !window.BeforeTurnFound {
		t.Fatalf("expected before turn marker to be found, got %#v", window)
	}
	if !window.HasMore {
		t.Fatalf("expected before-turn window to report older turns, got %#v", window)
	}
	if len(window.Projection.Turns) != 2 {
		t.Fatalf("expected 2 turns in before-turn window, got %d", len(window.Projection.Turns))
	}
	if window.ReadSource != "compressed" {
		t.Fatalf("expected compressed before-turn source, got %q", window.ReadSource)
	}
	if window.ScannedTurns != 5 {
		t.Fatalf("expected before-turn window to scan 5 turns, got %d", window.ScannedTurns)
	}
	if window.Projection.Turns[0].ID != "turn-3" || window.Projection.Turns[1].ID != "turn-4" {
		t.Fatalf("unexpected before-turn window turns: %#v", window.Projection.Turns)
	}
}

func TestPersistentStorePersistsAutomations(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	_, err = firstStore.CreateAutomation(Automation{
		Title:         "Daily Sync",
		Description:   "Summarize changes",
		Prompt:        "Summarize changes",
		WorkspaceID:   workspace.ID,
		WorkspaceName: workspace.Name,
		Schedule:      "hourly",
		ScheduleLabel: "Every hour",
		Model:         "gpt-5.4",
		Reasoning:     "medium",
		Status:        "active",
		NextRun:       "Today at next hour",
	})
	if err != nil {
		t.Fatalf("CreateAutomation() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	automations := secondStore.ListAutomations()
	if len(automations) != 1 {
		t.Fatalf("expected 1 automation after reload, got %d", len(automations))
	}
	if automations[0].Title != "Daily Sync" {
		t.Fatalf("expected persisted automation title, got %q", automations[0].Title)
	}
}

func TestPersistentStorePersistsBotConnectionRuntimeStateAndLogs(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	connection, err := firstStore.CreateBotConnection(BotConnection{
		WorkspaceID: workspace.ID,
		Provider:    "wechat",
		Name:        "WeChat Poller",
		Status:      "active",
		AIBackend:   "workspace_thread",
		Settings: map[string]string{
			"wechat_delivery_mode": "polling",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}

	_, err = firstStore.UpdateBotConnectionRuntimeState(workspace.ID, connection.ID, func(current BotConnection) BotConnection {
		polledAt := time.Date(2026, time.April, 6, 5, 6, 7, 0, time.UTC)
		current.LastPollAt = &polledAt
		current.LastPollStatus = "success"
		current.LastPollMessage = "Poll completed successfully. No new messages."
		return current
	})
	if err != nil {
		t.Fatalf("UpdateBotConnectionRuntimeState() error = %v", err)
	}

	if _, err := firstStore.AppendBotConnectionLog(workspace.ID, connection.ID, BotConnectionLogEntry{
		Level:     "success",
		EventType: "poll_idle",
		Message:   "Poll completed successfully. No new messages.",
	}); err != nil {
		t.Fatalf("AppendBotConnectionLog() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	storedConnection, ok := secondStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected bot connection after reload")
	}
	if storedConnection.LastPollAt == nil || storedConnection.LastPollStatus != "success" {
		t.Fatalf("expected persisted polling runtime state, got %#v", storedConnection)
	}
	if storedConnection.LastPollMessage != "Poll completed successfully. No new messages." {
		t.Fatalf("expected persisted polling message, got %#v", storedConnection)
	}

	logs := secondStore.ListBotConnectionLogs(workspace.ID, connection.ID)
	if len(logs) != 1 {
		t.Fatalf("expected 1 persisted bot log entry, got %#v", logs)
	}
	if logs[0].EventType != "poll_idle" || logs[0].Message != "Poll completed successfully. No new messages." {
		t.Fatalf("expected persisted bot log entry content, got %#v", logs[0])
	}
}

func TestPersistentStorePersistsBotDeliveryTargetsAndOutboundDeliveries(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	bot, err := firstStore.CreateBot(Bot{
		WorkspaceID: workspace.ID,
		Name:        "Ops Bot",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := firstStore.CreateBotConnection(BotConnection{
		WorkspaceID: workspace.ID,
		BotID:       bot.ID,
		Provider:    "telegram",
		Name:        "Telegram Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	conversation, err := firstStore.CreateBotConversation(BotConversation{
		WorkspaceID:            workspace.ID,
		BotID:                  bot.ID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat-1",
		ExternalChatID:         "chat-1",
		ExternalUserID:         "user-1",
		ExternalUsername:       "alice",
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}
	target, err := firstStore.CreateBotDeliveryTarget(BotDeliveryTarget{
		WorkspaceID:    workspace.ID,
		BotID:          bot.ID,
		ConnectionID:   connection.ID,
		ConversationID: conversation.ID,
		Provider:       connection.Provider,
		TargetType:     "session_backed",
		RouteType:      "telegram_chat",
		RouteKey:       "chat:1",
		Title:          "Primary Target",
		Capabilities:   []string{"supportsProactivePush"},
		ProviderState: map[string]string{
			"chat_id": "1",
		},
		Status: "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}
	if _, err := firstStore.CreateBotTrigger(BotTrigger{
		WorkspaceID:      workspace.ID,
		BotID:            bot.ID,
		Type:             "notification",
		DeliveryTargetID: target.ID,
		Filter: map[string]string{
			"kind":  "automation_run_completed",
			"level": "success",
		},
		Enabled: true,
	}); err != nil {
		t.Fatalf("CreateBotTrigger() error = %v", err)
	}
	if _, err := firstStore.CreateBotOutboundDelivery(BotOutboundDelivery{
		WorkspaceID:      workspace.ID,
		BotID:            bot.ID,
		ConnectionID:     connection.ID,
		ConversationID:   conversation.ID,
		DeliveryTargetID: target.ID,
		SourceType:       "notification",
		SourceRefType:    "notification",
		SourceRefID:      "ntf_001",
		Messages: []BotReplyMessage{
			{Text: "Approval completed"},
		},
		Status:         "delivered",
		AttemptCount:   1,
		IdempotencyKey: "ntf_001:v1",
		ProviderMessageIDs: []string{
			"provider-msg-1",
		},
	}); err != nil {
		t.Fatalf("CreateBotOutboundDelivery() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	targets := secondStore.ListBotDeliveryTargets(workspace.ID, bot.ID)
	if len(targets) != 1 {
		t.Fatalf("expected 1 persisted delivery target, got %#v", targets)
	}
	if targets[0].RouteKey != "chat:1" || len(targets[0].Capabilities) != 1 {
		t.Fatalf("expected persisted delivery target details, got %#v", targets[0])
	}

	triggers := secondStore.ListBotTriggers(workspace.ID, BotTriggerFilter{BotID: bot.ID})
	if len(triggers) != 1 {
		t.Fatalf("expected 1 persisted bot trigger, got %#v", triggers)
	}
	if triggers[0].Type != "notification" || triggers[0].Filter["kind"] != "automation_run_completed" {
		t.Fatalf("expected persisted bot trigger details, got %#v", triggers[0])
	}

	deliveries := secondStore.ListBotOutboundDeliveries(workspace.ID, BotOutboundDeliveryFilter{BotID: bot.ID})
	if len(deliveries) != 1 {
		t.Fatalf("expected 1 persisted outbound delivery, got %#v", deliveries)
	}
	if deliveries[0].SourceType != "notification" || deliveries[0].ProviderMessageIDs[0] != "provider-msg-1" {
		t.Fatalf("expected persisted outbound delivery details, got %#v", deliveries[0])
	}
}

func TestBotDeliveryTargetAndOutboundDeliveryCRUD(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	bot, err := dataStore.CreateBot(Bot{
		WorkspaceID: workspace.ID,
		Name:        "Ops Bot",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(BotConnection{
		WorkspaceID: workspace.ID,
		BotID:       bot.ID,
		Provider:    "telegram",
		Name:        "Telegram Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	conversation, err := dataStore.CreateBotConversation(BotConversation{
		WorkspaceID:            workspace.ID,
		BotID:                  bot.ID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat-1",
		ExternalChatID:         "chat-1",
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	target, err := dataStore.CreateBotDeliveryTarget(BotDeliveryTarget{
		WorkspaceID:    workspace.ID,
		BotID:          bot.ID,
		ConnectionID:   connection.ID,
		ConversationID: conversation.ID,
		Provider:       connection.Provider,
		TargetType:     "session_backed",
		RouteType:      "telegram_chat",
		RouteKey:       "chat:1",
		Title:          "Primary Target",
		Labels:         []string{" ops ", "", "vip"},
		Capabilities:   []string{"supportsProactivePush", " ", "requiresRouteState"},
		ProviderState: map[string]string{
			"chat_id": "1",
		},
		Status: "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}

	foundTarget, ok := dataStore.FindBotDeliveryTargetByConversation(workspace.ID, conversation.ID)
	if !ok || foundTarget.ID != target.ID {
		t.Fatalf("expected target lookup by conversation, got %#v", foundTarget)
	}
	if len(foundTarget.Labels) != 2 || foundTarget.Labels[0] != "ops" {
		t.Fatalf("expected normalized labels, got %#v", foundTarget.Labels)
	}

	target, err = dataStore.UpdateBotDeliveryTarget(workspace.ID, target.ID, func(current BotDeliveryTarget) BotDeliveryTarget {
		current.ConnectionID = "ignored"
		current.Title = "Updated Target"
		current.Status = "paused"
		current.Capabilities = []string{"supportsProactivePush"}
		return current
	})
	if err != nil {
		t.Fatalf("UpdateBotDeliveryTarget() error = %v", err)
	}
	if target.ConnectionID != connection.ID || target.Title != "Updated Target" || target.Status != "paused" {
		t.Fatalf("expected immutable connection and mutable title/status, got %#v", target)
	}

	delivery, err := dataStore.CreateBotOutboundDelivery(BotOutboundDelivery{
		WorkspaceID:       workspace.ID,
		BotID:             bot.ID,
		ConnectionID:      connection.ID,
		ConversationID:    conversation.ID,
		DeliveryTargetID:  target.ID,
		SourceType:        "manual",
		SourceRefType:     "thread_turn",
		SourceRefID:       "turn_001",
		OriginWorkspaceID: workspace.ID,
		OriginThreadID:    "thread_123",
		Messages: []BotReplyMessage{
			{Text: "Hello"},
		},
		Status:       "queued",
		AttemptCount: 0,
	})
	if err != nil {
		t.Fatalf("CreateBotOutboundDelivery() error = %v", err)
	}

	filtered := dataStore.ListBotOutboundDeliveries(workspace.ID, BotOutboundDeliveryFilter{
		BotID:            bot.ID,
		ConversationID:   conversation.ID,
		DeliveryTargetID: target.ID,
		SourceType:       "manual",
	})
	if len(filtered) != 1 || filtered[0].ID != delivery.ID {
		t.Fatalf("expected filtered outbound delivery, got %#v", filtered)
	}
	filtered = dataStore.ListBotOutboundDeliveries(workspace.ID, BotOutboundDeliveryFilter{
		BotID:         bot.ID,
		SourceRefType: "thread_turn",
		SourceRefID:   "turn_001",
	})
	if len(filtered) != 1 || filtered[0].ID != delivery.ID {
		t.Fatalf("expected outbound delivery sourceRef filter to match created delivery, got %#v", filtered)
	}

	delivery, err = dataStore.UpdateBotOutboundDelivery(workspace.ID, delivery.ID, func(current BotOutboundDelivery) BotOutboundDelivery {
		current.ConnectionID = "ignored"
		current.Status = "failed"
		current.AttemptCount = 2
		current.LastError = "provider timeout"
		current.ProviderMessageIDs = []string{"provider-msg-1"}
		return current
	})
	if err != nil {
		t.Fatalf("UpdateBotOutboundDelivery() error = %v", err)
	}
	if delivery.ConnectionID != connection.ID || delivery.Status != "failed" || delivery.AttemptCount != 2 {
		t.Fatalf("expected outbound delivery update to preserve linkage and update status, got %#v", delivery)
	}

	if err := dataStore.DeleteBotConnection(workspace.ID, connection.ID); err != nil {
		t.Fatalf("DeleteBotConnection() error = %v", err)
	}
	if targets := dataStore.ListBotDeliveryTargets(workspace.ID, bot.ID); len(targets) != 0 {
		t.Fatalf("expected delivery targets to be removed with connection, got %#v", targets)
	}
	if deliveries := dataStore.ListBotOutboundDeliveries(workspace.ID, BotOutboundDeliveryFilter{BotID: bot.ID}); len(deliveries) != 0 {
		t.Fatalf("expected outbound deliveries to be removed with connection, got %#v", deliveries)
	}
}

func TestBotTriggerCRUD(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	bot, err := dataStore.CreateBot(Bot{
		WorkspaceID: workspace.ID,
		Name:        "Ops Bot",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(BotConnection{
		WorkspaceID: workspace.ID,
		BotID:       bot.ID,
		Provider:    "telegram",
		Name:        "Telegram Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	target, err := dataStore.CreateBotDeliveryTarget(BotDeliveryTarget{
		WorkspaceID:  workspace.ID,
		BotID:        bot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		TargetType:   "route_backed",
		RouteType:    "telegram_chat",
		RouteKey:     "chat:notify-1",
		Title:        "Notify Chat",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}

	trigger, err := dataStore.CreateBotTrigger(BotTrigger{
		WorkspaceID:      workspace.ID,
		BotID:            bot.ID,
		Type:             "notification",
		DeliveryTargetID: target.ID,
		Filter: map[string]string{
			"kind":  "automation_run_completed",
			"level": "success",
		},
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateBotTrigger() error = %v", err)
	}

	listed := dataStore.ListBotTriggers(workspace.ID, BotTriggerFilter{
		BotID:            bot.ID,
		Type:             "notification",
		DeliveryTargetID: target.ID,
		Enabled:          boolPtr(true),
	})
	if len(listed) != 1 || listed[0].ID != trigger.ID {
		t.Fatalf("expected filtered bot trigger, got %#v", listed)
	}

	trigger, err = dataStore.UpdateBotTrigger(workspace.ID, trigger.ID, func(current BotTrigger) BotTrigger {
		current.Enabled = false
		current.Filter = map[string]string{
			"kind": "automation_run_failed",
		}
		return current
	})
	if err != nil {
		t.Fatalf("UpdateBotTrigger() error = %v", err)
	}
	if trigger.Enabled || trigger.Filter["kind"] != "automation_run_failed" {
		t.Fatalf("expected updated bot trigger state, got %#v", trigger)
	}

	disabled := dataStore.ListBotTriggers(workspace.ID, BotTriggerFilter{
		BotID:   bot.ID,
		Enabled: boolPtr(false),
	})
	if len(disabled) != 1 || disabled[0].ID != trigger.ID {
		t.Fatalf("expected disabled trigger filter to match, got %#v", disabled)
	}

	if err := dataStore.DeleteBotTrigger(workspace.ID, trigger.ID); err != nil {
		t.Fatalf("DeleteBotTrigger() error = %v", err)
	}
	if _, ok := dataStore.GetBotTrigger(workspace.ID, trigger.ID); ok {
		t.Fatal("expected bot trigger to be removed from store")
	}
}

func TestDeleteBotConnectionRemovesThreadBotBindings(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	dataStore.UpsertThread(Thread{
		ID:          "thread-bind-connection",
		WorkspaceID: workspace.ID,
		Name:        "Bound Thread",
		Status:      "idle",
	})
	bot, err := dataStore.CreateBot(Bot{
		WorkspaceID: workspace.ID,
		Name:        "Ops Bot",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(BotConnection{
		WorkspaceID: workspace.ID,
		BotID:       bot.ID,
		Provider:    "telegram",
		Name:        "Telegram Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	target, err := dataStore.CreateBotDeliveryTarget(BotDeliveryTarget{
		WorkspaceID:  workspace.ID,
		BotID:        bot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		TargetType:   "route_backed",
		RouteType:    "telegram_chat",
		RouteKey:     "chat:bind-connection",
		Title:        "Bound Chat",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}
	if _, err := dataStore.UpsertThreadBotBinding(ThreadBotBinding{
		WorkspaceID:      workspace.ID,
		ThreadID:         "thread-bind-connection",
		BotID:            bot.ID,
		DeliveryTargetID: target.ID,
	}); err != nil {
		t.Fatalf("UpsertThreadBotBinding() error = %v", err)
	}

	if err := dataStore.DeleteBotConnection(workspace.ID, connection.ID); err != nil {
		t.Fatalf("DeleteBotConnection() error = %v", err)
	}
	if _, ok := dataStore.GetThreadBotBinding(workspace.ID, "thread-bind-connection"); ok {
		t.Fatal("expected thread bot binding to be removed with its connection targets")
	}
}

func TestDeleteBotConnectionRemovesCrossWorkspaceThreadBotBindings(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	threadWorkspace := dataStore.CreateWorkspace("Thread Workspace", "E:/projects/thread")
	botWorkspace := dataStore.CreateWorkspace("Bot Workspace", "E:/projects/bot")
	dataStore.UpsertThread(Thread{
		ID:          "thread-bind-cross-workspace",
		WorkspaceID: threadWorkspace.ID,
		Name:        "Bound Thread",
		Status:      "idle",
	})
	bot, err := dataStore.CreateBot(Bot{
		WorkspaceID: botWorkspace.ID,
		Name:        "Ops Bot",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(BotConnection{
		WorkspaceID: botWorkspace.ID,
		BotID:       bot.ID,
		Provider:    "telegram",
		Name:        "Telegram Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	target, err := dataStore.CreateBotDeliveryTarget(BotDeliveryTarget{
		WorkspaceID:  botWorkspace.ID,
		BotID:        bot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		TargetType:   "route_backed",
		RouteType:    "telegram_chat",
		RouteKey:     "chat:bind-cross-workspace",
		Title:        "Bound Chat",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}
	if _, err := dataStore.UpsertThreadBotBinding(ThreadBotBinding{
		WorkspaceID:      threadWorkspace.ID,
		ThreadID:         "thread-bind-cross-workspace",
		BotWorkspaceID:   botWorkspace.ID,
		BotID:            bot.ID,
		DeliveryTargetID: target.ID,
	}); err != nil {
		t.Fatalf("UpsertThreadBotBinding() error = %v", err)
	}

	if err := dataStore.DeleteBotConnection(botWorkspace.ID, connection.ID); err != nil {
		t.Fatalf("DeleteBotConnection() error = %v", err)
	}
	if _, ok := dataStore.GetThreadBotBinding(threadWorkspace.ID, "thread-bind-cross-workspace"); ok {
		t.Fatal("expected cross-workspace thread bot binding to be removed with its connection targets")
	}
}

func TestDeleteBotRemovesThreadBotBindings(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	dataStore.UpsertThread(Thread{
		ID:          "thread-bind-bot",
		WorkspaceID: workspace.ID,
		Name:        "Bound Thread",
		Status:      "idle",
	})
	bot, err := dataStore.CreateBot(Bot{
		WorkspaceID: workspace.ID,
		Name:        "Ops Bot",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(BotConnection{
		WorkspaceID: workspace.ID,
		BotID:       bot.ID,
		Provider:    "telegram",
		Name:        "Telegram Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	target, err := dataStore.CreateBotDeliveryTarget(BotDeliveryTarget{
		WorkspaceID:  workspace.ID,
		BotID:        bot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		TargetType:   "route_backed",
		RouteType:    "telegram_chat",
		RouteKey:     "chat:bind-bot",
		Title:        "Bound Chat",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}
	if _, err := dataStore.UpsertThreadBotBinding(ThreadBotBinding{
		WorkspaceID:      workspace.ID,
		ThreadID:         "thread-bind-bot",
		BotID:            bot.ID,
		DeliveryTargetID: target.ID,
	}); err != nil {
		t.Fatalf("UpsertThreadBotBinding() error = %v", err)
	}

	if err := dataStore.DeleteBot(workspace.ID, bot.ID); err != nil {
		t.Fatalf("DeleteBot() error = %v", err)
	}
	if _, ok := dataStore.GetThreadBotBinding(workspace.ID, "thread-bind-bot"); ok {
		t.Fatal("expected thread bot binding to be removed with its bot")
	}
}

func TestDeleteThreadRemovesThreadBotBinding(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	thread := Thread{
		ID:          "thread-bind-delete",
		WorkspaceID: workspace.ID,
		Name:        "Bound Thread",
		Status:      "idle",
	}
	dataStore.UpsertThread(thread)

	bot, err := dataStore.CreateBot(Bot{
		WorkspaceID: workspace.ID,
		Name:        "Ops Bot",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(BotConnection{
		WorkspaceID: workspace.ID,
		BotID:       bot.ID,
		Provider:    "telegram",
		Name:        "Telegram Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	target, err := dataStore.CreateBotDeliveryTarget(BotDeliveryTarget{
		WorkspaceID:  workspace.ID,
		BotID:        bot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		TargetType:   "route_backed",
		RouteType:    "telegram_chat",
		RouteKey:     "chat:bind-delete",
		Title:        "Bound Chat",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}
	if _, err := dataStore.UpsertThreadBotBinding(ThreadBotBinding{
		WorkspaceID:      workspace.ID,
		ThreadID:         thread.ID,
		BotID:            bot.ID,
		DeliveryTargetID: target.ID,
	}); err != nil {
		t.Fatalf("UpsertThreadBotBinding() error = %v", err)
	}

	if err := dataStore.DeleteThread(workspace.ID, thread.ID); err != nil {
		t.Fatalf("DeleteThread() error = %v", err)
	}
	if _, ok := dataStore.GetThreadBotBinding(workspace.ID, thread.ID); ok {
		t.Fatal("expected thread bot binding to be removed with its thread")
	}
}

func TestPersistentStorePersistsAutomationTemplates(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	template, err := firstStore.CreateAutomationTemplate(AutomationTemplate{
		Category:    "Custom",
		Title:       "Security Audit",
		Description: "Review security posture",
		Prompt:      "Audit the repository for security issues.",
	})
	if err != nil {
		t.Fatalf("CreateAutomationTemplate() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	templates := secondStore.ListAutomationTemplates()
	if len(templates) != 1 {
		t.Fatalf("expected 1 template after reload, got %d", len(templates))
	}
	if templates[0].ID != template.ID || templates[0].Title != "Security Audit" {
		t.Fatalf("expected persisted template, got %#v", templates[0])
	}
}

func boolPtr(value bool) *bool {
	next := value
	return &next
}

func TestPersistentStorePersistsAutomationRunsAndNotifications(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	automation, err := firstStore.CreateAutomation(Automation{
		Title:         "Daily Sync",
		Description:   "Summarize changes",
		Prompt:        "Summarize changes",
		WorkspaceID:   workspace.ID,
		WorkspaceName: workspace.Name,
		Schedule:      "hourly",
		ScheduleLabel: "Every hour",
		Model:         "gpt-5.4",
		Reasoning:     "medium",
		Status:        "active",
		NextRun:       "2026-03-21 09:00",
	})
	if err != nil {
		t.Fatalf("CreateAutomation() error = %v", err)
	}

	run, err := firstStore.CreateAutomationRun(AutomationRun{
		AutomationID:    automation.ID,
		AutomationTitle: automation.Title,
		WorkspaceID:     workspace.ID,
		WorkspaceName:   workspace.Name,
		Status:          "completed",
		Trigger:         "manual",
	})
	if err != nil {
		t.Fatalf("CreateAutomationRun() error = %v", err)
	}
	if _, err := firstStore.AppendAutomationRunLog(run.ID, AutomationRunLogEntry{
		Level:   "info",
		Message: "Run started",
	}); err != nil {
		t.Fatalf("AppendAutomationRunLog() error = %v", err)
	}

	if _, err := firstStore.CreateNotification(Notification{
		WorkspaceID:     workspace.ID,
		WorkspaceName:   workspace.Name,
		AutomationID:    automation.ID,
		AutomationTitle: automation.Title,
		RunID:           run.ID,
		Kind:            "automation_run_completed",
		Title:           "Automation completed",
		Message:         "Daily Sync completed",
		Level:           "success",
	}); err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	reloadedRuns := secondStore.ListAutomationRuns(automation.ID)
	if len(reloadedRuns) != 1 {
		t.Fatalf("expected 1 automation run after reload, got %d", len(reloadedRuns))
	}
	if len(reloadedRuns[0].Logs) != 1 {
		t.Fatalf("expected persisted run logs, got %#v", reloadedRuns[0].Logs)
	}

	reloadedNotifications := secondStore.ListNotifications()
	if len(reloadedNotifications) != 1 {
		t.Fatalf("expected 1 notification after reload, got %d", len(reloadedNotifications))
	}
	if reloadedNotifications[0].Kind != "automation_run_completed" {
		t.Fatalf("expected persisted notification kind, got %q", reloadedNotifications[0].Kind)
	}
}

func TestThreadProjectionPersistsServerRequests(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	firstStore.ApplyThreadEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/commandExecution/requestApproval",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"command":  "rm -rf build",
		},
		ServerRequestID: ptr("req-1"),
	})
	firstStore.ApplyThreadEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "server/request/resolved",
		Payload: map[string]any{
			"method": "item/commandExecution/requestApproval",
		},
		ServerRequestID: ptr("req-1"),
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	projection, ok := secondStore.GetThreadProjection(workspace.ID, "thread-1")
	if !ok || len(projection.Turns) != 1 || len(projection.Turns[0].Items) != 1 {
		t.Fatalf("expected persisted server request projection, got %#v", projection)
	}
	if got := projection.Turns[0].Items[0]["type"]; got != "serverRequest" {
		t.Fatalf("expected serverRequest item, got %#v", got)
	}
	if got := projection.Turns[0].Items[0]["status"]; got != "resolved" {
		t.Fatalf("expected resolved request status, got %#v", got)
	}
}

func TestPersistentStorePersistsCommandSessions(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	firstStore.UpsertCommandSessionSnapshot(CommandSessionSnapshot{
		CommandSession: CommandSession{
			ID:          "proc_001",
			WorkspaceID: workspace.ID,
			Command:     "echo hello",
			Mode:        "command",
			ShellPath:   "cmd.exe",
			InitialCwd:  workspace.RootPath,
			CurrentCwd:  workspace.RootPath,
			Status:      "completed",
			CreatedAt:   time.Now().UTC().Add(-time.Minute),
		},
		CombinedOutput: "hello\r\n",
		Stdout:         "hello\r\n",
		UpdatedAt:      time.Now().UTC(),
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	sessions := secondStore.ListCommandSessions(workspace.ID)
	if len(sessions) != 1 {
		t.Fatalf("expected 1 command session after reload, got %d", len(sessions))
	}
	if sessions[0].CombinedOutput != "hello\r\n" {
		t.Fatalf("expected persisted combined output, got %q", sessions[0].CombinedOutput)
	}
	if sessions[0].Mode != "command" || sessions[0].ShellPath != "cmd.exe" {
		t.Fatalf("expected persisted command session metadata, got %#v", sessions[0])
	}
	if sessions[0].CurrentCwd != workspace.RootPath {
		t.Fatalf("expected persisted command session cwd, got %q", sessions[0].CurrentCwd)
	}
}

func TestCommandSessionRetentionAndTTL(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	now := time.Now().UTC()

	for index := 0; index < 10; index += 1 {
		dataStore.UpsertCommandSessionSnapshot(CommandSessionSnapshot{
			CommandSession: CommandSession{
				ID:          "proc_" + string(rune('a'+index)),
				WorkspaceID: workspace.ID,
				Command:     "echo test",
				Status:      "completed",
				CreatedAt:   now.Add(-time.Duration(index) * time.Minute),
			},
			UpdatedAt: now.Add(-time.Duration(index) * time.Minute),
		})
	}

	sessions := dataStore.ListCommandSessions(workspace.ID)
	if len(sessions) != 10 {
		t.Fatalf("expected 10 command sessions before retention overflow, got %d", len(sessions))
	}

	dataStore.UpsertCommandSessionSnapshot(CommandSessionSnapshot{
		CommandSession: CommandSession{
			ID:          "proc_expired",
			WorkspaceID: workspace.ID,
			Command:     "echo old",
			Status:      "completed",
			CreatedAt:   now.Add(-48 * time.Hour),
		},
		UpdatedAt: now.Add(-48 * time.Hour),
	})

	removed := dataStore.PruneExpiredCommandSessions(now)
	if len(removed) == 0 {
		t.Fatal("expected expired command session to be pruned")
	}

	for index := 10; index < 16; index += 1 {
		dataStore.UpsertCommandSessionSnapshot(CommandSessionSnapshot{
			CommandSession: CommandSession{
				ID:          "proc_" + string(rune('a'+index)),
				WorkspaceID: workspace.ID,
				Command:     "echo test",
				Status:      "completed",
				CreatedAt:   now.Add(-time.Duration(index) * time.Minute),
			},
			UpdatedAt: now.Add(-time.Duration(index) * time.Minute),
		})
	}

	sessions = dataStore.ListCommandSessions(workspace.ID)
	if len(sessions) != commandSessionRetentionLimit {
		t.Fatalf("expected retention limit %d after overflow, got %d", commandSessionRetentionLimit, len(sessions))
	}
}

func TestPinnedAndArchivedCommandSessionsAreCapped(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	now := time.Now().UTC()

	for index := 0; index < commandSessionPinnedArchivedLimit+6; index += 1 {
		dataStore.UpsertCommandSessionSnapshot(CommandSessionSnapshot{
			CommandSession: CommandSession{
				ID:          "proc_pinned_" + string(rune('a'+index)),
				WorkspaceID: workspace.ID,
				Command:     "echo pinned",
				Status:      "completed",
				CreatedAt:   now.Add(-time.Duration(index) * time.Minute),
			},
			Pinned:    true,
			UpdatedAt: now.Add(-time.Duration(index) * time.Minute),
		})
	}

	sessions := dataStore.ListCommandSessions(workspace.ID)
	if len(sessions) != commandSessionPinnedArchivedLimit {
		t.Fatalf(
			"expected pinned/archived retention limit %d after overflow, got %d",
			commandSessionPinnedArchivedLimit,
			len(sessions),
		)
	}
}

func ptr(value string) *string {
	return &value
}
