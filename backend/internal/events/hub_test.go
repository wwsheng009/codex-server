package events

import (
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

type testHubStore struct {
	headSeqByWorkspace map[string]uint64
}

func (s *testHubStore) ApplyThreadEvent(store.EventEnvelope) {}

func (s *testHubStore) AppendWorkspaceEvent(event store.EventEnvelope) store.EventEnvelope {
	return event
}

func (s *testHubStore) ListWorkspaceEventsAfter(string, uint64, int) []store.EventEnvelope {
	return nil
}

func (s *testHubStore) GetWorkspaceEventHeadSeq(workspaceID string) uint64 {
	if s == nil || s.headSeqByWorkspace == nil {
		return 0
	}
	return s.headSeqByWorkspace[workspaceID]
}

func (s *testHubStore) GetWorkspaceEventOldestSeq(string) uint64 {
	return 0
}

func TestHubDoesNotCloseSlowWorkspaceSubscriberOnDroppableOverflow(t *testing.T) {
	t.Parallel()

	hub := NewHub()
	eventsCh, cancel := hub.Subscribe("ws-1")
	defer cancel()

	for index := 0; index < subscriberOutputBufferSize+subscriberQueueHardLimit+32; index++ {
		hub.Publish(store.EventEnvelope{
			WorkspaceID: "ws-1",
			Method:      "command/exec/outputDelta",
			Payload: map[string]any{
				"index": index,
			},
			TS: time.Now().UTC(),
		})
	}

	hub.Publish(store.EventEnvelope{
		WorkspaceID: "ws-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"status": "completed",
		},
		TS: time.Now().UTC(),
	})

	deadline := time.After(2 * time.Second)
	for {
		select {
		case event, ok := <-eventsCh:
			if !ok {
				t.Fatal("expected slow subscriber to stay connected")
			}
			if event.Method == "turn/completed" {
				return
			}
		case <-deadline:
			t.Fatal("timed out waiting for non-droppable event after droppable overflow")
		}
	}
}

func TestSubscriberCoalescesCommandOutputDeltaUnderBackpressure(t *testing.T) {
	t.Parallel()

	sub := &subscriber{
		out:    make(chan store.EventEnvelope, subscriberOutputBufferSize),
		notify: make(chan struct{}, 1),
		done:   make(chan struct{}),
		queue:  make([]store.EventEnvelope, 0, subscriberQueueSoftLimit),
	}

	for index := 0; index < subscriberQueueSoftLimit-1; index++ {
		sub.queue = append(sub.queue, store.EventEnvelope{
			WorkspaceID: "ws-1",
			Method:      "turn/started",
			Payload:     map[string]any{"index": index},
			TS:          time.Now().UTC(),
		})
	}
	sub.queue = append(sub.queue, store.EventEnvelope{
		WorkspaceID: "ws-1",
		Method:      "command/exec/outputDelta",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Seq:         101,
		Payload: map[string]any{
			"deltaText": "hello ",
			"processId": "proc-1",
			"stream":    "stdout",
		},
		TS: time.Now().UTC(),
	})

	result := sub.enqueue(store.EventEnvelope{
		WorkspaceID: "ws-1",
		Method:      "command/exec/outputDelta",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Seq:         102,
		Payload: map[string]any{
			"deltaText": "world",
			"processId": "proc-1",
			"stream":    "stdout",
		},
		TS: time.Now().UTC(),
	})

	if result.dropped {
		t.Fatal("expected command output delta to be coalesced instead of dropped")
	}
	if !result.merged {
		t.Fatal("expected command output delta merge result")
	}
	if len(sub.queue) != subscriberQueueSoftLimit {
		t.Fatalf("expected queue size to stay at soft limit, got %d", len(sub.queue))
	}
	if sub.mergedCount != 1 {
		t.Fatalf("expected merged count 1, got %d", sub.mergedCount)
	}
	if sub.coalescedCommandOutputBytes != len("world") {
		t.Fatalf("expected coalesced command output bytes %d, got %d", len("world"), sub.coalescedCommandOutputBytes)
	}
	if sub.coalescedByMethod["command/exec/outputDelta"] != 1 {
		t.Fatalf("expected command output delta coalesce count 1, got %d", sub.coalescedByMethod["command/exec/outputDelta"])
	}
	mergedEvent := sub.queue[len(sub.queue)-1]
	if !mergedEvent.Coalesced {
		t.Fatal("expected merged command output delta to be marked coalesced")
	}
	if mergedEvent.Seq != 102 || mergedEvent.CoversSeqFrom != 101 || mergedEvent.CoversSeqTo != 102 {
		t.Fatalf("expected merged command output delta seq coverage 101-102 at seq 102, got seq=%d covers=%d-%d", mergedEvent.Seq, mergedEvent.CoversSeqFrom, mergedEvent.CoversSeqTo)
	}

	payload, ok := mergedEvent.Payload.(map[string]any)
	if !ok {
		t.Fatalf("expected merged payload map, got %#v", mergedEvent.Payload)
	}
	if payload["deltaText"] != "hello world" {
		t.Fatalf("expected merged delta text, got %#v", payload["deltaText"])
	}
}

