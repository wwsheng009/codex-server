package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	store    *store.MemoryStore
	runtimes *runtime.Manager
}

var ErrInvalidLoginInput = errors.New("invalid login input")

type LoginInput struct {
	Type   string `json:"type"`
	APIKey string `json:"apiKey,omitempty"`
}

type LoginResult struct {
	Type    string `json:"type"`
	Status  string `json:"status"`
	AuthURL string `json:"authUrl,omitempty"`
	LoginID string `json:"loginId,omitempty"`
	Message string `json:"message,omitempty"`
}

type CancelLoginResult struct {
	Status string `json:"status"`
}

type McpOauthLoginResult struct {
	AuthorizationURL string `json:"authorizationUrl"`
}

func NewService(dataStore *store.MemoryStore, runtimeManager *runtime.Manager) *Service {
	return &Service{
		store:    dataStore,
		runtimes: runtimeManager,
	}
}

func (s *Service) CurrentAccount(ctx context.Context, workspaceID string) (store.Account, error) {
	resolvedWorkspaceID, err := s.requireWorkspace(workspaceID)
	if err != nil {
		return store.Account{}, err
	}

	var response struct {
		Account            map[string]any `json:"account"`
		RequiresOpenAIAuth bool           `json:"requiresOpenaiAuth"`
	}

	if err := s.runtimes.Call(ctx, resolvedWorkspaceID, "account/read", map[string]any{}, &response); err != nil {
		return store.Account{}, err
	}

	accountType := stringValue(response.Account["type"])
	status := "connected"
	if response.RequiresOpenAIAuth {
		status = "requires_openai_auth"
	}
	if accountType == "" {
		status = "disconnected"
	}

	email := stringValue(response.Account["email"])
	if email == "" {
		email = accountType
	}
	if email == "" {
		email = "not-connected"
	}

	return store.Account{
		ID:           "acct_runtime",
		Email:        email,
		Status:       status,
		AuthMode:     accountType,
		PlanType:     stringValue(response.Account["planType"]),
		LastSyncedAt: time.Now().UTC(),
	}, nil
}

func (s *Service) RateLimits(ctx context.Context, workspaceID string) ([]store.RateLimit, error) {
	resolvedWorkspaceID, err := s.requireWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}

	var response rateLimitReadResponse

	err = s.runtimes.Call(ctx, resolvedWorkspaceID, "account/rateLimits/read", map[string]any{}, &response)
	if err != nil {
		if strings.Contains(err.Error(), "authentication required") {
			return nil, nil
		}
		return nil, err
	}

	items, err := decodeRateLimitItemsFromResponse(response)
	if err != nil {
		return nil, fmt.Errorf("decode account/rateLimits/read response: %w", err)
	}

	return items, nil
}

type rateLimitReadResponse struct {
	RateLimits          json.RawMessage             `json:"rateLimits"`
	RateLimitsByLimitID map[string]json.RawMessage `json:"rateLimitsByLimitId"`
}

type appServerRateLimitSnapshot struct {
	LimitID   string                     `json:"limitId"`
	LimitName string                     `json:"limitName"`
	Primary   *appServerRateLimitWindow  `json:"primary"`
	Secondary *appServerRateLimitWindow  `json:"secondary"`
	Credits   *appServerCreditsSnapshot  `json:"credits"`
	PlanType  string                     `json:"planType"`
}

type appServerRateLimitWindow struct {
	UsedPercent        float64 `json:"usedPercent"`
	WindowDurationMins *int64  `json:"windowDurationMins"`
	ResetsAt           *int64  `json:"resetsAt"`
}

type appServerCreditsSnapshot struct {
	HasCredits bool   `json:"hasCredits"`
	Unlimited  bool   `json:"unlimited"`
	Balance    string `json:"balance"`
}

type normalizedRateLimitSnapshot struct {
	LimitID   string
	LimitName string
	Primary   *normalizedRateLimitWindow
	Secondary *normalizedRateLimitWindow
	Credits   *normalizedCreditsSnapshot
	PlanType  string
}

