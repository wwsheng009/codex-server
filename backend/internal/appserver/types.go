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
	Cwd            string `json:"cwd"`
	ApprovalPolicy string `json:"approvalPolicy"`
	Sandbox        string `json:"sandbox,omitempty"`
	Model          string `json:"model,omitempty"`
}

type ThreadStartResponse struct {
	Thread ThreadRef `json:"thread"`
}

type ThreadResumeRequest struct {
	Cwd      string `json:"cwd"`
	ThreadID string `json:"threadId"`
}

type ThreadResumeResponse struct {
	Thread map[string]any `json:"thread"`
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
	Input             []UserInput    `json:"input"`
	ThreadID          string         `json:"threadId"`
	CollaborationMode map[string]any `json:"collaborationMode,omitempty"`
	Model             string         `json:"model,omitempty"`
	Effort            string         `json:"effort,omitempty"`
	ApprovalPolicy    string         `json:"approvalPolicy,omitempty"`
	SandboxPolicy     map[string]any `json:"sandboxPolicy,omitempty"`
}

type TurnStartResponse struct {
	Turn TurnRef `json:"turn"`
}

type TurnInterruptRequest struct {
	ThreadID string `json:"threadId"`
	TurnID   string `json:"turnId"`
}
