// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { i18n } from "../../i18n/runtime";

const settingsApiState = vi.hoisted(() => ({
  feishuToolsOauthLogin: vi.fn(),
  invokeFeishuTool: vi.fn(),
  readFeishuToolsCapabilities: vi.fn(),
  readFeishuToolsConfig: vi.fn(),
  readFeishuToolsOauthStatus: vi.fn(),
  readFeishuToolsPermissions: vi.fn(),
  readFeishuToolsStatus: vi.fn(),
  revokeFeishuToolsOauth: vi.fn(),
  writeFeishuToolsConfig: vi.fn(),
}));

const shellContextState = vi.hoisted(() => ({
  useSettingsShellContext: vi.fn(),
}));

const workspaceStreamState = vi.hoisted(() => ({
  useWorkspaceEventSubscription: vi.fn(),
  useWorkspaceStream: vi.fn(),
}));

vi.mock("../../features/settings/api", () => ({
  feishuToolsOauthLogin: settingsApiState.feishuToolsOauthLogin,
  invokeFeishuTool: settingsApiState.invokeFeishuTool,
  readFeishuToolsCapabilities: settingsApiState.readFeishuToolsCapabilities,
  readFeishuToolsConfig: settingsApiState.readFeishuToolsConfig,
  readFeishuToolsOauthStatus: settingsApiState.readFeishuToolsOauthStatus,
  readFeishuToolsPermissions: settingsApiState.readFeishuToolsPermissions,
  readFeishuToolsStatus: settingsApiState.readFeishuToolsStatus,
  revokeFeishuToolsOauth: settingsApiState.revokeFeishuToolsOauth,
  writeFeishuToolsConfig: settingsApiState.writeFeishuToolsConfig,
}));

vi.mock("../../features/settings/shell-context", () => ({
  useSettingsShellContext: shellContextState.useSettingsShellContext,
}));

vi.mock("../../hooks/useWorkspaceStream", () => ({
  useWorkspaceEventSubscription: workspaceStreamState.useWorkspaceEventSubscription,
  useWorkspaceStream: workspaceStreamState.useWorkspaceStream,
}));

let FeishuToolsSettingsPageComponent: Awaited<
  typeof import("./FeishuToolsSettingsPage")
>["FeishuToolsSettingsPage"];
let renderedQueryClients: QueryClient[] = [];

function clearRenderedQueryClients() {
  for (const queryClient of renderedQueryClients) {
    queryClient.clear();
  }
  renderedQueryClients = [];
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        gcTime: 0,
        retry: false,
      },
      queries: {
        gcTime: 0,
        retry: false,
      },
    },
  });
}

function renderWithProviders(node: ReactNode) {
  const queryClient = createQueryClient();
  renderedQueryClients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

async function clickOptionLabel(text: string) {
  const optionTexts = await screen.findAllByText(text);
  const optionLabel = optionTexts
    .map((optionText) => optionText.closest("label"))
    .find((candidate) => candidate instanceof HTMLElement);
  if (!(optionLabel instanceof HTMLElement)) {
    throw new Error(`Could not find clickable label for option: ${text}`);
  }
  fireEvent.click(optionLabel);
}

function createCapabilitiesResult() {
  return {
    categories: [
      {
        id: "docs",
        title: "Docs",
        description: "Document tools",
        enabledCount: 2,
        totalCount: 2,
        items: [
          {
            toolName: "feishu_fetch_doc",
            title: "Read Document",
            description: "Read document content",
            enabled: true,
            riskLevel: "read",
            stage: "phase_1",
            requiredScopes: ["docx:document:readonly"],
          },
          {
            toolName: "feishu_update_doc",
            title: "Update Document",
            description: "Update document ranges",
            enabled: true,
            riskLevel: "write",
            stage: "phase_1",
            requiredScopes: ["docx:document:write"],
          },
        ],
      },
      {
        id: "tasks",
        title: "Tasks",
        description: "Task tools",
        enabledCount: 1,
        totalCount: 1,
        items: [
          {
            toolName: "feishu_task_task",
            title: "Manage Task",
            description: "Create and patch tasks",
            enabled: true,
            riskLevel: "write",
            stage: "phase_1",
            requiredScopes: ["task:task:write"],
          },
        ],
      },
    ],
    summary: {
      enabledCount: 3,
      totalCount: 3,
      stage: "phase_2",
    },
  };
}

beforeAll(async () => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
  FeishuToolsSettingsPageComponent = (
    await import("./FeishuToolsSettingsPage")
  ).FeishuToolsSettingsPage;
});