type normalizedRateLimitWindow struct {
	UsedPercent        float64
	WindowDurationMins *int64
	ResetsAt           *time.Time
}

type normalizedCreditsSnapshot struct {
	HasCredits bool
	Unlimited  bool
	Balance    string
}

type legacyRateLimitItem struct {
	Name      string          `json:"name"`
	LimitID   string          `json:"limitId"`
	Limit     int             `json:"limit"`
	Remaining int             `json:"remaining"`
	ResetsAt  json.RawMessage `json:"resetsAt"`
}

func decodeRateLimitItemsFromResponse(response rateLimitReadResponse) ([]store.RateLimit, error) {
	if items, ok, err := decodeLegacyRateLimitItems(response.RateLimits); err != nil || ok {
		return items, err
	}

	snapshots, err := normalizeRateLimitSnapshots(response)
	if err != nil {
		return nil, err
	}

	return mapNormalizedRateLimitSnapshotsToStore(snapshots), nil
}

func decodeLegacyRateLimitItems(raw json.RawMessage) ([]store.RateLimit, bool, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, false, nil
	}
	if trimmed[0] != '[' {
		return nil, false, nil
	}

	var response []legacyRateLimitItem
	if err := json.Unmarshal(raw, &response); err != nil {
		return nil, true, err
	}

	items := make([]store.RateLimit, 0, len(response))
	for _, item := range response {
		resetsAt, err := decodeLegacyResetAt(item.ResetsAt)
		if err != nil {
			return nil, true, err
		}

		items = append(items, store.RateLimit{
			LimitID:   strings.TrimSpace(item.LimitID),
			LimitName: fallbackString(strings.TrimSpace(item.Name), strings.TrimSpace(item.LimitID)),
			Primary: &store.RateLimitWindow{
				UsedPercent: percentUsedFromLegacyRateLimit(item.Limit, item.Remaining),
				ResetsAt:    resetsAt,
			},
		})
	}

	return items, true, nil
}

func decodeLegacyResetAt(raw json.RawMessage) (*time.Time, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, nil
	}

	var unixSeconds int64
	if err := json.Unmarshal(raw, &unixSeconds); err == nil {
		value := time.Unix(unixSeconds, 0).UTC()
		return &value, nil
	}

	var unixSecondsFloat float64
	if err := json.Unmarshal(raw, &unixSecondsFloat); err == nil {
		value := time.Unix(int64(unixSecondsFloat), 0).UTC()
		return &value, nil
	}

	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return nil, fmt.Errorf("unsupported resetsAt payload: %s", trimmed)
	}

	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}

	if unixFromString, err := strconv.ParseInt(text, 10, 64); err == nil {
		value := time.Unix(unixFromString, 0).UTC()
		return &value, nil
	}

	parsed, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return nil, fmt.Errorf("unsupported resetsAt value %q", text)
	}

	value := parsed.UTC()
	return &value, nil
}

