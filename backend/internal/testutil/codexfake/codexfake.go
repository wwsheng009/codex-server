package codexfake

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

type MessageRecord struct {
	Kind   string         `json:"kind"`
	Method string         `json:"method"`
	Params map[string]any `json:"params,omitempty"`
}

type State struct {
	Received       []MessageRecord `json:"received"`
	Initialize     map[string]any  `json:"initialize,omitempty"`
	LastThread     map[string]any  `json:"lastThread,omitempty"`
	LastReview     map[string]any  `json:"lastReview,omitempty"`
	LastTurn       map[string]any  `json:"lastTurn,omitempty"`
	LastInterrupt  map[string]any  `json:"lastInterrupt,omitempty"`
	InitializedAck bool            `json:"initializedAck,omitempty"`
}

type Notification struct {
	Method string         `json:"method"`
	Params map[string]any `json:"params,omitempty"`
}

type ExitBehavior struct {
	Code           int    `json:"code,omitempty"`
	Stderr         string `json:"stderr,omitempty"`
	BeforeResponse bool   `json:"beforeResponse,omitempty"`
}

type MethodBehavior struct {
	Result        map[string]any `json:"result,omitempty"`
	Notifications []Notification `json:"notifications,omitempty"`
	Exit          *ExitBehavior  `json:"exit,omitempty"`
}

type Scenario struct {
	Behaviors map[string]MethodBehavior `json:"behaviors,omitempty"`
}

type Session struct {
	Command      string
	StateFile    string
	ScenarioFile string
}

func NewSession(t *testing.T, _ string) Session {
	t.Helper()
	return NewSessionWithScenario(t, Scenario{})
}

func NewSessionWithScenario(t *testing.T, scenario Scenario) Session {
	t.Helper()

	dir := t.TempDir()
	stateFile := filepath.Join(dir, "fake-codex-state.json")
	scenarioFile := filepath.Join(dir, "fake-codex-scenario.json")
	scriptPath := filepath.Join(dir, "fake-codex-app-server.mjs")
	scenarioData, err := json.Marshal(scenario)
	if err != nil {
		t.Fatalf("marshal fake codex scenario: %v", err)
	}
	if err := os.WriteFile(scenarioFile, scenarioData, 0o600); err != nil {
		t.Fatalf("write fake codex scenario: %v", err)
	}
	if err := os.WriteFile(scriptPath, []byte(fakeNodeScript()), 0o600); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	return Session{
		Command:      fmt.Sprintf("node %s %s %s", scriptPath, stateFile, scenarioFile),
		StateFile:    stateFile,
		ScenarioFile: scenarioFile,
	}
}

func (s Session) Env() []string {
	return os.Environ()
}

func RunHelperProcessIfRequested(t *testing.T) {
	t.Helper()
	t.Skip("codex fake helper is script-backed in this package")
}

func ReadState(t *testing.T, stateFile string) State {
	t.Helper()

	data, err := os.ReadFile(stateFile)
	if err != nil {
		t.Fatalf("read fake codex state: %v", err)
	}

	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatalf("decode fake codex state: %v", err)
	}
	return state
}

func fakeNodeScript() string {
	return `import fs from "node:fs";
import readline from "node:readline";

const stateFile = process.argv[2];
const scenarioFile = process.argv[3];
if (!stateFile) {
  process.stderr.write("missing state file\n");
  process.exit(2);
}

let scenario = {};
if (scenarioFile && fs.existsSync(scenarioFile)) {
  scenario = JSON.parse(fs.readFileSync(scenarioFile, "utf8"));
}

const state = {
  received: [],
  initializedAck: false,
};

function persist() {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function defaultBehavior(method, params) {
  switch (method) {
    case "initialize":
      return {
        result: { userAgent: "fake-codex-app-server" },
      };
    case "thread/start":
      return {
        result: {
          thread: {
            id: "thread-test-1",
            cwd: params.cwd ?? null,
          },
        },
        notifications: [
          {
            method: "thread/started",
            params: {
              thread: {
                id: "thread-test-1",
              },
            },
          },
        ],
      };
    case "review/start":
      return {
        result: {
          turn: {
            id: "review-turn-1",
            status: "inProgress",
          },
        },
      };
    case "turn/start":
      return {
        result: {
          turn: {
            id: "turn-test-1",
            status: "inProgress",
          },
        },
        notifications: [
          {
            method: "turn/started",
            params: {
              threadId: params.threadId ?? "",
              turn: {
                id: "turn-test-1",
                status: "inProgress",
              },
            },
          },
        ],
      };
    case "turn/interrupt":
      return {
        result: {},
        notifications: [
          {
            method: "turn/completed",
            params: {
              threadId: params.threadId ?? "",
              turn: {
                id: params.turnId ?? "",
                status: "interrupted",
              },
            },
          },
        ],
      };
    default:
      return null;
  }
}

function resolveBehavior(method, params) {
  const base = defaultBehavior(method, params);
  const override = scenario.behaviors?.[method];
  if (!override) {
    return base;
  }

  return {
    result: hasOwn(override, "result") ? clone(override.result) : clone(base?.result),
    notifications: hasOwn(override, "notifications") ? clone(override.notifications ?? []) : clone(base?.notifications ?? []),
    exit: hasOwn(override, "exit") ? clone(override.exit) : clone(base?.exit),
  };
}

function scheduleExit(exit) {
  if (!exit) {
    return;
  }

  persist();
  const code = Number.isInteger(exit.code) ? exit.code : 0;
  if (exit.stderr) {
    process.stderr.write(String(exit.stderr) + "\n");
  }
  setTimeout(() => process.exit(code), 10);
}

persist();

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  const message = JSON.parse(line);
  const method = message.method ?? "";
  const params = message.params ?? {};
  const hasID = Object.prototype.hasOwnProperty.call(message, "id");

  state.received.push({
    kind: hasID ? "request" : "notification",
    method,
    params,
  });

  switch (method) {
    case "initialize":
      state.initialize = params;
      break;
    case "initialized":
      state.initializedAck = true;
      break;
    case "thread/start":
      state.lastThread = params;
      break;
    case "review/start":
      state.lastReview = params;
      break;
    case "turn/start":
      state.lastTurn = params;
      break;
    case "turn/interrupt":
      state.lastInterrupt = params;
      break;
  }

  const behavior = resolveBehavior(method, params);
  persist();

  if (!behavior) {
    if (hasID) {
      send({
        id: message.id,
        error: {
          code: -32601,
          message: "unsupported method: " + method,
        },
      });
    }
    return;
  }

  if (behavior.exit?.beforeResponse) {
    scheduleExit(behavior.exit);
    return;
  }

  if (hasID && behavior.result !== undefined) {
    send({
      id: message.id,
      result: behavior.result,
    });
  }
  for (const notification of behavior.notifications ?? []) {
    send({
      method: notification.method,
      params: notification.params ?? {},
    });
  }

  if (behavior.exit) {
    scheduleExit(behavior.exit);
  }
});
`
}
