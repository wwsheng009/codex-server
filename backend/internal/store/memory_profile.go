package store

import (
	"encoding/json"
	"io"
	"sort"
	"strings"
)

type MemoryInspection struct {
	Counts          MemoryEntityCounts            `json:"counts"`
	SerializedBytes MemorySerializedBytes         `json:"serializedBytes"`
	Threads         ThreadProjectionMemoryProfile `json:"threads"`
}

type MemoryEntityCounts struct {
	Workspaces          int `json:"workspaces"`
	CommandSessions     int `json:"commandSessions"`
	Automations         int `json:"automations"`
	AutomationTemplates int `json:"automationTemplates"`
	AutomationRuns      int `json:"automationRuns"`
	Notifications       int `json:"notifications"`
	TurnPolicyDecisions int `json:"turnPolicyDecisions"`
	Bots                int `json:"bots"`
	BotBindings         int `json:"botBindings"`
	ThreadBotBindings   int `json:"threadBotBindings"`
	BotTriggers         int `json:"botTriggers"`
	BotConnections      int `json:"botConnections"`
	BotConnectionLogs   int `json:"botConnectionLogs"`
	WeChatAccounts      int `json:"weChatAccounts"`
	BotConversations    int `json:"botConversations"`
	BotDeliveryTargets  int `json:"botDeliveryTargets"`
	BotInbound          int `json:"botInbound"`
	BotOutbound         int `json:"botOutbound"`
	Threads             int `json:"threads"`
	ThreadProjections   int `json:"threadProjections"`
	DeletedThreads      int `json:"deletedThreads"`
	Approvals           int `json:"approvals"`
}

type MemorySerializedBytes struct {
	RuntimePreferences  int64 `json:"runtimePreferences"`
	Workspaces          int64 `json:"workspaces"`
	CommandSessions     int64 `json:"commandSessions"`
	Automations         int64 `json:"automations"`
	AutomationTemplates int64 `json:"automationTemplates"`
	AutomationRuns      int64 `json:"automationRuns"`
	Notifications       int64 `json:"notifications"`
	TurnPolicyDecisions int64 `json:"turnPolicyDecisions"`
	Bots                int64 `json:"bots"`
	BotBindings         int64 `json:"botBindings"`
	ThreadBotBindings   int64 `json:"threadBotBindings"`
	BotTriggers         int64 `json:"botTriggers"`
	BotConnections      int64 `json:"botConnections"`
	BotConnectionLogs   int64 `json:"botConnectionLogs"`
	WeChatAccounts      int64 `json:"weChatAccounts"`
	BotConversations    int64 `json:"botConversations"`
	BotDeliveryTargets  int64 `json:"botDeliveryTargets"`
	BotInbound          int64 `json:"botInbound"`
	BotOutbound         int64 `json:"botOutbound"`
	Threads             int64 `json:"threads"`
	ThreadProjections   int64 `json:"threadProjections"`
	DeletedThreads      int64 `json:"deletedThreads"`
	Approvals           int64 `json:"approvals"`
	Total               int64 `json:"total"`
}

type ThreadProjectionMemoryProfile struct {
	ProjectionCount             int                             `json:"projectionCount"`
	HotProjectionCount          int                             `json:"hotProjectionCount"`
	ColdProjectionCount         int                             `json:"coldProjectionCount"`
	ExternalizedProjectionCount int                             `json:"externalizedProjectionCount"`
	ResidentTurnsBytes          int64                           `json:"residentTurnsBytes"`
	ResidentRawTurnsBytes       int64                           `json:"residentRawTurnsBytes"`
	ResidentCompressedBytes     int64                           `json:"residentCompressedBytes"`
	TurnCount                   int                             `json:"turnCount"`
	ItemCount                   int                             `json:"itemCount"`
	ItemBytes                   int64                           `json:"itemBytes"`
	ItemTypes                   []ThreadProjectionItemTypeStat  `json:"itemTypes"`
	Largest                     []ThreadProjectionMemoryHotspot `json:"largest"`
}

type threadProjectionStats struct {
	ItemCount int                            `json:"itemCount,omitempty"`
	ItemBytes int64                          `json:"itemBytes,omitempty"`
	ItemTypes []ThreadProjectionItemTypeStat `json:"itemTypes,omitempty"`
}

type ThreadProjectionItemTypeStat struct {
	Type       string `json:"type"`
	Count      int    `json:"count"`
	TotalBytes int64  `json:"totalBytes"`
}