func TestSubscriberCoalescesThreadTokenUsageUpdateToLatest(t *testing.T) {
	t.Parallel()

	sub := &subscriber{
		out:    make(chan store.EventEnvelope, subscriberOutputBufferSize),
		notify: make(chan struct{}, 1),
		done:   make(chan struct{}),
		queue: []store.EventEnvelope{
			{
				WorkspaceID: "ws-1",
				ThreadID:    "thread-1",
				Method:      "thread/tokenUsage/updated",
				Seq:         201,
				Payload: map[string]any{
					"tokenUsage": map[string]any{"total": 10},
				},
				TS: time.Now().UTC(),
			},
		},
	}

	result := sub.enqueue(store.EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		Method:      "thread/tokenUsage/updated",
		Seq:         203,
		Payload: map[string]any{
			"tokenUsage": map[string]any{"total": 20},
		},
		TS: time.Now().UTC(),
	})

	if result.dropped {
		t.Fatal("expected token usage update to replace prior queued update")
	}
	if !result.merged {
		t.Fatal("expected token usage update merge result")
	}
	if len(sub.queue) != 1 {
		t.Fatalf("expected single token usage event in queue, got %d", len(sub.queue))
	}
	if sub.coalescedByMethod["thread/tokenUsage/updated"] != 1 {
		t.Fatalf("expected token usage coalesce count 1, got %d", sub.coalescedByMethod["thread/tokenUsage/updated"])
	}
	if !sub.queue[0].Coalesced {
		t.Fatal("expected token usage replacement event to be marked coalesced")
	}
	if sub.queue[0].Seq != 203 || sub.queue[0].CoversSeqFrom != 201 || sub.queue[0].CoversSeqTo != 203 {
		t.Fatalf("expected token usage seq coverage 201-203 at seq 203, got seq=%d covers=%d-%d", sub.queue[0].Seq, sub.queue[0].CoversSeqFrom, sub.queue[0].CoversSeqTo)
	}

	payload, ok := sub.queue[0].Payload.(map[string]any)
	if !ok {
		t.Fatalf("expected merged token usage payload map, got %#v", sub.queue[0].Payload)
	}
	usage, ok := payload["tokenUsage"].(map[string]any)
	if !ok {
		t.Fatalf("expected token usage payload to stay a map, got %#v", payload["tokenUsage"])
	}
	if usage["total"] != 20 {
		t.Fatalf("expected latest token usage total, got %#v", usage["total"])
	}
}

