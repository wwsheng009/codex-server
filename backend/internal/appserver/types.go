package appserver

type ClientInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type InitializeCapabilities struct {
	ExperimentalAPI           bool     `json:"experimentalApi"`
	OptOutNotificationMethods []string `json:"optOutNotificationMethods,omitempty"`
}

type InitializeRequest struct {
	ClientInfo   ClientInfo             `json:"clientInfo"`
	Capabilities InitializeCapabilities `json:"capabilities"`
}

type InitializeResponse struct {
	UserAgent string `json:"userAgent,omitempty"`
}

type ThreadRef struct {
	ID string `json:"id"`
}

type TurnRef struct {
	ID string `json:"id"`
}

type ThreadStartRequest struct {
	Cwd                string `json:"cwd"`
	ApprovalPolicy     string `json:"approvalPolicy"`
	Sandbox            string `json:"sandbox,omitempty"`
	Model              string `json:"model,omitempty"`
	SessionStartSource string `json:"sessionStartSource,omitempty"`
}

type ThreadStartResponse struct {
	Thread ThreadRef `json:"thread"`
}

type ThreadListRequest struct {
	Archived bool   `json:"archived"`
	Limit    int    `json:"limit"`
	Cursor   string `json:"cursor,omitempty"`
	SortKey  string `json:"sortKey,omitempty"`
}

type ThreadListResponse struct {
	Data       []map[string]any `json:"data"`
	NextCursor *string          `json:"nextCursor"`
}

type ThreadReadRequest struct {
	IncludeTurns bool   `json:"includeTurns"`
	ThreadID     string `json:"threadId"`
}

type ThreadReadResponse struct {
	Thread map[string]any `json:"thread"`
}

type ThreadLoadedListRequest struct {
	Limit int `json:"limit"`
}

type ThreadLoadedListResponse struct {
	Data []string `json:"data"`
}

type ThreadMetadataUpdateRequest struct {
	ThreadID string         `json:"threadId"`
	GitInfo  map[string]any `json:"gitInfo,omitempty"`
}

type ThreadMetadataUpdateResponse struct {
	Thread map[string]any `json:"thread"`
}

type ThreadCompactStartRequest struct {
	ThreadID string `json:"threadId"`
}

type ThreadResumeRequest struct {
	Cwd      string `json:"cwd"`
	ThreadID string `json:"threadId"`
}

type ThreadResumeResponse struct {
	Thread map[string]any `json:"thread"`
}

type ThreadForkRequest struct {
	Cwd      string `json:"cwd"`
	ThreadID string `json:"threadId"`
}

type ThreadForkResponse struct {
	Thread map[string]any `json:"thread"`
}

type ThreadArchiveRequest struct {
	ThreadID string `json:"threadId"`
}

type ThreadUnarchiveRequest struct {
	ThreadID string `json:"threadId"`
}

type ThreadSetNameRequest struct {
	Name     string `json:"name"`
	ThreadID string `json:"threadId"`
}

type ThreadRollbackRequest struct {
	NumTurns int    `json:"numTurns"`
	ThreadID string `json:"threadId"`
}

type ThreadUnsubscribeRequest struct {
	ThreadID string `json:"threadId"`
}

type ThreadUnsubscribeResponse struct {
	Status string `json:"status,omitempty"`
}

type ThreadShellCommandRequest struct {
	ThreadID string `json:"threadId"`
	Command  string `json:"command"`
}

type ReviewTarget struct {
	Type string `json:"type"`
}

type ReviewStartRequest struct {
	Delivery string       `json:"delivery"`
	Target   ReviewTarget `json:"target"`
	ThreadID string       `json:"threadId"`
}

type ReviewStartResponse struct {
	Turn           TurnRef `json:"turn"`
	ReviewThreadID string  `json:"reviewThreadId,omitempty"`
}

type UserInput struct {
	Text string `json:"text"`
	Type string `json:"type"`
}

type TurnStartRequest struct {
	Input                      []UserInput    `json:"input"`
	ThreadID                   string         `json:"threadId"`
	CollaborationMode          map[string]any `json:"collaborationMode,omitempty"`
	Model                      string         `json:"model,omitempty"`
	Effort                     string         `json:"effort,omitempty"`
	ApprovalPolicy             string         `json:"approvalPolicy,omitempty"`
	SandboxPolicy              map[string]any `json:"sandboxPolicy,omitempty"`
	ResponsesAPIClientMetadata map[string]any `json:"responsesapiClientMetadata,omitempty"`
}

type TurnStartResponse struct {
	Turn TurnRef `json:"turn"`
}

type TurnSteerRequest struct {
	ExpectedTurnID string      `json:"expectedTurnId"`
	Input          []UserInput `json:"input"`
	ThreadID       string      `json:"threadId"`
}

type TurnSteerResponse struct {
	TurnID string `json:"turnId"`
}

type TurnInterruptRequest struct {
	ThreadID string `json:"threadId"`
	TurnID   string `json:"turnId"`
}

type CollaborationModeListRequest struct{}

type CollaborationModeListEntry struct {
	Name            string  `json:"name"`
	Mode            *string `json:"mode"`
	Model           *string `json:"model"`
	ReasoningEffort *string `json:"reasoning_effort"`
}

type CollaborationModeListResponse struct {
	Data []CollaborationModeListEntry `json:"data"`
}