func normalizeRateLimitSnapshots(response rateLimitReadResponse) ([]normalizedRateLimitSnapshot, error) {
	baseSnapshot, hasBaseSnapshot, err := decodeAppServerRateLimitSnapshot(response.RateLimits)
	if err != nil {
		return nil, fmt.Errorf("decode rateLimits: %w", err)
	}

	orderedKeys := make([]string, 0, len(response.RateLimitsByLimitID)+1)
	snapshotsByKey := make(map[string]normalizedRateLimitSnapshot, len(response.RateLimitsByLimitID)+1)

	if hasBaseSnapshot {
		baseKey := rateLimitSnapshotKey(baseSnapshot, "codex")
		baseSnapshot = withSnapshotKeyDefaults(baseSnapshot, baseKey)
		snapshotsByKey[baseKey] = baseSnapshot
		orderedKeys = append(orderedKeys, baseKey)
	}

	keys := make([]string, 0, len(response.RateLimitsByLimitID))
	for key := range response.RateLimitsByLimitID {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	for _, key := range keys {
		snapshot, ok, err := decodeAppServerRateLimitSnapshot(response.RateLimitsByLimitID[key])
		if err != nil {
			return nil, fmt.Errorf("decode rateLimitsByLimitId[%s]: %w", key, err)
		}
		if !ok {
			continue
		}

		snapshot = withSnapshotKeyDefaults(snapshot, key)
		if hasBaseSnapshot {
			snapshot = inheritSnapshotMetadata(baseSnapshot, snapshot)
		}

		snapshotKey := rateLimitSnapshotKey(snapshot, key)
		if existing, ok := snapshotsByKey[snapshotKey]; ok {
			snapshotsByKey[snapshotKey] = mergeNormalizedRateLimitSnapshots(existing, snapshot)
			continue
		}

		snapshotsByKey[snapshotKey] = snapshot
		orderedKeys = append(orderedKeys, snapshotKey)
	}

	items := make([]normalizedRateLimitSnapshot, 0, len(orderedKeys))
	for _, key := range orderedKeys {
		snapshot := snapshotsByKey[key]
		if !hasSnapshotData(snapshot) {
			continue
		}
		items = append(items, snapshot)
	}

	return items, nil
}

func decodeAppServerRateLimitSnapshot(raw json.RawMessage) (normalizedRateLimitSnapshot, bool, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return normalizedRateLimitSnapshot{}, false, nil
	}

	var snapshot appServerRateLimitSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return normalizedRateLimitSnapshot{}, false, err
	}

	normalized := normalizedRateLimitSnapshot{
		LimitID:   strings.TrimSpace(snapshot.LimitID),
		LimitName: strings.TrimSpace(snapshot.LimitName),
		Primary:   normalizeRateLimitWindow(snapshot.Primary),
		Secondary: normalizeRateLimitWindow(snapshot.Secondary),
		PlanType:  strings.TrimSpace(snapshot.PlanType),
	}
	if snapshot.Credits != nil {
		normalized.Credits = &normalizedCreditsSnapshot{
			HasCredits: snapshot.Credits.HasCredits,
			Unlimited:  snapshot.Credits.Unlimited,
			Balance:    strings.TrimSpace(snapshot.Credits.Balance),
		}
	}

	return normalized, hasSnapshotData(normalized), nil
}

func normalizeRateLimitWindow(window *appServerRateLimitWindow) *normalizedRateLimitWindow {
	if window == nil {
		return nil
	}

	return &normalizedRateLimitWindow{
		UsedPercent:       window.UsedPercent,
		WindowDurationMins: window.WindowDurationMins,
		ResetsAt:          unixSecondsToTime(window.ResetsAt),
	}
}

func unixSecondsToTime(seconds *int64) *time.Time {
	if seconds == nil {
		return nil
	}

	value := time.Unix(*seconds, 0).UTC()
	return &value
}

func withSnapshotKeyDefaults(snapshot normalizedRateLimitSnapshot, fallbackKey string) normalizedRateLimitSnapshot {
	fallbackKey = strings.TrimSpace(fallbackKey)
	if snapshot.LimitID == "" {
		snapshot.LimitID = fallbackKey
	}
	if snapshot.LimitName == "" {
		snapshot.LimitName = snapshot.LimitID
	}

	return snapshot
}

func inheritSnapshotMetadata(base normalizedRateLimitSnapshot, snapshot normalizedRateLimitSnapshot) normalizedRateLimitSnapshot {
	if snapshot.LimitName == "" {
		snapshot.LimitName = base.LimitName
	}
	if snapshot.LimitID == base.LimitID && snapshot.LimitName == snapshot.LimitID && base.LimitName != "" {
		snapshot.LimitName = base.LimitName
	}
	if snapshot.Credits == nil && base.Credits != nil {
		credits := *base.Credits
		snapshot.Credits = &credits
	}
	if snapshot.PlanType == "" {
		snapshot.PlanType = base.PlanType
	}

	return snapshot
}