func TestSubscriberTracksSoftAndHardDropBreakdown(t *testing.T) {
	t.Parallel()

	sub := &subscriber{
		out:               make(chan store.EventEnvelope, subscriberOutputBufferSize),
		notify:            make(chan struct{}, 1),
		done:              make(chan struct{}),
		queue:             make([]store.EventEnvelope, 0, subscriberQueueHardLimit),
		coalescedByMethod: make(map[string]int),
	}

	for index := 0; index < subscriberQueueSoftLimit; index++ {
		sub.queue = append(sub.queue, store.EventEnvelope{
			WorkspaceID: "ws-1",
			Method:      "turn/started",
			TS:          time.Now().UTC(),
		})
	}

	result := sub.enqueue(store.EventEnvelope{
		WorkspaceID: "ws-1",
		Method:      "item/agentMessage/delta",
		Payload:     map[string]any{"delta": "x"},
		TS:          time.Now().UTC(),
	})
	if !result.dropped {
		t.Fatal("expected soft-limit droppable event to be dropped")
	}
	if sub.softDroppedCount != 1 || sub.droppedCount != 1 {
		t.Fatalf("expected soft/dropped counts 1/1, got %d/%d", sub.softDroppedCount, sub.droppedCount)
	}
	if sub.hardDroppedCount != 0 || sub.hardEvictedCount != 0 {
		t.Fatalf("expected no hard drops or evictions, got %d/%d", sub.hardDroppedCount, sub.hardEvictedCount)
	}

	hardOnly := &subscriber{
		out:               make(chan store.EventEnvelope, subscriberOutputBufferSize),
		notify:            make(chan struct{}, 1),
		done:              make(chan struct{}),
		queue:             make([]store.EventEnvelope, 0, subscriberQueueHardLimit),
		coalescedByMethod: make(map[string]int),
	}
	for index := 0; index < subscriberQueueHardLimit; index++ {
		hardOnly.queue = append(hardOnly.queue, store.EventEnvelope{
			WorkspaceID: "ws-1",
			Method:      "turn/started",
			TS:          time.Now().UTC(),
		})
	}

	result = hardOnly.enqueue(store.EventEnvelope{
		WorkspaceID: "ws-1",
		Method:      "turn/completed",
		TS:          time.Now().UTC(),
	})
	if !result.dropped {
		t.Fatal("expected hard-limit non-droppable event to be rejected when queue has no droppable entries")
	}
	if hardOnly.hardDroppedCount != 1 || hardOnly.droppedCount != 1 {
		t.Fatalf("expected hard/dropped counts 1/1, got %d/%d", hardOnly.hardDroppedCount, hardOnly.droppedCount)
	}
}

func TestSubscriberEnqueuesDroppedControlEventAfterSoftDrop(t *testing.T) {
	t.Parallel()

	sub := &subscriber{
		id:                99,
		scope:             "workspace",
		source:            "test.workspace_stream",
		role:              "workspace-stream",
		out:               make(chan store.EventEnvelope, subscriberOutputBufferSize),
		notify:            make(chan struct{}, 1),
		done:              make(chan struct{}),
		queue:             make([]store.EventEnvelope, 0, subscriberQueueHardLimit),
		coalescedByMethod: make(map[string]int),
	}

	for index := 0; index < subscriberQueueSoftLimit; index++ {
		sub.queue = append(sub.queue, store.EventEnvelope{
			WorkspaceID: "ws-1",
			Method:      "turn/started",
			Seq:         uint64(index + 1),
			TS:          time.Now().UTC(),
		})
	}

	droppedEvent := store.EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/agentMessage/delta",
		Seq:         777,
		Payload:     map[string]any{"delta": "lost"},
		TS:          time.Now().UTC(),
	}
	result := sub.enqueue(droppedEvent)
	if !result.dropped || result.reason != dropReasonSoft {
		t.Fatalf("expected soft dropped result, got %#v", result)
	}

	controlEvent := buildWorkspaceEventsDroppedEvent(result.droppedEvent, sub, result.reason)
	if !sub.enqueueDroppedControlEvent(controlEvent) {
		t.Fatal("expected dropped control event to be enqueued")
	}
	if len(sub.queue) != subscriberQueueSoftLimit+1 {
		t.Fatalf("expected control event to be appended past soft limit, got queue len %d", len(sub.queue))
	}

	queuedControl := sub.queue[len(sub.queue)-1]
	if queuedControl.Method != "workspace/events/dropped" {
		t.Fatalf("expected dropped control event, got %q", queuedControl.Method)
	}
	if queuedControl.Seq != 0 {
		t.Fatalf("expected dropped control event to remain unsequenced, got seq %d", queuedControl.Seq)
	}
	payload, ok := queuedControl.Payload.(map[string]any)
	if !ok {
		t.Fatalf("expected dropped control payload map, got %#v", queuedControl.Payload)
	}
	if payload["droppedMethod"] != "item/agentMessage/delta" || payload["reason"] != string(dropReasonSoft) {
		t.Fatalf("unexpected dropped control payload %#v", payload)
	}
	if payload["seq"] != uint64(777) || payload["fromSeq"] != uint64(777) || payload["toSeq"] != uint64(777) {
		t.Fatalf("expected dropped control seq coverage 777, got %#v", payload)
	}
}