type ThreadProjectionMemoryHotspot struct {
	WorkspaceID string `json:"workspaceId"`
	ThreadID    string `json:"threadId"`
	TurnCount   int    `json:"turnCount"`
	ItemCount   int    `json:"itemCount"`
	ItemBytes   int64  `json:"itemBytes"`
	JSONBytes   int64  `json:"jsonBytes"`
	PreviewLen  int    `json:"previewLen"`
}

func (s *MemoryStore) InspectMemory(limit int) MemoryInspection {
	limit = normalizeMemoryInspectionLimit(limit)

	s.mu.RLock()
	if s.inspectionCacheValid {
		inspection := cloneMemoryInspectionWithLimit(s.inspectionCache, limit)
		s.mu.RUnlock()
		return inspection
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.inspectionCacheValid {
		return cloneMemoryInspectionWithLimit(s.inspectionCache, limit)
	}

	inspection := s.buildMemoryInspectionLocked()
	s.inspectionCache = inspection
	s.inspectionCacheValid = true
	return cloneMemoryInspectionWithLimit(inspection, limit)
}

func normalizeMemoryInspectionLimit(limit int) int {
	if limit <= 0 {
		return 10
	}
	if limit > 50 {
		return 50
	}
	return limit
}

func (s *MemoryStore) invalidateMemoryInspectionLocked() {
	s.inspectionCache = MemoryInspection{}
	s.inspectionCacheValid = false
}

func (s *MemoryStore) buildMemoryInspectionLocked() MemoryInspection {
	inspection := MemoryInspection{
		Counts: MemoryEntityCounts{
			Workspaces:          len(s.workspaces),
			Automations:         len(s.automations),
			AutomationTemplates: len(s.templates),
			AutomationRuns:      len(s.runs),
			Notifications:       len(s.notifications),
			TurnPolicyDecisions: len(s.turnPolicyDecisions),
			Bots:                len(s.bots),
			BotBindings:         len(s.botBindings),
			ThreadBotBindings:   len(s.threadBotBindings),
			BotTriggers:         len(s.botTriggers),
			BotConnections:      len(s.botConnections),
			WeChatAccounts:      len(s.wechatAccounts),
			BotConversations:    len(s.botConversations),
			BotDeliveryTargets:  len(s.botDeliveryTargets),
			BotInbound:          len(s.botInbound),
			BotOutbound:         len(s.botOutbound),
			Threads:             len(s.threads),
			ThreadProjections:   len(s.projections),
			DeletedThreads:      len(s.deleted),
			Approvals:           len(s.approvals),
		},
		SerializedBytes: MemorySerializedBytes{
			RuntimePreferences: encodedJSONSize(s.runtimePrefs),
		},
		Threads: ThreadProjectionMemoryProfile{
			ProjectionCount: len(s.projections),
			Largest:         make([]ThreadProjectionMemoryHotspot, 0, len(s.projections)),
		},
	}

	for _, workspace := range s.workspaces {
		inspection.SerializedBytes.Workspaces += encodedJSONSize(workspace)
	}
	for _, workspaceSessions := range s.commandSessions {
		for _, session := range workspaceSessions {
			inspection.Counts.CommandSessions += 1
			inspection.SerializedBytes.CommandSessions += encodedJSONSize(session)
		}
	}
	for _, automation := range s.automations {
		inspection.SerializedBytes.Automations += encodedJSONSize(automation)
	}
	for _, template := range s.templates {
		inspection.SerializedBytes.AutomationTemplates += encodedJSONSize(template)
	}
	for _, run := range s.runs {
		inspection.SerializedBytes.AutomationRuns += encodedJSONSize(run)
	}
	for _, notification := range s.notifications {
		inspection.SerializedBytes.Notifications += encodedJSONSize(notification)
	}
	for _, decision := range s.turnPolicyDecisions {
		inspection.SerializedBytes.TurnPolicyDecisions += encodedJSONSize(decision)
	}
	for _, bot := range s.bots {
		inspection.SerializedBytes.Bots += encodedJSONSize(bot)
	}
	for _, binding := range s.botBindings {
		inspection.SerializedBytes.BotBindings += encodedJSONSize(binding)
	}
	for _, binding := range s.threadBotBindings {
		inspection.SerializedBytes.ThreadBotBindings += encodedJSONSize(binding)
	}
	for _, trigger := range s.botTriggers {
		inspection.SerializedBytes.BotTriggers += encodedJSONSize(trigger)
	}
	for _, connection := range s.botConnections {
		inspection.SerializedBytes.BotConnections += encodedJSONSize(connection)
	}
	for _, logs := range s.botConnectionLogs {
		inspection.Counts.BotConnectionLogs += len(logs)
		for _, entry := range logs {
			inspection.SerializedBytes.BotConnectionLogs += encodedJSONSize(entry)
		}
	}
	for _, account := range s.wechatAccounts {
		inspection.SerializedBytes.WeChatAccounts += encodedJSONSize(account)
	}
	for _, conversation := range s.botConversations {
		inspection.SerializedBytes.BotConversations += encodedJSONSize(conversation)
	}
	for _, target := range s.botDeliveryTargets {
		inspection.SerializedBytes.BotDeliveryTargets += encodedJSONSize(target)
	}
	for _, delivery := range s.botInbound {
		inspection.SerializedBytes.BotInbound += encodedJSONSize(delivery)
	}
	for _, delivery := range s.botOutbound {
		inspection.SerializedBytes.BotOutbound += encodedJSONSize(delivery)
	}
	for _, thread := range s.threads {
		inspection.SerializedBytes.Threads += encodedJSONSize(thread)
	}

	itemTypes := make(map[string]*ThreadProjectionItemTypeStat)
	for _, projection := range s.projections {
		projectionBytes := threadProjectionSnapshotBytesForInspection(projection)
		inspection.SerializedBytes.ThreadProjections += projectionBytes
		switch {
		case projection.Projection.Turns != nil:
			inspection.Threads.HotProjectionCount += 1
			residentBytes := int64(len(encodeThreadProjectionTurns(projection.Projection.Turns)))
			inspection.Threads.ResidentTurnsBytes += residentBytes
			inspection.Threads.ResidentRawTurnsBytes += residentBytes
		case projection.TurnsPath != "":
			inspection.Threads.ColdProjectionCount += 1
			inspection.Threads.ExternalizedProjectionCount += 1
		case len(projection.TurnsCompressed) > 0:
			inspection.Threads.ColdProjectionCount += 1
			residentBytes := int64(len(projection.TurnsCompressed))
			inspection.Threads.ResidentTurnsBytes += residentBytes
			inspection.Threads.ResidentCompressedBytes += residentBytes
		default:
			inspection.Threads.ColdProjectionCount += 1
			residentBytes := int64(len(normalizeThreadProjectionRawJSON(projection.TurnsRaw)))
			inspection.Threads.ResidentTurnsBytes += residentBytes
			inspection.Threads.ResidentRawTurnsBytes += residentBytes
		}

		stats := projection.Stats
		turnCount := projection.Projection.TurnCount
		if projection.Projection.Turns != nil && projection.StatsDirty {
			computedTurnCount, _, computedStats := summarizeThreadProjectionTurns(projection.Projection.Turns)
			if turnCount == 0 {
				turnCount = computedTurnCount
			}
			stats = computedStats
		} else if threadProjectionStatsIsZero(stats) {
			computedTurnCount, _, computedStats, err := summarizeThreadProjectionRecord(projection)
			if err == nil {
				if turnCount == 0 {
					turnCount = computedTurnCount
				}
				stats = computedStats
			}
		}
		if turnCount == 0 && projection.Projection.Turns != nil {
			turnCount = len(projection.Projection.Turns)
		}
		inspection.Threads.TurnCount += turnCount
		inspection.Threads.ItemCount += stats.ItemCount
		inspection.Threads.ItemBytes += stats.ItemBytes
		for _, stat := range stats.ItemTypes {
			aggregate := itemTypes[stat.Type]
			if aggregate == nil {
				aggregate = &ThreadProjectionItemTypeStat{Type: stat.Type}
				itemTypes[stat.Type] = aggregate
			}
			aggregate.Count += stat.Count
			aggregate.TotalBytes += stat.TotalBytes
		}
		inspection.Threads.Largest = append(inspection.Threads.Largest, ThreadProjectionMemoryHotspot{
			WorkspaceID: projection.Projection.WorkspaceID,
			ThreadID:    projection.Projection.ThreadID,
			TurnCount:   turnCount,
			ItemCount:   stats.ItemCount,
			ItemBytes:   stats.ItemBytes,
			JSONBytes:   projectionBytes,
			PreviewLen:  len(projection.Projection.Preview),
		})
	}

	for _, deleted := range s.deleted {
		inspection.SerializedBytes.DeletedThreads += encodedJSONSize(deleted)
	}
	for _, approval := range s.approvals {
		inspection.SerializedBytes.Approvals += encodedJSONSize(approval)
	}

	inspection.SerializedBytes.Total =
		inspection.SerializedBytes.RuntimePreferences +
			inspection.SerializedBytes.Workspaces +
			inspection.SerializedBytes.CommandSessions +
			inspection.SerializedBytes.Automations +
			inspection.SerializedBytes.AutomationTemplates +
			inspection.SerializedBytes.AutomationRuns +
			inspection.SerializedBytes.Notifications +
			inspection.SerializedBytes.TurnPolicyDecisions +
			inspection.SerializedBytes.Bots +
			inspection.SerializedBytes.BotBindings +
			inspection.SerializedBytes.ThreadBotBindings +
			inspection.SerializedBytes.BotTriggers +
			inspection.SerializedBytes.BotConnections +
			inspection.SerializedBytes.BotConnectionLogs +
			inspection.SerializedBytes.WeChatAccounts +
			inspection.SerializedBytes.BotConversations +
			inspection.SerializedBytes.BotDeliveryTargets +
			inspection.SerializedBytes.BotInbound +
			inspection.SerializedBytes.BotOutbound +
			inspection.SerializedBytes.Threads +
			inspection.SerializedBytes.ThreadProjections +
			inspection.SerializedBytes.DeletedThreads +
			inspection.SerializedBytes.Approvals

	inspection.Threads.ItemTypes = make([]ThreadProjectionItemTypeStat, 0, len(itemTypes))
	for _, stat := range itemTypes {
		inspection.Threads.ItemTypes = append(inspection.Threads.ItemTypes, *stat)
	}
	sort.Slice(inspection.Threads.ItemTypes, func(i int, j int) bool {
		if inspection.Threads.ItemTypes[i].TotalBytes == inspection.Threads.ItemTypes[j].TotalBytes {
			if inspection.Threads.ItemTypes[i].Count == inspection.Threads.ItemTypes[j].Count {
				return inspection.Threads.ItemTypes[i].Type < inspection.Threads.ItemTypes[j].Type
			}
			return inspection.Threads.ItemTypes[i].Count > inspection.Threads.ItemTypes[j].Count
		}
		return inspection.Threads.ItemTypes[i].TotalBytes > inspection.Threads.ItemTypes[j].TotalBytes
	})

	sort.Slice(inspection.Threads.Largest, func(i int, j int) bool {
		if inspection.Threads.Largest[i].JSONBytes == inspection.Threads.Largest[j].JSONBytes {
			if inspection.Threads.Largest[i].ItemBytes == inspection.Threads.Largest[j].ItemBytes {
				if inspection.Threads.Largest[i].WorkspaceID == inspection.Threads.Largest[j].WorkspaceID {
					return inspection.Threads.Largest[i].ThreadID < inspection.Threads.Largest[j].ThreadID
				}
				return inspection.Threads.Largest[i].WorkspaceID < inspection.Threads.Largest[j].WorkspaceID
			}
			return inspection.Threads.Largest[i].ItemBytes > inspection.Threads.Largest[j].ItemBytes
		}
		return inspection.Threads.Largest[i].JSONBytes > inspection.Threads.Largest[j].JSONBytes
	})

	return inspection
}

func cloneMemoryInspectionWithLimit(inspection MemoryInspection, limit int) MemoryInspection {
	cloned := MemoryInspection{
		Counts:          inspection.Counts,
		SerializedBytes: inspection.SerializedBytes,
		Threads: ThreadProjectionMemoryProfile{
			ProjectionCount:             inspection.Threads.ProjectionCount,
			HotProjectionCount:          inspection.Threads.HotProjectionCount,
			ColdProjectionCount:         inspection.Threads.ColdProjectionCount,
			ExternalizedProjectionCount: inspection.Threads.ExternalizedProjectionCount,
			ResidentTurnsBytes:          inspection.Threads.ResidentTurnsBytes,
			ResidentRawTurnsBytes:       inspection.Threads.ResidentRawTurnsBytes,
			ResidentCompressedBytes:     inspection.Threads.ResidentCompressedBytes,
			TurnCount:                   inspection.Threads.TurnCount,
			ItemCount:                   inspection.Threads.ItemCount,
			ItemBytes:                   inspection.Threads.ItemBytes,
			ItemTypes:                   cloneThreadProjectionItemTypeStats(inspection.Threads.ItemTypes),
			Largest:                     cloneThreadProjectionMemoryHotspots(inspection.Threads.Largest),
		},
	}
	if limit = normalizeMemoryInspectionLimit(limit); len(cloned.Threads.Largest) > limit {
		cloned.Threads.Largest = cloned.Threads.Largest[:limit]
	}
	return cloned
}

func cloneThreadProjectionMemoryHotspots(hotspots []ThreadProjectionMemoryHotspot) []ThreadProjectionMemoryHotspot {
	if len(hotspots) == 0 {
		return nil
	}
	cloned := make([]ThreadProjectionMemoryHotspot, len(hotspots))
	copy(cloned, hotspots)
	return cloned
}

type countingWriter struct {
	count int64
}

func (w *countingWriter) Write(p []byte) (int, error) {
	w.count += int64(len(p))
	return len(p), nil
}

func encodedJSONSize(value any) int64 {
	writer := &countingWriter{}
	encoder := json.NewEncoder(writer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return 0
	}
	if writer.count > 0 {
		return writer.count - 1
	}
	return 0
}

func memoryProjectionItemType(item map[string]any) string {
	if value := strings.TrimSpace(stringValue(item["type"])); value != "" {
		return value
	}
	if value := strings.TrimSpace(stringValue(item["kind"])); value != "" {
		return value
	}
	if value := strings.TrimSpace(stringValue(item["role"])); value != "" {
		return "role:" + value
	}
	return "(empty)"
}

func cloneThreadProjectionStats(stats threadProjectionStats) threadProjectionStats {
	return threadProjectionStats{
		ItemCount: stats.ItemCount,
		ItemBytes: stats.ItemBytes,
		ItemTypes: cloneThreadProjectionItemTypeStats(stats.ItemTypes),
	}
}

func cloneThreadProjectionStatsPtr(stats threadProjectionStats) *threadProjectionStats {
	if threadProjectionStatsIsZero(stats) {
		return nil
	}
	cloned := cloneThreadProjectionStats(stats)
	return &cloned
}

func cloneThreadProjectionItemTypeStats(stats []ThreadProjectionItemTypeStat) []ThreadProjectionItemTypeStat {
	if len(stats) == 0 {
		return nil
	}
	cloned := make([]ThreadProjectionItemTypeStat, len(stats))
	copy(cloned, stats)
	return cloned
}

func normalizeThreadProjectionItemTypeStats(stats []ThreadProjectionItemTypeStat) []ThreadProjectionItemTypeStat {
	if len(stats) == 0 {
		return nil
	}
	merged := make(map[string]*ThreadProjectionItemTypeStat, len(stats))
	for _, stat := range stats {
		itemType := strings.TrimSpace(stat.Type)
		if itemType == "" {
			itemType = "unknown"
		}
		entry := merged[itemType]
		if entry == nil {
			entry = &ThreadProjectionItemTypeStat{Type: itemType}
			merged[itemType] = entry
		}
		if stat.Count > 0 {
			entry.Count += stat.Count
		}
		if stat.TotalBytes > 0 {
			entry.TotalBytes += stat.TotalBytes
		}
	}
	normalized := make([]ThreadProjectionItemTypeStat, 0, len(merged))
	for _, stat := range merged {
		normalized = append(normalized, *stat)
	}
	sort.Slice(normalized, func(i int, j int) bool {
		return normalized[i].Type < normalized[j].Type
	})
	return normalized
}

func normalizeThreadProjectionStats(stats *threadProjectionStats) threadProjectionStats {
	if stats == nil {
		return threadProjectionStats{}
	}
	normalized := threadProjectionStats{
		ItemCount: stats.ItemCount,
		ItemBytes: stats.ItemBytes,
		ItemTypes: normalizeThreadProjectionItemTypeStats(stats.ItemTypes),
	}
	if normalized.ItemCount < 0 {
		normalized.ItemCount = 0
	}
	if normalized.ItemBytes < 0 {
		normalized.ItemBytes = 0
	}
	return normalized
}

func threadProjectionStatsIsZero(stats threadProjectionStats) bool {
	return stats.ItemCount == 0 && stats.ItemBytes == 0 && len(stats.ItemTypes) == 0
}

func threadProjectionStatsEqual(left threadProjectionStats, right threadProjectionStats) bool {
	if left.ItemCount != right.ItemCount || left.ItemBytes != right.ItemBytes || len(left.ItemTypes) != len(right.ItemTypes) {
		return false
	}
	for index := range left.ItemTypes {
		if left.ItemTypes[index] != right.ItemTypes[index] {
			return false
		}
	}
	return true
}

func summarizeThreadProjectionTurns(turns []ThreadTurn) (int, int, threadProjectionStats) {
	itemTypes := make(map[string]*ThreadProjectionItemTypeStat)
	stats := threadProjectionStats{}
	messageCount := 0
	for _, turn := range turns {
		messageCount += summarizeThreadProjectionTurn(turn, &stats, itemTypes)
	}
	stats.ItemTypes = flattenThreadProjectionItemTypes(itemTypes)
	return len(turns), messageCount, stats
}

func summarizeThreadProjectionRecord(record threadProjectionRecord) (int, int, threadProjectionStats, error) {
	if record.Projection.Turns != nil {
		turnCount, messageCount, stats := summarizeThreadProjectionTurns(record.Projection.Turns)
		return turnCount, messageCount, stats, nil
	}
	if record.TurnsManifest != nil {
		turnCount, messageCount, stats := summarizeThreadProjectionTurns(
			decodeThreadProjectionTurns(readThreadProjectionTurnsSidecar(record.TurnsPath, record.TurnsManifest)),
		)
		return turnCount, messageCount, stats, nil
	}

	reader, err := threadProjectionTurnsReadCloser(record)
	if err != nil {
		return 0, 0, threadProjectionStats{}, err
	}
	defer reader.Close()

	return summarizeThreadProjectionTurnsReader(reader)
}

func summarizeThreadProjectionTurnsReader(reader io.Reader) (int, int, threadProjectionStats, error) {
	decoder := json.NewDecoder(reader)
	startToken, err := decoder.Token()
	if err != nil {
		return 0, 0, threadProjectionStats{}, err
	}
	startDelim, ok := startToken.(json.Delim)
	if !ok || startDelim != '[' {
		return 0, 0, threadProjectionStats{}, nil
	}

	itemTypes := make(map[string]*ThreadProjectionItemTypeStat)
	stats := threadProjectionStats{}
	turnCount := 0
	messageCount := 0
	for decoder.More() {
		var turn ThreadTurn
		if err := decoder.Decode(&turn); err != nil {
			return 0, 0, threadProjectionStats{}, err
		}
		turnCount += 1
		messageCount += summarizeThreadProjectionTurn(turn, &stats, itemTypes)
	}

	endToken, err := decoder.Token()
	if err != nil {
		return 0, 0, threadProjectionStats{}, err
	}
	endDelim, ok := endToken.(json.Delim)
	if !ok || endDelim != ']' {
		return 0, 0, threadProjectionStats{}, nil
	}

	stats.ItemTypes = flattenThreadProjectionItemTypes(itemTypes)
	return turnCount, messageCount, stats, nil
}

func summarizeThreadProjectionTurn(
	turn ThreadTurn,
	stats *threadProjectionStats,
	itemTypes map[string]*ThreadProjectionItemTypeStat,
) int {
	messageCount := 0
	for _, item := range turn.Items {
		stats.ItemCount += 1
		itemBytes := encodedJSONSize(item)
		stats.ItemBytes += itemBytes

		itemType := memoryProjectionItemType(item)
		entry := itemTypes[itemType]
		if entry == nil {
			entry = &ThreadProjectionItemTypeStat{Type: itemType}
			itemTypes[itemType] = entry
		}
		entry.Count += 1
		entry.TotalBytes += itemBytes

		switch itemType {
		case "userMessage", "agentMessage":
			messageCount += 1
		}
	}
	return messageCount
}

func flattenThreadProjectionItemTypes(itemTypes map[string]*ThreadProjectionItemTypeStat) []ThreadProjectionItemTypeStat {
	if len(itemTypes) == 0 {
		return nil
	}
	stats := make([]ThreadProjectionItemTypeStat, 0, len(itemTypes))
	for _, stat := range itemTypes {
		stats = append(stats, *stat)
	}
	sort.Slice(stats, func(i int, j int) bool {
		return stats[i].Type < stats[j].Type
	})
	return stats
}

func threadProjectionSnapshotBytesForInspection(record threadProjectionRecord) int64 {
	if record.SnapshotBytes > 0 && !record.SnapshotDirty {
		return record.SnapshotBytes
	}
	return encodedJSONSize(buildStoredThreadProjectionSnapshotFromRecord(record))
}