func mergeNormalizedRateLimitSnapshots(existing normalizedRateLimitSnapshot, incoming normalizedRateLimitSnapshot) normalizedRateLimitSnapshot {
	if incoming.LimitID != "" {
		existing.LimitID = incoming.LimitID
	}
	if incoming.LimitName != "" {
		existing.LimitName = incoming.LimitName
	}
	if incoming.Primary != nil {
		existing.Primary = incoming.Primary
	}
	if incoming.Secondary != nil {
		existing.Secondary = incoming.Secondary
	}
	if incoming.Credits != nil {
		existing.Credits = incoming.Credits
	}
	if incoming.PlanType != "" {
		existing.PlanType = incoming.PlanType
	}

	return existing
}

func hasSnapshotData(snapshot normalizedRateLimitSnapshot) bool {
	return snapshot.LimitID != "" ||
		snapshot.LimitName != "" ||
		snapshot.Primary != nil ||
		snapshot.Secondary != nil ||
		snapshot.Credits != nil ||
		snapshot.PlanType != ""
}

func rateLimitSnapshotKey(snapshot normalizedRateLimitSnapshot, fallback string) string {
	switch {
	case strings.TrimSpace(snapshot.LimitID) != "":
		return strings.TrimSpace(snapshot.LimitID)
	case strings.TrimSpace(snapshot.LimitName) != "":
		return strings.TrimSpace(snapshot.LimitName)
	default:
		return strings.TrimSpace(fallback)
	}
}

func mapNormalizedRateLimitSnapshotsToStore(snapshots []normalizedRateLimitSnapshot) []store.RateLimit {
	items := make([]store.RateLimit, 0, len(snapshots))
	for _, snapshot := range snapshots {
		if !hasSnapshotData(snapshot) {
			continue
		}

		items = append(items, store.RateLimit{
			LimitID:   strings.TrimSpace(snapshot.LimitID),
			LimitName: fallbackString(strings.TrimSpace(snapshot.LimitName), strings.TrimSpace(snapshot.LimitID)),
			Primary:   mapNormalizedRateLimitWindowToStore(snapshot.Primary),
			Secondary: mapNormalizedRateLimitWindowToStore(snapshot.Secondary),
			Credits:   mapNormalizedCreditsToStore(snapshot.Credits),
			PlanType:  strings.TrimSpace(snapshot.PlanType),
		})
	}

	return items
}

func mapNormalizedRateLimitWindowToStore(window *normalizedRateLimitWindow) *store.RateLimitWindow {
	if window == nil {
		return nil
	}

	return &store.RateLimitWindow{
		UsedPercent:        clampRateLimitPercent(window.UsedPercent),
		WindowDurationMins: cloneInt64Pointer(window.WindowDurationMins),
		ResetsAt:           cloneTimePointer(window.ResetsAt),
	}
}

func mapNormalizedCreditsToStore(snapshot *normalizedCreditsSnapshot) *store.RateLimitCredits {
	if snapshot == nil {
		return nil
	}

	return &store.RateLimitCredits{
		HasCredits: snapshot.HasCredits,
		Unlimited:  snapshot.Unlimited,
		Balance:    snapshot.Balance,
	}
}

func clampRateLimitPercent(value float64) int {
	return maxInt(0, minInt(100, int(math.Round(value))))
}

func percentUsedFromLegacyRateLimit(limit int, remaining int) int {
	if limit <= 0 {
		return 0
	}

	return clampRateLimitPercent((float64(limit-remaining) / float64(limit)) * 100)
}

func cloneTimePointer(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}

	cloned := *value
	return &cloned
}

func cloneInt64Pointer(value *int64) *int64 {
	if value == nil {
		return nil
	}

	cloned := *value
	return &cloned
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}

	return right
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}

	return right
}

func (s *Service) Logout(ctx context.Context, workspaceID string) error {
	resolvedWorkspaceID, err := s.requireWorkspace(workspaceID)
	if err != nil {
		return err
	}

	return s.runtimes.Call(ctx, resolvedWorkspaceID, "account/logout", map[string]any{}, nil)
}