func TestSubscriberMergesRepeatedDroppedControlEvents(t *testing.T) {
	t.Parallel()

	sub := &subscriber{
		id:                100,
		scope:             "workspace",
		source:            "test.workspace_stream",
		role:              "workspace-stream",
		out:               make(chan store.EventEnvelope, subscriberOutputBufferSize),
		notify:            make(chan struct{}, 1),
		done:              make(chan struct{}),
		queue:             make([]store.EventEnvelope, 0, subscriberQueueHardLimit),
		coalescedByMethod: make(map[string]int),
	}

	for index := 0; index < subscriberQueueSoftLimit; index++ {
		sub.queue = append(sub.queue, store.EventEnvelope{
			WorkspaceID: "ws-1",
			Method:      "turn/started",
			Seq:         uint64(index + 1),
			TS:          time.Now().UTC(),
		})
	}

	for index := 0; index < 3; index++ {
		droppedEvent := store.EventEnvelope{
			WorkspaceID: "ws-1",
			ThreadID:    "thread-1",
			TurnID:      "turn-1",
			Method:      "item/agentMessage/delta",
			Seq:         uint64(800 + index),
			Payload:     map[string]any{"delta": "lost"},
			TS:          time.Now().UTC(),
		}
		result := sub.enqueue(droppedEvent)
		if !result.dropped || result.reason != dropReasonSoft {
			t.Fatalf("expected soft dropped result at index %d, got %#v", index, result)
		}

		controlEvent := buildWorkspaceEventsDroppedEvent(result.droppedEvent, sub, result.reason)
		if !sub.enqueueDroppedControlEvent(controlEvent) {
			t.Fatalf("expected dropped control event to be enqueued or merged at index %d", index)
		}
	}

	if len(sub.queue) != subscriberQueueSoftLimit+1 {
		t.Fatalf("expected repeated dropped control events to be merged, got queue len %d", len(sub.queue))
	}

	queuedControl := sub.queue[len(sub.queue)-1]
	if queuedControl.Method != "workspace/events/dropped" {
		t.Fatalf("expected dropped control event, got %q", queuedControl.Method)
	}
	payload, ok := queuedControl.Payload.(map[string]any)
	if !ok {
		t.Fatalf("expected dropped control payload map, got %#v", queuedControl.Payload)
	}
	if payload["dropCount"] != 3 {
		t.Fatalf("expected merged dropCount 3, got %#v", payload["dropCount"])
	}
}