beforeEach(() => {
  cleanup();
  clearRenderedQueryClients();
  settingsApiState.feishuToolsOauthLogin.mockReset();
  settingsApiState.invokeFeishuTool.mockReset();
  settingsApiState.readFeishuToolsCapabilities.mockReset();
  settingsApiState.readFeishuToolsConfig.mockReset();
  settingsApiState.readFeishuToolsOauthStatus.mockReset();
  settingsApiState.readFeishuToolsPermissions.mockReset();
  settingsApiState.readFeishuToolsStatus.mockReset();
  settingsApiState.revokeFeishuToolsOauth.mockReset();
  settingsApiState.writeFeishuToolsConfig.mockReset();
  workspaceStreamState.useWorkspaceEventSubscription.mockReset();
  workspaceStreamState.useWorkspaceStream.mockReset();

  shellContextState.useSettingsShellContext.mockReturnValue({
    workspaceId: "ws-1",
    workspaceName: "Codex Server",
    workspaces: [],
    workspacesError: null,
    workspacesLoading: false,
    setSelectedWorkspaceId: vi.fn(),
  });
  workspaceStreamState.useWorkspaceEventSubscription.mockImplementation(() => undefined);
  workspaceStreamState.useWorkspaceStream.mockReturnValue("idle");

  settingsApiState.feishuToolsOauthLogin.mockResolvedValue({
    authorizationUrl: "",
  });
  settingsApiState.invokeFeishuTool.mockResolvedValue({
    toolName: "feishu_fetch_doc",
    status: "ok",
  });
  settingsApiState.readFeishuToolsCapabilities.mockResolvedValue(
    createCapabilitiesResult(),
  );
  settingsApiState.readFeishuToolsOauthStatus.mockResolvedValue({
    status: "not_connected",
    grantedScopes: [],
  });
  settingsApiState.readFeishuToolsPermissions.mockResolvedValue({
    overallStatus: "missing",
    items: [],
    grantedScopes: [],
    missingScopes: [],
    sensitiveScopes: [],
    suggestions: [],
  });
  settingsApiState.readFeishuToolsStatus.mockResolvedValue({
    overallStatus: "ready",
    runtimeIntegration: {
      status: "configured",
      serverName: "feishu-tools",
      serverUrl: "http://localhost/api/feishu-tools/mcp/ws-1",
      threadEnabled: true,
      botEnabled: true,
      allowlistAppliedInThread: true,
      writeGuardAppliedInThread: true,
    },
    checks: [],
  });
  settingsApiState.revokeFeishuToolsOauth.mockResolvedValue({
    revoked: true,
  });
  settingsApiState.writeFeishuToolsConfig.mockResolvedValue({
    config: {
      enabled: true,
      appId: "cli_demo",
      appSecretSet: true,
      mcpEndpoint: "",
      oauthMode: "user_oauth",
      sensitiveWriteGuard: true,
      toolAllowlist: [],
    },
    managedMcpEndpoint: "http://localhost/api/feishu-tools/mcp/ws-1?token=managed",
    warnings: [],
  });
});

afterEach(() => {
  cleanup();
  clearRenderedQueryClients();
});