func (s *Service) Login(ctx context.Context, workspaceID string, input LoginInput) (LoginResult, error) {
	resolvedWorkspaceID, err := s.requireWorkspace(workspaceID)
	if err != nil {
		return LoginResult{}, err
	}

	switch input.Type {
	case "apiKey":
		if strings.TrimSpace(input.APIKey) == "" {
			return LoginResult{}, fmt.Errorf("%w: apiKey is required", ErrInvalidLoginInput)
		}

		var response struct {
			Type string `json:"type"`
		}

		if err := s.runtimes.Call(ctx, resolvedWorkspaceID, "account/login/start", map[string]any{
			"apiKey": input.APIKey,
			"type":   "apiKey",
		}, &response); err != nil {
			return LoginResult{}, err
		}

		return LoginResult{
			Type:    response.Type,
			Status:  "submitted",
			Message: "API key submitted to Codex runtime",
		}, nil
	case "chatgpt":
		var response struct {
			Type    string `json:"type"`
			AuthURL string `json:"authUrl"`
			LoginID string `json:"loginId"`
		}

		if err := s.runtimes.Call(ctx, resolvedWorkspaceID, "account/login/start", map[string]any{
			"type": "chatgpt",
		}, &response); err != nil {
			return LoginResult{}, err
		}

		return LoginResult{
			Type:    response.Type,
			Status:  "pending",
			AuthURL: response.AuthURL,
			LoginID: response.LoginID,
			Message: "Open the returned URL to complete ChatGPT login",
		}, nil
	default:
		return LoginResult{}, fmt.Errorf("%w: unsupported login type", ErrInvalidLoginInput)
	}
}

func (s *Service) CancelLogin(ctx context.Context, workspaceID string, loginID string) (CancelLoginResult, error) {
	if strings.TrimSpace(loginID) == "" {
		return CancelLoginResult{}, fmt.Errorf("%w: loginId is required", ErrInvalidLoginInput)
	}

	resolvedWorkspaceID, err := s.requireWorkspace(workspaceID)
	if err != nil {
		return CancelLoginResult{}, err
	}

	var response CancelLoginResult
	if err := s.runtimes.Call(ctx, resolvedWorkspaceID, "account/login/cancel", map[string]any{
		"loginId": loginID,
	}, &response); err != nil {
		return CancelLoginResult{}, err
	}

	return response, nil
}

func (s *Service) McpOauthLogin(ctx context.Context, workspaceID string, name string, scopes []string, timeoutSecs *int) (McpOauthLoginResult, error) {
	if strings.TrimSpace(name) == "" {
		return McpOauthLoginResult{}, fmt.Errorf("%w: name is required", ErrInvalidLoginInput)
	}

	params := map[string]any{
		"name": name,
	}
	if len(scopes) > 0 {
		params["scopes"] = scopes
	}
	if timeoutSecs != nil {
		params["timeoutSecs"] = *timeoutSecs
	}

	var response McpOauthLoginResult
	if err := s.runtimes.Call(ctx, workspaceID, "mcpServer/oauth/login", params, &response); err != nil {
		return McpOauthLoginResult{}, err
	}

	return response, nil
}

func (s *Service) requireWorkspace(workspaceID string) (string, error) {
	resolvedWorkspaceID := strings.TrimSpace(workspaceID)
	if resolvedWorkspaceID == "" {
		return "", store.ErrWorkspaceNotFound
	}

	if _, ok := s.store.GetWorkspace(resolvedWorkspaceID); !ok {
		return "", store.ErrWorkspaceNotFound
	}

	return resolvedWorkspaceID, nil
}

func disconnectedAccount() store.Account {
	return store.Account{
		ID:           "acct_disconnected",
		Email:        "not-connected",
		Status:       "disconnected",
		AuthMode:     "",
		PlanType:     "",
		LastSyncedAt: time.Now().UTC(),
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

func fallbackString(value string, fallback string) string {
	if value == "" {
		return fallback
	}

	return value
}