func TestSubscriberTracksHardEvictionBreakdown(t *testing.T) {
	t.Parallel()

	sub := &subscriber{
		out:               make(chan store.EventEnvelope, subscriberOutputBufferSize),
		notify:            make(chan struct{}, 1),
		done:              make(chan struct{}),
		queue:             make([]store.EventEnvelope, 0, subscriberQueueHardLimit),
		coalescedByMethod: make(map[string]int),
	}

	sub.queue = append(sub.queue, store.EventEnvelope{
		WorkspaceID: "ws-1",
		Method:      "item/agentMessage/delta",
		Payload:     map[string]any{"delta": "old"},
		TS:          time.Now().UTC(),
	})
	for index := 1; index < subscriberQueueHardLimit; index++ {
		sub.queue = append(sub.queue, store.EventEnvelope{
			WorkspaceID: "ws-1",
			Method:      "turn/started",
			Payload:     map[string]any{"index": index},
			TS:          time.Now().UTC(),
		})
	}

	result := sub.enqueue(store.EventEnvelope{
		WorkspaceID: "ws-1",
		Method:      "server/request/resolved",
		Payload:     map[string]any{"requestId": "req-1"},
		TS:          time.Now().UTC(),
	})
	if result.dropped {
		t.Fatal("expected hard-limit eviction to preserve incoming critical event")
	}
	if sub.hardEvictedCount != 1 || sub.droppedCount != 1 {
		t.Fatalf("expected eviction/dropped counts 1/1, got %d/%d", sub.hardEvictedCount, sub.droppedCount)
	}
	if len(sub.queue) != subscriberQueueHardLimit {
		t.Fatalf("expected queue length to remain at hard limit, got %d", len(sub.queue))
	}
	if sub.queue[len(sub.queue)-1].Method != "server/request/resolved" {
		t.Fatalf("expected incoming critical event to stay queued, got %q", sub.queue[len(sub.queue)-1].Method)
	}
}

func TestHubMayDropDroppableEventsButPreservesLaterCriticalEvent(t *testing.T) {
	t.Parallel()

	hub := NewHub()
	eventsCh, cancel := hub.Subscribe("ws-1")
	defer cancel()

	for index := 0; index < subscriberOutputBufferSize+subscriberQueueHardLimit+64; index++ {
		hub.Publish(store.EventEnvelope{
			WorkspaceID: "ws-1",
			Method:      "item/agentMessage/delta",
			Payload: map[string]any{
				"index": index,
			},
			TS: time.Now().UTC(),
		})
	}

	hub.Publish(store.EventEnvelope{
		WorkspaceID: "ws-1",
		Method:      "server/request/resolved",
		Payload: map[string]any{
			"requestId": "req-1",
		},
		TS: time.Now().UTC(),
	})

	receivedCritical := false
	deadline := time.After(2 * time.Second)
	for !receivedCritical {
		select {
		case event, ok := <-eventsCh:
			if !ok {
				t.Fatal("expected subscriber channel to remain open")
			}
			if event.Method == "server/request/resolved" {
				receivedCritical = true
			}
		case <-deadline:
			t.Fatal("timed out waiting for critical event")
		}
	}
}