describe("FeishuToolsSettingsPage", () => {
  it("preserves a custom MCP endpoint when saving configuration", async () => {
    settingsApiState.readFeishuToolsConfig.mockResolvedValue({
      config: {
        enabled: true,
        appId: "cli_demo",
        appSecretSet: true,
        mcpEndpoint: "https://mcp.example.com/custom",
        oauthMode: "user_oauth",
        sensitiveWriteGuard: true,
        toolAllowlist: ["feishu_fetch_doc"],
      },
      managedMcpEndpoint: "http://localhost/api/feishu-tools/mcp/ws-1?token=managed",
      runtimeIntegration: {
        status: "configured",
      },
      warnings: [],
    });

    renderWithProviders(<FeishuToolsSettingsPageComponent />);

    const managedEndpointInput = (await screen.findByLabelText(
      "Managed MCP endpoint",
    )) as HTMLInputElement;
    await waitFor(() => {
      expect(managedEndpointInput.value).toBe(
        "http://localhost/api/feishu-tools/mcp/ws-1?token=managed",
      );
    });

    const endpointInput = (await screen.findByLabelText(
      "Custom MCP endpoint override",
    )) as HTMLInputElement;
    expect(endpointInput.value).toBe("https://mcp.example.com/custom");
    expect(await screen.findByText("Custom MCP override active")).toBeTruthy();
    expect(
      screen.getByText(
        "Current thread runtime prefers the saved custom MCP endpoint override shown below instead of the managed MCP endpoint above. Save after editing this field to change or remove the active override.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("https://mcp.example.com/custom")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));

    await waitFor(() => {
      expect(settingsApiState.writeFeishuToolsConfig).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({
          mcpEndpoint: "https://mcp.example.com/custom",
        }),
      );
    });
  });

  it("filters visible tools and writes the selected allowlist from the popup panel", async () => {
    settingsApiState.readFeishuToolsConfig.mockResolvedValue({
      config: {
        enabled: true,
        appId: "cli_demo",
        appSecretSet: true,
        mcpEndpoint: "",
        oauthMode: "user_oauth",
        sensitiveWriteGuard: true,
        toolAllowlist: [],
      },
      runtimeIntegration: {
        status: "configured",
      },
      warnings: [],
    });

    renderWithProviders(<FeishuToolsSettingsPageComponent />);

    await screen.findByRole("button", { name: "Configure tool panel" });
    expect(screen.queryByText("Custom MCP override active")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Configure tool panel" }));
    await clickOptionLabel("Restrict to selected tools");
    fireEvent.change(screen.getByLabelText("Filter tools"), {
      target: { value: "doc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select all visible" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply tool selection" }));
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));

    await waitFor(() => {
      expect(settingsApiState.writeFeishuToolsConfig).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({
          toolAllowlist: ["feishu_fetch_doc", "feishu_update_doc"],
        }),
      );
    });
  });

  it("can switch back to expose-all mode and submit an empty allowlist", async () => {
    settingsApiState.readFeishuToolsConfig.mockResolvedValue({
      config: {
        enabled: true,
        appId: "cli_demo",
        appSecretSet: true,
        mcpEndpoint: "",
        oauthMode: "user_oauth",
        sensitiveWriteGuard: true,
        toolAllowlist: ["feishu_fetch_doc"],
      },
      runtimeIntegration: {
        status: "configured",
      },
      warnings: [],
    });

    renderWithProviders(<FeishuToolsSettingsPageComponent />);

    await screen.findByRole("button", { name: "Configure tool panel" });

    fireEvent.click(screen.getByRole("button", { name: "Configure tool panel" }));
    await clickOptionLabel("Expose all modeled tools");
    fireEvent.click(screen.getByRole("button", { name: "Apply tool selection" }));
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));

    await waitFor(() => {
      expect(settingsApiState.writeFeishuToolsConfig).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({
          toolAllowlist: [],
        }),
      );
    });
  });

  it("defaults OAuth requests to the exposed tool allowlist", async () => {
    settingsApiState.readFeishuToolsConfig.mockResolvedValue({
      config: {
        enabled: true,
        appId: "cli_demo",
        appSecretSet: true,
        mcpEndpoint: "",
        oauthMode: "user_oauth",
        sensitiveWriteGuard: true,
        toolAllowlist: ["feishu_fetch_doc"],
      },
      runtimeIntegration: {
        status: "configured",
      },
      warnings: [],
    });
    settingsApiState.readFeishuToolsPermissions.mockResolvedValue({
      overallStatus: "pending_authorization",
      grantedScopes: [],
      missingScopes: ["docx:document:readonly", "task:task:write"],
      sensitiveScopes: [],
      suggestions: [],
      items: [
        {
          scope: "docx:document:readonly",
          status: "pending_authorization",
          source: "user_scope",
          reason: "User authorization still needs to be completed.",
          tools: ["feishu_fetch_doc"],
          sensitive: false,
        },
        {
          scope: "task:task:write",
          status: "missing",
          source: "user_scope",
          reason: "The current Feishu user authorization does not include this scope.",
          tools: ["feishu_task_task"],
          sensitive: false,
        },
      ],
    });

    renderWithProviders(<FeishuToolsSettingsPageComponent />);

    const startOauthButton = (await screen.findByRole("button", {
      name: "Start Feishu OAuth",
    })) as HTMLButtonElement;
    await waitFor(() => {
      expect(startOauthButton.disabled).toBe(false);
    });
    await waitFor(() => {
      expect(screen.queryAllByText("Following exposed tool set").length).toBeGreaterThan(0);
    });

    fireEvent.click(startOauthButton);

    await waitFor(() => {
      expect(settingsApiState.feishuToolsOauthLogin).toHaveBeenCalledWith("ws-1", {
        scopes: ["docx:document:readonly"],
      });
    });
  });

  it("can request OAuth for only the selected missing scopes", async () => {
    settingsApiState.readFeishuToolsConfig.mockResolvedValue({
      config: {
        enabled: true,
        appId: "cli_demo",
        appSecretSet: true,
        mcpEndpoint: "",
        oauthMode: "user_oauth",
        sensitiveWriteGuard: true,
        toolAllowlist: [],
      },
      runtimeIntegration: {
        status: "configured",
      },
      warnings: [],
    });
    settingsApiState.readFeishuToolsPermissions.mockResolvedValue({
      overallStatus: "pending_authorization",
      grantedScopes: [],
      missingScopes: ["docx:document:readonly", "task:task:write", "offline_access"],
      sensitiveScopes: [],
      suggestions: [],
      items: [
        {
          scope: "docx:document:readonly",
          status: "pending_authorization",
          source: "user_scope",
          reason: "User authorization still needs to be completed.",
          tools: ["feishu_fetch_doc"],
          sensitive: false,
        },
        {
          scope: "task:task:write",
          status: "missing",
          source: "user_scope",
          reason: "The current Feishu user authorization does not include this scope.",
          tools: ["feishu_task_task"],
          sensitive: false,
        },
        {
          scope: "offline_access",
          status: "pending_authorization",
          source: "oauth_core_scope",
          reason: "The workspace still needs offline_access so Feishu can issue and rotate refresh tokens.",
          tools: [],
          sensitive: false,
        },
      ],
    });

    renderWithProviders(<FeishuToolsSettingsPageComponent />);

    await screen.findByRole("button", { name: "Start Feishu OAuth" });

    await clickOptionLabel("Request selected missing scopes directly");
    fireEvent.click(screen.getByRole("checkbox", { name: /docx:document:readonly/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /offline_access/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start Feishu OAuth" }));

    await waitFor(() => {
      expect(settingsApiState.feishuToolsOauthLogin).toHaveBeenCalledWith("ws-1", {
        scopes: ["task:task:write"],
      });
    });
  });

  it("can derive OAuth scopes from selected tools", async () => {
    settingsApiState.readFeishuToolsConfig.mockResolvedValue({
      config: {
        enabled: true,
        appId: "cli_demo",
        appSecretSet: true,
        mcpEndpoint: "",
        oauthMode: "user_oauth",
        sensitiveWriteGuard: true,
        toolAllowlist: [],
      },
      runtimeIntegration: {
        status: "configured",
      },
      warnings: [],
    });
    settingsApiState.readFeishuToolsPermissions.mockResolvedValue({
      overallStatus: "pending_authorization",
      grantedScopes: [],
      missingScopes: ["docx:document:readonly", "task:task:write"],
      sensitiveScopes: [],
      suggestions: [],
      items: [
        {
          scope: "docx:document:readonly",
          status: "pending_authorization",
          source: "user_scope",
          reason: "User authorization still needs to be completed.",
          tools: ["feishu_fetch_doc"],
          sensitive: false,
        },
        {
          scope: "task:task:write",
          status: "missing",
          source: "user_scope",
          reason: "The current Feishu user authorization does not include this scope.",
          tools: ["feishu_task_task"],
          sensitive: false,
        },
      ],
    });

    renderWithProviders(<FeishuToolsSettingsPageComponent />);

    await screen.findByRole("button", { name: "Start Feishu OAuth" });

    await clickOptionLabel("Request scopes from selected tools");
    await clickOptionLabel("Read Document");
    await waitFor(() => {
      expect(screen.queryAllByText("Custom OAuth tool set").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Feishu OAuth" }));

    await waitFor(() => {
      expect(settingsApiState.feishuToolsOauthLogin).toHaveBeenCalledWith("ws-1", {
        scopes: ["task:task:write"],
      });
    });
  });

  it("can restore OAuth tool selection back to the exposed tool set", async () => {
    settingsApiState.readFeishuToolsConfig.mockResolvedValue({
      config: {
        enabled: true,
        appId: "cli_demo",
        appSecretSet: true,
        mcpEndpoint: "",
        oauthMode: "user_oauth",
        sensitiveWriteGuard: true,
        toolAllowlist: ["feishu_fetch_doc"],
      },
      runtimeIntegration: {
        status: "configured",
      },
      warnings: [],
    });
    settingsApiState.readFeishuToolsPermissions.mockResolvedValue({
      overallStatus: "pending_authorization",
      grantedScopes: [],
      missingScopes: ["docx:document:readonly", "task:task:write"],
      sensitiveScopes: [],
      suggestions: [],
      items: [
        {
          scope: "docx:document:readonly",
          status: "pending_authorization",
          source: "user_scope",
          reason: "User authorization still needs to be completed.",
          tools: ["feishu_fetch_doc"],
          sensitive: false,
        },
        {
          scope: "task:task:write",
          status: "missing",
          source: "user_scope",
          reason: "The current Feishu user authorization does not include this scope.",
          tools: ["feishu_task_task"],
          sensitive: false,
        },
      ],
    });

    renderWithProviders(<FeishuToolsSettingsPageComponent />);

    await screen.findByRole("button", { name: "Start Feishu OAuth" });
    await screen.findByText("Exposed tool boundary");
    await screen.findByText("OAuth tool boundary");
    await screen.findByText("Derived scope request");

    fireEvent.click(screen.getByRole("button", { name: "Select all requestable tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Use exposed tool set" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Feishu OAuth" }));

    await waitFor(() => {
      expect(settingsApiState.feishuToolsOauthLogin).toHaveBeenCalledWith("ws-1", {
        scopes: ["docx:document:readonly"],
      });
    });
  });

  it("can request OAuth with a manually entered scope list", async () => {
    settingsApiState.readFeishuToolsConfig.mockResolvedValue({
      config: {
        enabled: true,
        appId: "cli_demo",
        appSecretSet: true,
        mcpEndpoint: "",
        oauthMode: "user_oauth",
        sensitiveWriteGuard: true,
        toolAllowlist: [],
      },
      runtimeIntegration: {
        status: "configured",
      },
      warnings: [],
    });
    settingsApiState.readFeishuToolsPermissions.mockResolvedValue({
      overallStatus: "pending_authorization",
      grantedScopes: [],
      missingScopes: ["docx:document:readonly"],
      sensitiveScopes: [],
      suggestions: [],
      items: [
        {
          scope: "docx:document:readonly",
          status: "pending_authorization",
          source: "user_scope",
          reason: "User authorization still needs to be completed.",
          tools: ["feishu_fetch_doc"],
          sensitive: false,
        },
      ],
    });

    renderWithProviders(<FeishuToolsSettingsPageComponent />);

    await screen.findByRole("button", { name: "Start Feishu OAuth" });

    await clickOptionLabel("Request manually entered scopes");
    fireEvent.change(screen.getByLabelText("Manual OAuth scopes"), {
      target: {
        value: "task:task:write\noffline_access\n\ntask:task:write",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Feishu OAuth" }));

    await waitFor(() => {
      expect(settingsApiState.feishuToolsOauthLogin).toHaveBeenCalledWith("ws-1", {
        scopes: ["offline_access", "task:task:write"],
      });
    });
  });
});