func TestHubSnapshotReportsWorkspaceAndGlobalSubscriberStats(t *testing.T) {
	t.Parallel()

	hub := NewHub()
	hub.AttachStore(&testHubStore{
		headSeqByWorkspace: map[string]uint64{
			"ws-a": 42,
			"ws-b": 7,
		},
	})

	wsAEvents, cancelA := hub.SubscribeWithSource("ws-a", "test.ws_a", "workspace-stream")
	defer cancelA()
	_, cancelB := hub.SubscribeWithSource("ws-b", "test.ws_b", "workspace-worker")
	defer cancelB()
	globalEvents, cancelGlobal := hub.SubscribeAllWithSource("test.global", "global-worker")
	defer cancelGlobal()

	for index := 0; index < subscriberOutputBufferSize; index++ {
		hub.Publish(store.EventEnvelope{
			WorkspaceID: "ws-a",
			Method:      "turn/prefill",
			Payload: map[string]any{
				"index": index,
			},
			TS: time.Now().UTC(),
		})
	}

	prefillDeadline := time.Now().Add(2 * time.Second)
	for len(wsAEvents) < subscriberOutputBufferSize || len(globalEvents) < subscriberOutputBufferSize {
		if time.Now().After(prefillDeadline) {
			t.Fatalf(
				"timed out waiting for prefill events to fill output buffers: wsA=%d global=%d",
				len(wsAEvents),
				len(globalEvents),
			)
		}
		time.Sleep(time.Millisecond)
	}

	hub.Publish(store.EventEnvelope{
		WorkspaceID: "ws-a",
		ThreadID:    "thread-1",
		Method:      "turn/started",
		Seq:         41,
		Payload:     map[string]any{"status": "running"},
		TS:          time.Now().UTC(),
	})
	hub.Publish(store.EventEnvelope{
		WorkspaceID: "ws-a",
		ThreadID:    "thread-1",
		Method:      "command/exec/outputDelta",
		Seq:         42,
		Payload: map[string]any{
			"deltaText": "hello ",
			"processId": "proc-1",
			"stream":    "stdout",
		},
		TS: time.Now().UTC(),
	})
	hub.Publish(store.EventEnvelope{
		WorkspaceID: "ws-a",
		ThreadID:    "thread-1",
		Method:      "command/exec/outputDelta",
		Seq:         43,
		Payload: map[string]any{
			"deltaText": "world",
			"processId": "proc-1",
			"stream":    "stdout",
		},
		TS: time.Now().UTC(),
	})

	for index := 0; index < subscriberOutputBufferSize+subscriberQueueSoftLimit+16; index++ {
		hub.Publish(store.EventEnvelope{
			WorkspaceID: "ws-b",
			Method:      "item/agentMessage/delta",
			Seq:         uint64(index + 1),
			Payload: map[string]any{
				"index": index,
			},
			TS: time.Now().UTC(),
		})
	}

	deadline := time.After(2 * time.Second)
	for received := 0; received < 2; {
		select {
		case <-wsAEvents:
			received += 1
		case <-globalEvents:
			received += 1
		case <-deadline:
			t.Fatal("timed out waiting for subscribed events to reach output buffers")
		}
	}

	snapshot := hub.Snapshot()
	if snapshot.WorkspaceCount != 2 {
		t.Fatalf("expected 2 workspaces in snapshot, got %d", snapshot.WorkspaceCount)
	}
	if snapshot.WorkspaceSubscriberCount != 2 {
		t.Fatalf("expected 2 workspace subscribers, got %d", snapshot.WorkspaceSubscriberCount)
	}
	if snapshot.GlobalSubscriberCount != 1 {
		t.Fatalf("expected 1 global subscriber, got %d", snapshot.GlobalSubscriberCount)
	}
	if snapshot.TotalSubscriberCount != 3 {
		t.Fatalf("expected 3 total subscribers, got %d", snapshot.TotalSubscriberCount)
	}
	if len(snapshot.GlobalSubscribers) != 1 {
		t.Fatalf("expected 1 global subscriber snapshot, got %d", len(snapshot.GlobalSubscribers))
	}
	if snapshot.TotalDroppedCount == 0 {
		t.Fatal("expected snapshot to report dropped droppable events under backpressure")
	}
	if snapshot.TotalMergedCount == 0 {
		t.Fatal("expected snapshot to report merged command output deltas")
	}
	if snapshot.TotalSoftDroppedCount == 0 {
		t.Fatal("expected snapshot to report soft droppable drops")
	}
	if snapshot.TotalCoalescedCommandOutputBytes != len("world")*2 {
		t.Fatalf("expected total coalesced command output bytes %d, got %d", len("world")*2, snapshot.TotalCoalescedCommandOutputBytes)
	}
	if snapshot.TotalCoalescedByMethod["command/exec/outputDelta"] == 0 {
		t.Fatal("expected snapshot to report command output coalesce counts by method")
	}

	if len(snapshot.Workspaces) != 2 {
		t.Fatalf("expected 2 workspace snapshots, got %d", len(snapshot.Workspaces))
	}
	if snapshot.Workspaces[0].WorkspaceID != "ws-a" || snapshot.Workspaces[1].WorkspaceID != "ws-b" {
		t.Fatalf("expected workspace snapshots sorted by id, got %#v", snapshot.Workspaces)
	}

	wsA := snapshot.Workspaces[0]
	if wsA.HeadSeq != 42 {
		t.Fatalf("expected ws-a head seq 42, got %d", wsA.HeadSeq)
	}
	if wsA.SubscriberCount != 1 || len(wsA.Subscribers) != 1 {
		t.Fatalf("expected single ws-a subscriber snapshot, got %d / %d", wsA.SubscriberCount, len(wsA.Subscribers))
	}
	if wsA.Subscribers[0].MergedCount == 0 {
		t.Fatal("expected ws-a subscriber merged count to be tracked")
	}
	if wsA.Subscribers[0].Scope != "workspace" || wsA.Subscribers[0].Source != "test.ws_a" || wsA.Subscribers[0].Role != "workspace-stream" {
		t.Fatalf("expected ws-a subscriber scope/source/role to be preserved, got %#v", wsA.Subscribers[0])
	}
	if wsA.Subscribers[0].CoalescedCommandOutputBytes != len("world") {
		t.Fatalf("expected ws-a coalesced command output bytes %d, got %d", len("world"), wsA.Subscribers[0].CoalescedCommandOutputBytes)
	}
	if wsA.Subscribers[0].CoalescedByMethod["command/exec/outputDelta"] != 1 {
		t.Fatalf("expected ws-a coalesced by method count 1, got %d", wsA.Subscribers[0].CoalescedByMethod["command/exec/outputDelta"])
	}
	if wsA.Subscribers[0].LastMethod != "command/exec/outputDelta" {
		t.Fatalf("expected ws-a last method to be command output delta, got %q", wsA.Subscribers[0].LastMethod)
	}
	if wsA.Subscribers[0].LastSeq != 43 {
		t.Fatalf("expected ws-a last seq 43, got %d", wsA.Subscribers[0].LastSeq)
	}
	if wsA.Subscribers[0].LastQueuedAt == nil {
		t.Fatal("expected ws-a last queued timestamp to be set")
	}
	if wsA.Subscribers[0].LastMergedAt == nil {
		t.Fatal("expected ws-a last merged timestamp to be set")
	}
	if wsA.Subscribers[0].LastDequeuedAt == nil {
		t.Fatal("expected ws-a last dequeued timestamp to be set after draining from output")
	}

	wsB := snapshot.Workspaces[1]
	if wsB.HeadSeq != 7 {
		t.Fatalf("expected ws-b head seq 7, got %d", wsB.HeadSeq)
	}
	if wsB.SubscriberCount != 1 || len(wsB.Subscribers) != 1 {
		t.Fatalf("expected single ws-b subscriber snapshot, got %d / %d", wsB.SubscriberCount, len(wsB.Subscribers))
	}
	if wsB.Subscribers[0].DroppedCount == 0 {
		t.Fatal("expected ws-b subscriber dropped count to be tracked")
	}
	if wsB.Subscribers[0].Scope != "workspace" || wsB.Subscribers[0].Source != "test.ws_b" || wsB.Subscribers[0].Role != "workspace-worker" {
		t.Fatalf("expected ws-b subscriber scope/source/role to be preserved, got %#v", wsB.Subscribers[0])
	}
	if wsB.Subscribers[0].SoftDroppedCount == 0 {
		t.Fatal("expected ws-b soft dropped count to be tracked")
	}
	if wsB.Subscribers[0].LastDroppedAt == nil {
		t.Fatal("expected ws-b last dropped timestamp to be set")
	}
	if snapshot.GlobalSubscribers[0].Scope != "global" || snapshot.GlobalSubscribers[0].Source != "test.global" || snapshot.GlobalSubscribers[0].Role != "global-worker" {
		t.Fatalf("expected global subscriber scope/source/role to be preserved, got %#v", snapshot.GlobalSubscribers[0])
	}
}
