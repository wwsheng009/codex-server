import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  SettingRow,
  SettingsGroup,
  SettingsJsonPreview,
  SettingsPageHeader,
  SettingsRecord,
} from "../../components/settings/SettingsPrimitives";
import { InlineNotice } from "../../components/ui/InlineNotice";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { SelectControl } from "../../components/ui/SelectControl";
import { Switch } from "../../components/ui/Switch";
import { StatusPill } from "../../components/ui/StatusPill";
import type {
  FeishuToolsAuthState,
  FeishuToolsCapabilitiesResult,
  FeishuToolsCapabilityCategory,
  FeishuToolsInvokeProgressEvent,
  FeishuToolsInvokeProgressPayload,
  FeishuToolsPermissionItem,
} from "../../types/api";
import { TextArea } from "../../components/ui/TextArea";
import { SettingsWorkspaceScopePanel } from "../../components/settings/SettingsWorkspaceScopePanel";
import {
  feishuToolsOauthLogin,
  invokeFeishuTool,
  readFeishuToolsCapabilities,
  readFeishuToolsConfig,
  readFeishuToolsOauthStatus,
  readFeishuToolsPermissions,
  readFeishuToolsStatus,
  revokeFeishuToolsOauth,
  writeFeishuToolsConfig,
} from "../../features/settings/api";
import { useSettingsShellContext } from "../../features/settings/shell-context";
import {
  useWorkspaceEventSubscription,
  useWorkspaceStream,
} from "../../hooks/useWorkspaceStream";
import { i18n } from "../../i18n/runtime";
import { getErrorMessage } from "../../lib/error-utils";

export function FeishuToolsSettingsPage() {
  const queryClient = useQueryClient();
  const { workspaceId, workspaceName } = useSettingsShellContext();
  const [enabled, setEnabled] = useState(false);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [oauthMode, setOauthMode] = useState<"app_only" | "user_oauth">("user_oauth");
  const [sensitiveWriteGuard, setSensitiveWriteGuard] = useState(true);
  const [toolSelectionMode, setToolSelectionMode] = useState<"all" | "custom">("all");
  const [selectedToolNames, setSelectedToolNames] = useState<string[]>([]);
  const [toolSelectorOpen, setToolSelectorOpen] = useState(false);
  const [toolSelectorDraftMode, setToolSelectorDraftMode] = useState<"all" | "custom">("all");
  const [toolSelectorDraftSelection, setToolSelectorDraftSelection] = useState<string[]>([]);
  const [toolSelectorQuery, setToolSelectorQuery] = useState("");
  const [toolSelectorCategory, setToolSelectorCategory] = useState("all");
  const [toolSelectorPage, setToolSelectorPage] = useState(1);
  const [toolSelectorPageSize, setToolSelectorPageSize] = useState("10");
  const [permissionQuery, setPermissionQuery] = useState("");
  const [permissionPage, setPermissionPage] = useState(1);
  const [permissionPageSize, setPermissionPageSize] = useState("10");
  const [oauthScopeRequestMode, setOauthScopeRequestMode] = useState<"all_missing" | "selected_tools" | "selected_missing" | "manual">("selected_tools");
  const [selectedOauthScopes, setSelectedOauthScopes] = useState<string[]>([]);
  const [selectedOauthToolNames, setSelectedOauthToolNames] = useState<string[]>([]);
  const [oauthToolSelectionDirty, setOauthToolSelectionDirty] = useState(false);
  const [manualOauthScopesInput, setManualOauthScopesInput] = useState("");

  const configQuery = useQuery({
    queryKey: ["feishu-tools-config", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readFeishuToolsConfig(workspaceId!),
  });
  const statusQuery = useQuery({
    queryKey: ["feishu-tools-status", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readFeishuToolsStatus(workspaceId!),
  });
  const capabilitiesQuery = useQuery({
    queryKey: ["feishu-tools-capabilities", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readFeishuToolsCapabilities(workspaceId!),
  });
  const permissionsQuery = useQuery({
    queryKey: ["feishu-tools-permissions", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readFeishuToolsPermissions(workspaceId!),
  });

  useEffect(() => {
    const config = configQuery.data?.config;
    if (!config) {
      return;
    }
    setEnabled(config.enabled);
    setAppId(config.appId ?? "");
    setAppSecret("");
    setOauthMode(config.oauthMode ?? "user_oauth");
    setSensitiveWriteGuard(config.sensitiveWriteGuard ?? true);
    const normalizedAllowlist = normalizeToolNames(config.toolAllowlist ?? []);
    setToolSelectionMode(normalizedAllowlist.length > 0 ? "custom" : "all");
    setSelectedToolNames(normalizedAllowlist);
  }, [configQuery.data]);

  const configMutation = useMutation({
    mutationFn: () =>
      writeFeishuToolsConfig(workspaceId!, {
        enabled,
        appId,
        appSecret: appSecret.trim() || undefined,
        mcpEndpoint: "",
        oauthMode,
        sensitiveWriteGuard,
        toolAllowlist: toolSelectionMode === "all" ? [] : selectedToolNames,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feishu-tools-config", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["feishu-tools-status", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["feishu-tools-capabilities", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["feishu-tools-permissions", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["mcp-server-status", workspaceId] }),
      ]);
      setAppSecret("");
    },
  });

  const oauthMutation = useMutation({
    mutationFn: () =>
      feishuToolsOauthLogin(workspaceId!, {
        scopes: buildRequestedOauthScopes(
          oauthScopeRequestMode,
          requestableOauthScopes,
          requestableOauthPermissionItems,
          selectedOauthScopes,
          selectedOauthToolNames,
          manualOauthScopesInput,
        ),
      }),
    onSuccess: (result) => {
      if (result?.authorizationUrl) {
        window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
      }
    },
  });

  const oauthStatusQuery = useQuery({
    queryKey: ["feishu-tools-oauth-status", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readFeishuToolsOauthStatus(workspaceId!),
  });

  const revokeMutation = useMutation({
    mutationFn: () => revokeFeishuToolsOauth(workspaceId!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feishu-tools-status", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["feishu-tools-oauth-status", workspaceId] }),
      ]);
    },
  });

  const [invokeToolName, setInvokeToolName] = useState("feishu_fetch_doc");
  const [invokeAction, setInvokeAction] = useState("");
  const [invokeParamsInput, setInvokeParamsInput] = useState(
    '{\n  "documentId": ""\n}',
  );
  const [invokeParamsError, setInvokeParamsError] = useState<string | null>(null);
  const [activeInvokeId, setActiveInvokeId] = useState<string | null>(null);
  const [invokeLiveEvents, setInvokeLiveEvents] = useState<FeishuToolsInvokeProgressEvent[]>([]);

  useWorkspaceStream(workspaceId);
  useWorkspaceEventSubscription(
    workspaceId ? [workspaceId] : undefined,
    (event) => {
      if (event.method !== "feishuTools/invoke/progress") {
        return;
      }
      const payload = parseFeishuInvokeProgressPayload(event.payload);
      if (!payload || !activeInvokeId || payload.invocationId !== activeInvokeId) {
        return;
      }
      setInvokeLiveEvents((current) => mergeInvokeProgressEvents(current, payload));
    },
  );

  const invokeMutation = useMutation({
    mutationFn: () => {
      let parsedParams: Record<string, unknown> = {};
      const trimmed = invokeParamsInput.trim();
      if (trimmed) {
        try {
          const value = JSON.parse(trimmed);
          if (value && typeof value === "object" && !Array.isArray(value)) {
            parsedParams = value as Record<string, unknown>;
          } else {
            throw new Error(
              i18n._({
                id: "params must be a JSON object",
                message: "params must be a JSON object",
              }),
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setInvokeParamsError(message);
          return Promise.reject(error);
        }
      }
      setInvokeParamsError(null);
      const invocationId = createFeishuInvocationId();
      setActiveInvokeId(invocationId);
      setInvokeLiveEvents([]);
      return invokeFeishuTool(workspaceId!, {
        invocationId,
        toolName: invokeToolName.trim(),
        action: invokeAction.trim() || undefined,
        params: parsedParams,
      });
    },
  });

  useEffect(() => {
    if (!invokeMutation.data?.invocationId) {
      return;
    }
    setActiveInvokeId(invokeMutation.data.invocationId);
  }, [invokeMutation.data?.invocationId]);

  const oauthModeOptions = useMemo(
    () => [
      {
        value: "user_oauth",
        label: i18n._({ id: "User OAuth", message: "User OAuth" }),
        triggerLabel: i18n._({ id: "User OAuth", message: "User OAuth" }),
      },
      {
        value: "app_only",
        label: i18n._({ id: "App Only", message: "App Only" }),
        triggerLabel: i18n._({ id: "App Only", message: "App Only" }),
      },
    ],
    [],
  );

  const categories = capabilitiesQuery.data?.categories ?? [];
  const toolCatalog = useMemo(() => flattenToolCatalog(categories), [categories]);
  const totalToolCount =
    toolCatalog.length || capabilitiesQuery.data?.summary?.totalCount || 0;
  const selectedToolCount =
    toolSelectionMode === "all" ? totalToolCount : selectedToolNames.length;
  const selectedToolPreview = useMemo(
    () =>
      selectedToolNames.slice(0, 8).map((toolName) => ({
        label: resolveToolLabel(toolCatalog, toolName),
        toolName,
      })),
    [selectedToolNames, toolCatalog],
  );
  const toolSelectorCategoryOptions = useMemo(
    () => [
      {
        value: "all",
        label: i18n._({ id: "All categories", message: "All categories" }),
        triggerLabel: i18n._({ id: "All categories", message: "All categories" }),
      },
      ...categories.map((category) => ({
        value: category.id,
        label: category.title,
        triggerLabel: category.title,
      })),
    ],
    [categories],
  );
  const toolSelectorPageSizeOptions = useMemo(
    () => [
      { value: "10", label: "10", triggerLabel: "10" },
      { value: "20", label: "20", triggerLabel: "20" },
      { value: "50", label: "50", triggerLabel: "50" },
    ],
    [],
  );
  const visibleToolSections = useMemo(
    () =>
      filterToolSections(
        categories,
        toolSelectorQuery,
        toolSelectorCategory,
      ),
    [categories, toolSelectorCategory, toolSelectorQuery],
  );
  const visibleToolRows = useMemo(
    () =>
      visibleToolSections.flatMap((section) =>
        (section.items ?? []).map((item) => ({
          ...item,
          categoryDescription: section.description,
          categoryId: section.categoryId,
          categoryTitle: section.categoryTitle,
        })),
      ),
    [visibleToolSections],
  );
  const visibleToolNames = useMemo(
    () => visibleToolRows.map((item) => item.toolName),
    [visibleToolRows],
  );
  const parsedToolSelectorPageSize = Math.max(
    1,
    Number.parseInt(toolSelectorPageSize, 10) || 10,
  );
  const toolSelectorTotalPages = Math.max(
    1,
    Math.ceil(visibleToolRows.length / parsedToolSelectorPageSize),
  );
  const pagedVisibleToolRows = useMemo(() => {
    const startIndex = (toolSelectorPage - 1) * parsedToolSelectorPageSize;
    return visibleToolRows.slice(startIndex, startIndex + parsedToolSelectorPageSize);
  }, [parsedToolSelectorPageSize, toolSelectorPage, visibleToolRows]);
  const pagedVisibleStart =
    visibleToolRows.length === 0
      ? 0
      : (toolSelectorPage - 1) * parsedToolSelectorPageSize + 1;
  const pagedVisibleEnd = Math.min(
    visibleToolRows.length,
    toolSelectorPage * parsedToolSelectorPageSize,
  );
  const permissionItems = permissionsQuery.data?.items ?? [];
  const grantedPermissionItems = permissionItems.filter((item) => item.status === "granted");
  const missingPermissionItems = permissionItems.filter((item) => item.status === "missing");
  const sensitivePermissionItems = permissionItems.filter((item) => item.sensitive);
  const requestableOauthScopes = permissionsQuery.data?.missingScopes ?? [];
  const requestableOauthPermissionItems = useMemo(
    () => buildRequestableOauthPermissionItems(permissionItems, requestableOauthScopes),
    [permissionItems, requestableOauthScopes],
  );
  const requestableOauthToolItems = useMemo(
    () => buildRequestableOauthToolItems(toolCatalog, requestableOauthPermissionItems),
    [requestableOauthPermissionItems, toolCatalog],
  );
  const defaultSelectedOauthToolNames = useMemo(
    () =>
      buildDefaultSelectedOauthToolNames(
        requestableOauthToolItems,
        toolSelectionMode,
        selectedToolNames,
      ),
    [requestableOauthToolItems, selectedToolNames, toolSelectionMode],
  );
  const isOauthToolSelectionSyncedWithExposure = useMemo(
    () =>
      areNormalizedStringListsEqual(
        selectedOauthToolNames,
        defaultSelectedOauthToolNames,
      ),
    [defaultSelectedOauthToolNames, selectedOauthToolNames],
  );
  const exposedRequestableOauthToolItems = useMemo(
    () =>
      requestableOauthToolItems.filter((item) =>
        defaultSelectedOauthToolNames.includes(item.toolName),
      ),
    [defaultSelectedOauthToolNames, requestableOauthToolItems],
  );
  const selectedOauthToolItems = useMemo(
    () =>
      requestableOauthToolItems.filter((item) =>
        selectedOauthToolNames.includes(item.toolName),
      ),
    [requestableOauthToolItems, selectedOauthToolNames],
  );
  const oauthToolsAddedBeyondExposure = useMemo(
    () =>
      selectedOauthToolItems.filter(
        (item) => !defaultSelectedOauthToolNames.includes(item.toolName),
      ),
    [defaultSelectedOauthToolNames, selectedOauthToolItems],
  );
  const oauthToolsSkippedFromExposure = useMemo(
    () =>
      exposedRequestableOauthToolItems.filter(
        (item) => !selectedOauthToolNames.includes(item.toolName),
      ),
    [exposedRequestableOauthToolItems, selectedOauthToolNames],
  );
  const selectedOauthScopeCount = selectedOauthScopes.filter((scope) =>
    requestableOauthScopes.includes(scope),
  ).length;
  const selectedOauthToolCount = selectedOauthToolNames.filter((toolName) =>
    requestableOauthToolItems.some((item) => item.toolName === toolName),
  ).length;
  const selectedToolDerivedOauthScopes = useMemo(
    () => buildRequestedScopesFromTools(requestableOauthPermissionItems, selectedOauthToolNames),
    [requestableOauthPermissionItems, selectedOauthToolNames],
  );
  const manualOauthScopes = useMemo(
    () => normalizeScopeNames(parseScopeInput(manualOauthScopesInput)),
    [manualOauthScopesInput],
  );
  const filteredPermissionItems = useMemo(() => {
    const normalizedQuery = permissionQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return permissionItems;
    }
    return permissionItems.filter((item) => {
      const haystack = [
        item.scope,
        item.status,
        item.source,
        item.reason,
        item.sensitive ? "sensitive" : "",
        ...(item.tools ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [permissionItems, permissionQuery]);
  const parsedPermissionPageSize = Math.max(
    1,
    Number.parseInt(permissionPageSize, 10) || 10,
  );
  const permissionTotalPages = Math.max(
    1,
    Math.ceil(filteredPermissionItems.length / parsedPermissionPageSize),
  );
  const pagedPermissionItems = useMemo(() => {
    const startIndex = (permissionPage - 1) * parsedPermissionPageSize;
    return filteredPermissionItems.slice(startIndex, startIndex + parsedPermissionPageSize);
  }, [filteredPermissionItems, parsedPermissionPageSize, permissionPage]);
  const pagedPermissionStart =
    filteredPermissionItems.length === 0
      ? 0
      : (permissionPage - 1) * parsedPermissionPageSize + 1;
  const pagedPermissionEnd = Math.min(
    filteredPermissionItems.length,
    permissionPage * parsedPermissionPageSize,
  );
  const runtimeIntegration =
    statusQuery.data?.runtimeIntegration ?? configQuery.data?.runtimeIntegration ?? null;
  const managedMcpEndpoint =
    runtimeIntegration?.serverUrl ?? statusQuery.data?.serviceEndpoint ?? configQuery.data?.config.mcpEndpoint ?? "";
  const persistedTokenSnapshot = useMemo(
    () => buildPersistedTokenSnapshot(oauthStatusQuery.data),
    [oauthStatusQuery.data],
  );
  const persistedTokenSnapshotCopyText = useMemo(
    () => formatPersistedTokenSnapshotForCopy(persistedTokenSnapshot),
    [persistedTokenSnapshot],
  );
  const invokeTimeline = useMemo(() => {
    const responseEvents = invokeMutation.data?.events ?? [];
    return invokeLiveEvents.length >= responseEvents.length ? invokeLiveEvents : responseEvents;
  }, [invokeLiveEvents, invokeMutation.data?.events]);
  const latestInvokeTimelineEvent =
    invokeTimeline.length > 0 ? invokeTimeline[invokeTimeline.length - 1] : null;

  useEffect(() => {
    setToolSelectorPage(1);
  }, [toolSelectorCategory, toolSelectorPageSize, toolSelectorQuery]);

  useEffect(() => {
    setPermissionPage(1);
  }, [permissionPageSize, permissionQuery]);

  useEffect(() => {
    if (toolSelectorPage > toolSelectorTotalPages) {
      setToolSelectorPage(toolSelectorTotalPages);
    }
  }, [toolSelectorPage, toolSelectorTotalPages]);

  useEffect(() => {
    if (permissionPage > permissionTotalPages) {
      setPermissionPage(permissionTotalPages);
    }
  }, [permissionPage, permissionTotalPages]);

  useEffect(() => {
    setSelectedOauthScopes((current) => {
      const next = current.filter((scope) => requestableOauthScopes.includes(scope));
      if (next.length > 0) {
        return next;
      }
      return normalizeScopeNames(requestableOauthScopes);
    });
  }, [requestableOauthScopes]);

  useEffect(() => {
    setSelectedOauthToolNames((current) => {
      const allowed = new Set(requestableOauthToolItems.map((item) => item.toolName));
      if (oauthToolSelectionDirty) {
        return normalizeToolNames(current.filter((toolName) => allowed.has(toolName)));
      }
      return defaultSelectedOauthToolNames;
    });
  }, [defaultSelectedOauthToolNames, oauthToolSelectionDirty, requestableOauthToolItems]);

  useEffect(() => {
    setOauthToolSelectionDirty(false);
  }, [selectedToolNames, toolSelectionMode]);

  async function handleCopyPersistedTokenSnapshot() {
    if (
      !persistedTokenSnapshotCopyText ||
      typeof navigator === "undefined" ||
      !navigator.clipboard?.writeText
    ) {
      return;
    }

    try {
      await navigator.clipboard.writeText(persistedTokenSnapshotCopyText);
    } catch {
      // Best-effort copy only.
    }
  }

  function openToolSelector() {
    setToolSelectorDraftMode(toolSelectionMode);
    setToolSelectorDraftSelection(selectedToolNames);
    setToolSelectorQuery("");
    setToolSelectorCategory("all");
    setToolSelectorPage(1);
    setToolSelectorOpen(true);
  }

  function closeToolSelector() {
    setToolSelectorOpen(false);
  }

  function toggleToolSelection(toolName: string) {
    setToolSelectorDraftSelection((current) =>
      current.includes(toolName)
        ? current.filter((candidate) => candidate !== toolName)
        : normalizeToolNames([...current, toolName]),
    );
  }

  function handleSelectAllVisible() {
    setToolSelectorDraftSelection((current) =>
      normalizeToolNames([...current, ...visibleToolNames]),
    );
  }

  function handleClearVisible() {
    setToolSelectorDraftSelection((current) =>
      current.filter((toolName) => !visibleToolNames.includes(toolName)),
    );
  }

  function applyToolSelector() {
    setToolSelectionMode(toolSelectorDraftMode);
    setSelectedToolNames(normalizeToolNames(toolSelectorDraftSelection));
    setToolSelectorOpen(false);
  }

  function toggleOauthScopeSelection(scope: string) {
    setSelectedOauthScopes((current) =>
      current.includes(scope)
        ? current.filter((candidate) => candidate !== scope)
        : normalizeScopeNames([...current, scope]),
    );
  }

  function selectAllOauthScopes() {
    setSelectedOauthScopes(normalizeScopeNames(requestableOauthScopes));
  }

  function clearOauthScopes() {
    setSelectedOauthScopes([]);
  }

  function toggleOauthToolSelection(toolName: string) {
    setOauthToolSelectionDirty(true);
    setSelectedOauthToolNames((current) =>
      current.includes(toolName)
        ? current.filter((candidate) => candidate !== toolName)
        : normalizeToolNames([...current, toolName]),
    );
  }

  function selectAllOauthTools() {
    setOauthToolSelectionDirty(true);
    setSelectedOauthToolNames(
      normalizeToolNames(requestableOauthToolItems.map((item) => item.toolName)),
    );
  }

  function syncOauthToolsToExposure() {
    setOauthToolSelectionDirty(false);
    setSelectedOauthToolNames(defaultSelectedOauthToolNames);
  }

  function clearOauthTools() {
    setOauthToolSelectionDirty(true);
    setSelectedOauthToolNames([]);
  }

  return (
    <section className="settings-page">
      <SettingsPageHeader
        eyebrow={i18n._({ id: "Feishu Tools", message: "Feishu Tools" })}
        title={i18n._({ id: "Feishu integration", message: "Feishu integration" })}
        description={i18n._({
          id: "Configure workspace-scoped Feishu tools for Docs, Drive, message history, Calendar, Tasks, Sheets, and Base.",
          message:
            "Configure workspace-scoped Feishu tools for Docs, Drive, message history, Calendar, Tasks, Sheets, and Base.",
        })}
        meta={
          <>
            <span className="meta-pill">{workspaceName}</span>
            <span className="meta-pill">
              {statusQuery.data?.overallStatus ??
                i18n._({ id: "Not configured", message: "Not configured" })}
            </span>
          </>
        }
      />

      <div className="settings-page__stack">
        <SettingsWorkspaceScopePanel />

        <SettingsGroup
          title={i18n._({ id: "Configuration", message: "Configuration" })}
          description={i18n._({
            id: "Save workspace-level Feishu app credentials, endpoint settings, and tool exposure rules.",
            message:
              "Save workspace-level Feishu app credentials, endpoint settings, and tool exposure rules.",
          })}
        >
          <SettingRow
            title={i18n._({ id: "Workspace settings", message: "Workspace settings" })}
            description={i18n._({
              id: "Enable Feishu tools, set credentials, choose OAuth mode, and control the allowlist.",
              message:
                "Enable Feishu tools, set credentials, choose OAuth mode, and control the allowlist.",
            })}
          >
            <form
              className="form-stack"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                if (workspaceId) {
                  configMutation.mutate();
                }
              }}
            >
              <Switch
                label={i18n._({ id: "Enable Feishu tools", message: "Enable Feishu tools" })}
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <Input
                label={i18n._({ id: "App ID", message: "App ID" })}
                onChange={(event) => setAppId(event.target.value)}
                value={appId}
              />
              <Input
                label={i18n._({ id: "App Secret", message: "App Secret" })}
                onChange={(event) => setAppSecret(event.target.value)}
                placeholder={
                  configQuery.data?.config.appSecretSet
                    ? i18n._({
                        id: "Leave blank to keep the existing secret",
                        message: "Leave blank to keep the existing secret",
                      })
                    : ""
                }
                value={appSecret}
              />
              <label className="field">
                <span>{i18n._({ id: "OAuth mode", message: "OAuth mode" })}</span>
                <SelectControl
                  ariaLabel={i18n._({ id: "OAuth mode", message: "OAuth mode" })}
                  fullWidth
                  onChange={(value) => setOauthMode(value as "app_only" | "user_oauth")}
                  options={oauthModeOptions}
                  value={oauthMode}
                />
              </label>
              <Switch
                label={i18n._({
                  id: "Sensitive write guard",
                  message: "Sensitive write guard",
                })}
                checked={sensitiveWriteGuard}
                onChange={(event) => setSensitiveWriteGuard(event.target.checked)}
              />
              <div className="feishu-tool-selector-card">
                <SettingsRecord
                  marker={toolSelectionMode === "all" ? "ALL" : "SET"}
                  title={i18n._({
                    id: "Tool exposure panel",
                    message: "Tool exposure panel",
                  })}
                  description={
                    toolSelectionMode === "all"
                      ? i18n._({
                          id: "All modeled Feishu tools are currently exposed to this workspace.",
                          message:
                            "All modeled Feishu tools are currently exposed to this workspace.",
                        })
                      : i18n._({
                          id: "Only the selected Feishu tools are exposed to this workspace.",
                          message:
                            "Only the selected Feishu tools are exposed to this workspace.",
                        })
                  }
                  meta={
                    <>
                      <span className="meta-pill">
                        {toolSelectionMode === "all"
                          ? i18n._({ id: "All tools", message: "All tools" })
                          : i18n._({ id: "Selected tools", message: "Selected tools" })}
                      </span>
                      <span className="meta-pill">
                        {i18n._({
                          id: "{count} active",
                          message: "{count} active",
                          values: { count: selectedToolCount },
                        })}
                      </span>
                    </>
                  }
                />
                <div className="feishu-tool-selector-card__actions">
                  <Button
                    disabled={!workspaceId}
                    intent="secondary"
                    onClick={openToolSelector}
                    type="button"
                  >
                    {i18n._({
                      id: "Configure tool panel",
                      message: "Configure tool panel",
                    })}
                  </Button>
                  <span className="field-hint">
                    {i18n._({
                      id: "Use the popup form to switch between expose-all and selected-only modes, then filter and batch-select tools.",
                      message:
                        "Use the popup form to switch between expose-all and selected-only modes, then filter and batch-select tools.",
                    })}
                  </span>
                </div>
                {toolSelectionMode === "custom" ? (
                  selectedToolPreview.length > 0 ? (
                    <div className="feishu-tool-selector-chip-list">
                      {selectedToolPreview.map((item) => (
                        <span key={item.toolName} className="meta-pill">
                          {item.label}
                        </span>
                      ))}
                      {selectedToolNames.length > selectedToolPreview.length ? (
                        <span className="meta-pill">
                          {i18n._({
                            id: "+{count} more",
                            message: "+{count} more",
                            values: {
                              count: selectedToolNames.length - selectedToolPreview.length,
                            },
                          })}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="field-hint">
                      {i18n._({
                        id: "Selected-only mode is enabled, but no tools are selected yet.",
                        message:
                          "Selected-only mode is enabled, but no tools are selected yet.",
                      })}
                    </span>
                  )
                ) : (
                  <span className="field-hint">
                    {i18n._({
                      id: "Leaving the selector in expose-all mode submits an empty allowlist to the backend.",
                      message:
                        "Leaving the selector in expose-all mode submits an empty allowlist to the backend.",
                    })}
                  </span>
                )}
              </div>
              <div className="setting-row__actions">
                <Button disabled={!workspaceId} isLoading={configMutation.isPending} type="submit">
                  {i18n._({ id: "Save configuration", message: "Save configuration" })}
                </Button>
              </div>
            </form>
            {configMutation.error ? (
              <InlineNotice
                dismissible
                noticeKey={`feishu-tools-config-${getErrorMessage(configMutation.error)}`}
                title={i18n._({
                  id: "Configuration update failed",
                  message: "Configuration update failed",
                })}
                tone="error"
              >
                {getErrorMessage(configMutation.error)}
              </InlineNotice>
            ) : null}
            {configMutation.data?.warnings && configMutation.data.warnings.length > 0 ? (
              <InlineNotice
                dismissible
                noticeKey="feishu-tools-config-warnings"
                title={i18n._({
                  id: "Runtime integration warnings",
                  message: "Runtime integration warnings",
                })}
                tone="info"
              >
                {configMutation.data.warnings.join(" ")}
              </InlineNotice>
            ) : null}
            <InlineNotice
              noticeKey="feishu-tools-thread-bot-routing"
              title={i18n._({
                id: "Thread and bot routing",
                message: "Thread and bot routing",
              })}
              tone="info"
            >
              {i18n._({
                id: "codex-server now hosts the Feishu MCP adapter itself. Saving this page manages workspace mcp_servers.feishu-tools automatically, threads use that MCP server directly, and bots can use the same Feishu tools only through the thread they are bound to.",
                message:
                  "codex-server now hosts the Feishu MCP adapter itself. Saving this page manages workspace mcp_servers.feishu-tools automatically, threads use that MCP server directly, and bots can use the same Feishu tools only through the thread they are bound to.",
              })}
            </InlineNotice>
            {managedMcpEndpoint ? (
              <InlineNotice
                noticeKey="feishu-tools-managed-mcp-endpoint"
                title={i18n._({
                  id: "Managed MCP endpoint",
                  message: "Managed MCP endpoint",
                })}
                tone="info"
              >
                <code>{managedMcpEndpoint}</code>
              </InlineNotice>
            ) : null}
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={i18n._({ id: "Status and authorization", message: "Status and authorization" })}
          description={i18n._({
            id: "Review readiness checks and start the Feishu OAuth flow for user-scoped tools.",
            message:
              "Review readiness checks and start the Feishu OAuth flow for user-scoped tools.",
          })}
        >
          <SettingRow
            title={i18n._({ id: "OAuth", message: "OAuth" })}
            description={i18n._({
              id: "Use the current permission set to start a Feishu OAuth login for this workspace.",
              message:
                "Use the current permission set to start a Feishu OAuth login for this workspace.",
            })}
          >
            <div className="form-stack">
              {oauthStatusQuery.data ? (
                <SettingsRecord
                  marker={authStatusMarker(oauthStatusQuery.data.status)}
                  title={i18n._({
                    id: "Authorization status",
                    message: "Authorization status",
                  })}
                  description={authStatusDescription(oauthStatusQuery.data.status)}
                  meta={
                    <>
                      <span className="meta-pill">{oauthStatusQuery.data.status}</span>
                      {oauthStatusQuery.data.principalType ? (
                        <span className="meta-pill">
                          {oauthStatusQuery.data.principalType}
                        </span>
                      ) : null}
                      {oauthStatusQuery.data.openId ? (
                        <span className="meta-pill">{oauthStatusQuery.data.openId}</span>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {oauthStatusQuery.data?.callbackUrl ? (
                <InlineNotice
                  noticeKey="feishu-tools-oauth-callback"
                  title={i18n._({
                    id: "Register this callback URL in the Feishu Open Platform",
                    message: "Register this callback URL in the Feishu Open Platform",
                  })}
                  tone="info"
                >
                  <div className="form-stack">
                    <span>
                      {i18n._({
                        id: "This URL is generated from the configured public base URL when present. Otherwise, the app falls back to the current request origin, which also works for localhost development.",
                        message:
                          "This URL is generated from the configured public base URL when present. Otherwise, the app falls back to the current request origin, which also works for localhost development.",
                      })}
                    </span>
                    <code>{oauthStatusQuery.data.callbackUrl}</code>
                  </div>
                </InlineNotice>
              ) : null}
              {oauthStatusQuery.data?.grantedScopes &&
              oauthStatusQuery.data.grantedScopes.length > 0 ? (
                <SettingsJsonPreview
                  title={i18n._({ id: "Granted scopes", message: "Granted scopes" })}
                  description={i18n._({
                    id: "Scopes currently attached to the persisted Feishu user token.",
                    message:
                      "Scopes currently attached to the persisted Feishu user token.",
                  })}
                  value={oauthStatusQuery.data.grantedScopes}
                />
              ) : null}
              {persistedTokenSnapshot ? (
                <div className="settings-subsection settings-output-card">
                  <div className="settings-subsection__header">
                    <div className="settings-output-card__title-block">
                      <strong>
                        {i18n._({
                          id: "Persisted token snapshot",
                          message: "Persisted token snapshot",
                        })}
                      </strong>
                      <p>
                        {i18n._({
                          id: "Masked preview of the token material currently saved for this workspace.",
                          message:
                            "Masked preview of the token material currently saved for this workspace.",
                        })}
                      </p>
                    </div>
                    <div className="settings-output-card__actions">
                      <button
                        className="notice__tool"
                        onClick={() => void handleCopyPersistedTokenSnapshot()}
                        type="button"
                      >
                        {i18n._({
                          id: "Copy masked snapshot",
                          message: "Copy masked snapshot",
                        })}
                      </button>
                    </div>
                  </div>
                  <div className="feishu-token-snapshot-table__viewport">
                    <table className="feishu-token-snapshot-table">
                      <colgroup>
                        <col className="feishu-token-snapshot-table__col feishu-token-snapshot-table__col--field" />
                        <col className="feishu-token-snapshot-table__col feishu-token-snapshot-table__col--value" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="feishu-token-snapshot-table__header" scope="col">
                            {i18n._({ id: "Field", message: "Field" })}
                          </th>
                          <th className="feishu-token-snapshot-table__header" scope="col">
                            {i18n._({ id: "Value", message: "Value" })}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {persistedTokenSnapshot.map((item) => (
                          <tr className="feishu-token-snapshot-table__row" key={item.key}>
                            <td className="feishu-token-snapshot-table__cell">
                              <div className="feishu-token-snapshot-table__field">{item.label}</div>
                            </td>
                            <td className="feishu-token-snapshot-table__cell">
                              <div className="feishu-token-snapshot-table__value">
                                {item.code ? <code>{item.value}</code> : item.value}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
              {permissionsQuery.data ? (
                <div className="feishu-tool-selector-card">
                  <SettingsRecord
                    marker={
                      oauthScopeRequestMode === "all_missing"
                        ? "ALL"
                        : oauthScopeRequestMode === "selected_tools"
                          ? "TOOL"
                        : oauthScopeRequestMode === "selected_missing"
                          ? "SET"
                          : "MAN"
                    }
                    title={i18n._({
                      id: "OAuth scope request",
                      message: "OAuth scope request",
                    })}
                    description={
                      oauthScopeRequestMode === "all_missing"
                        ? i18n._({
                            id: "The next OAuth run will request every currently missing scope for the enabled tool set.",
                            message:
                              "The next OAuth run will request every currently missing scope for the enabled tool set.",
                          })
                        : oauthScopeRequestMode === "selected_tools"
                          ? i18n._({
                              id: "The next OAuth run will derive scopes from the selected tools and request only the currently missing user permissions those tools still need.",
                              message:
                                "The next OAuth run will derive scopes from the selected tools and request only the currently missing user permissions those tools still need.",
                            })
                        : oauthScopeRequestMode === "selected_missing"
                          ? i18n._({
                              id: "The next OAuth run will request only the missing scopes selected below.",
                              message:
                                "The next OAuth run will request only the missing scopes selected below.",
                            })
                          : i18n._({
                              id: "The next OAuth run will request the exact scopes entered below, even if they are not part of the current missing-scope summary.",
                              message:
                                "The next OAuth run will request the exact scopes entered below, even if they are not part of the current missing-scope summary.",
                            })
                    }
                    meta={
                      <>
                        <span className="meta-pill">
                          {oauthScopeRequestMode === "all_missing"
                            ? i18n._({ id: "All missing scopes", message: "All missing scopes" })
                            : oauthScopeRequestMode === "selected_tools"
                              ? i18n._({ id: "Selected tools -> scopes", message: "Selected tools -> scopes" })
                            : oauthScopeRequestMode === "selected_missing"
                              ? i18n._({ id: "Selected missing scopes", message: "Selected missing scopes" })
                              : i18n._({ id: "Manual scope list", message: "Manual scope list" })}
                        </span>
                        <span className="meta-pill">
                          {i18n._({
                            id: "{count} requestable",
                            message: "{count} requestable",
                            values: { count: requestableOauthPermissionItems.length },
                          })}
                        </span>
                        {oauthScopeRequestMode === "selected_missing" ? (
                          <span className="meta-pill">
                            {i18n._({
                              id: "{count} selected",
                              message: "{count} selected",
                              values: { count: selectedOauthScopeCount },
                            })}
                          </span>
                        ) : null}
                        {oauthScopeRequestMode === "selected_tools" ? (
                          <>
                            <span className="meta-pill">
                              {isOauthToolSelectionSyncedWithExposure
                                ? i18n._({
                                    id: "Following exposed tool set",
                                    message: "Following exposed tool set",
                                  })
                                : i18n._({
                                    id: "Custom OAuth tool set",
                                    message: "Custom OAuth tool set",
                                  })}
                            </span>
                            <span className="meta-pill">
                              {i18n._({
                                id: "{count} tools selected",
                                message: "{count} tools selected",
                                values: { count: selectedOauthToolCount },
                              })}
                            </span>
                            <span className="meta-pill">
                              {i18n._({
                                id: "{count} scopes derived",
                                message: "{count} scopes derived",
                                values: { count: selectedToolDerivedOauthScopes.length },
                              })}
                            </span>
                          </>
                        ) : null}
                        {oauthScopeRequestMode === "manual" ? (
                          <span className="meta-pill">
                            {i18n._({
                              id: "{count} manual",
                              message: "{count} manual",
                              values: { count: manualOauthScopes.length },
                            })}
                          </span>
                        ) : null}
                      </>
                    }
                  />
                  <fieldset
                    className="feishu-tool-selector-mode"
                    aria-label={i18n._({
                      id: "OAuth scope request mode",
                      message: "OAuth scope request mode",
                    })}
                  >
                    <legend>
                      {i18n._({
                        id: "Choose how many missing scopes to request",
                        message: "Choose how many missing scopes to request",
                      })}
                    </legend>
                    <label className="feishu-tool-selector-mode__option">
                      <input
                        checked={oauthScopeRequestMode === "all_missing"}
                        name="feishu-oauth-scope-mode"
                        onChange={() => setOauthScopeRequestMode("all_missing")}
                        type="radio"
                      />
                      <div>
                        <strong>
                          {i18n._({
                            id: "Request all missing scopes",
                            message: "Request all missing scopes",
                          })}
                        </strong>
                        <span>
                          {i18n._({
                            id: "Best when you want one OAuth run to cover the entire currently enabled tool set.",
                            message:
                              "Best when you want one OAuth run to cover the entire currently enabled tool set.",
                          })}
                        </span>
                      </div>
                    </label>
                    <label className="feishu-tool-selector-mode__option">
                      <input
                        checked={oauthScopeRequestMode === "selected_tools"}
                        name="feishu-oauth-scope-mode"
                        onChange={() => setOauthScopeRequestMode("selected_tools")}
                        type="radio"
                      />
                      <div>
                        <strong>
                          {i18n._({
                            id: "Request scopes from selected tools",
                            message: "Request scopes from selected tools",
                          })}
                        </strong>
                        <span>
                          {i18n._({
                            id: "Best when you want authorization to follow the exact tool set you are about to expose or test.",
                            message:
                              "Best when you want authorization to follow the exact tool set you are about to expose or test.",
                          })}
                        </span>
                      </div>
                    </label>
                    <label className="feishu-tool-selector-mode__option">
                      <input
                        checked={oauthScopeRequestMode === "selected_missing"}
                        name="feishu-oauth-scope-mode"
                        onChange={() => setOauthScopeRequestMode("selected_missing")}
                        type="radio"
                      />
                      <div>
                        <strong>
                          {i18n._({
                            id: "Request selected missing scopes directly",
                            message: "Request selected missing scopes directly",
                          })}
                        </strong>
                        <span>
                          {i18n._({
                            id: "Best when you want staged rollout or want to avoid requesting high-risk scopes too early.",
                            message:
                              "Best when you want staged rollout or want to avoid requesting high-risk scopes too early.",
                          })}
                        </span>
                      </div>
                    </label>
                    <label className="feishu-tool-selector-mode__option">
                      <input
                        checked={oauthScopeRequestMode === "manual"}
                        name="feishu-oauth-scope-mode"
                        onChange={() => setOauthScopeRequestMode("manual")}
                        type="radio"
                      />
                      <div>
                        <strong>
                          {i18n._({
                            id: "Request manually entered scopes",
                            message: "Request manually entered scopes",
                          })}
                        </strong>
                        <span>
                          {i18n._({
                            id: "Best when you want to test a specific permission set or request scopes that are not currently highlighted as missing.",
                            message:
                              "Best when you want to test a specific permission set or request scopes that are not currently highlighted as missing.",
                          })}
                        </span>
                      </div>
                    </label>
                  </fieldset>
                  {oauthScopeRequestMode === "selected_tools" ? (
                    <>
                      <div className="form-stack">
                        <SettingsRecord
                          marker="1"
                          title={i18n._({
                            id: "Exposed tool boundary",
                            message: "Exposed tool boundary",
                          })}
                          description={
                            toolSelectionMode === "all"
                              ? i18n._({
                                  id: "The workspace currently exposes every modeled Feishu tool, so OAuth can derive scopes from the full requestable tool set.",
                                  message:
                                    "The workspace currently exposes every modeled Feishu tool, so OAuth can derive scopes from the full requestable tool set.",
                                })
                              : i18n._({
                                  id: "The workspace allowlist currently limits Feishu access to the selected tools below. OAuth can follow that same boundary.",
                                  message:
                                    "The workspace allowlist currently limits Feishu access to the selected tools below. OAuth can follow that same boundary.",
                                })
                          }
                          meta={
                            <>
                              <span className="meta-pill">
                                {toolSelectionMode === "all"
                                  ? i18n._({ id: "All tools", message: "All tools" })
                                  : i18n._({ id: "Selected tools", message: "Selected tools" })}
                              </span>
                              <span className="meta-pill">
                                {i18n._({
                                  id: "{count} requestable tools in scope",
                                  message: "{count} requestable tools in scope",
                                  values: { count: exposedRequestableOauthToolItems.length },
                                })}
                              </span>
                            </>
                          }
                        />
                        {exposedRequestableOauthToolItems.length > 0 ? (
                          <div className="feishu-tool-selector-chip-list">
                            {exposedRequestableOauthToolItems.slice(0, 8).map((item) => (
                              <span className="meta-pill" key={item.toolName}>
                                {item.title}
                              </span>
                            ))}
                            {exposedRequestableOauthToolItems.length > 8 ? (
                              <span className="meta-pill">
                                {i18n._({
                                  id: "+{count} more",
                                  message: "+{count} more",
                                  values: {
                                    count: exposedRequestableOauthToolItems.length - 8,
                                  },
                                })}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="field-hint">
                            {i18n._({
                              id: "No currently exposed Feishu tools still require user OAuth scopes.",
                              message:
                                "No currently exposed Feishu tools still require user OAuth scopes.",
                            })}
                          </span>
                        )}

                        <SettingsRecord
                          marker="2"
                          title={i18n._({
                            id: "OAuth tool boundary",
                            message: "OAuth tool boundary",
                          })}
                          description={
                            isOauthToolSelectionSyncedWithExposure
                              ? i18n._({
                                  id: "This OAuth run is aligned with the current workspace tool exposure boundary.",
                                  message:
                                    "This OAuth run is aligned with the current workspace tool exposure boundary.",
                                })
                              : i18n._({
                                  id: "This OAuth run currently uses a custom tool subset. It can be narrower or broader than the workspace exposure boundary.",
                                  message:
                                    "This OAuth run currently uses a custom tool subset. It can be narrower or broader than the workspace exposure boundary.",
                                })
                          }
                          meta={
                            <>
                              <span className="meta-pill">
                                {isOauthToolSelectionSyncedWithExposure
                                  ? i18n._({
                                      id: "Following exposed tool set",
                                      message: "Following exposed tool set",
                                    })
                                  : i18n._({
                                      id: "Custom OAuth tool set",
                                      message: "Custom OAuth tool set",
                                    })}
                              </span>
                              <span className="meta-pill">
                                {i18n._({
                                  id: "{count} tools selected",
                                  message: "{count} tools selected",
                                  values: { count: selectedOauthToolCount },
                                })}
                              </span>
                              {oauthToolsAddedBeyondExposure.length > 0 ? (
                                <span className="meta-pill meta-pill--warning">
                                  {i18n._({
                                    id: "{count} extra beyond exposure",
                                    message: "{count} extra beyond exposure",
                                    values: { count: oauthToolsAddedBeyondExposure.length },
                                  })}
                                </span>
                              ) : null}
                              {oauthToolsSkippedFromExposure.length > 0 ? (
                                <span className="meta-pill">
                                  {i18n._({
                                    id: "{count} skipped from exposure",
                                    message: "{count} skipped from exposure",
                                    values: { count: oauthToolsSkippedFromExposure.length },
                                  })}
                                </span>
                              ) : null}
                            </>
                          }
                        />
                      <div className="feishu-tool-selector-card__actions">
                        <Button
                          intent="secondary"
                          onClick={syncOauthToolsToExposure}
                          type="button"
                        >
                          {i18n._({
                            id: "Use exposed tool set",
                            message: "Use exposed tool set",
                          })}
                        </Button>
                        <Button intent="secondary" onClick={selectAllOauthTools} type="button">
                          {i18n._({
                            id: "Select all requestable tools",
                            message: "Select all requestable tools",
                          })}
                        </Button>
                        <Button intent="secondary" onClick={clearOauthTools} type="button">
                          {i18n._({
                            id: "Clear selected tools",
                            message: "Clear selected tools",
                          })}
                        </Button>
                        <span className="field-hint">
                          {i18n._({
                            id: "Scopes are derived from the selected tools and filtered to the user permissions that are still missing.",
                            message:
                              "Scopes are derived from the selected tools and filtered to the user permissions that are still missing.",
                          })}
                        </span>
                      </div>
                      {!isOauthToolSelectionSyncedWithExposure ? (
                        <InlineNotice
                          noticeKey="feishu-tools-oauth-selection-drift"
                          title={i18n._({
                            id: "OAuth tool selection currently overrides the exposure panel",
                            message:
                              "OAuth tool selection currently overrides the exposure panel",
                          })}
                          tone="info"
                        >
                          {i18n._({
                            id: "Use the exposed tool set action if you want authorization to return to the same tool boundary currently configured for this workspace.",
                            message:
                              "Use the exposed tool set action if you want authorization to return to the same tool boundary currently configured for this workspace.",
                          })}
                        </InlineNotice>
                      ) : null}
                        {selectedOauthToolItems.length > 0 ? (
                          <div className="feishu-tool-selector-chip-list">
                            {selectedOauthToolItems.slice(0, 8).map((item) => (
                              <span className="meta-pill" key={item.toolName}>
                                {item.title}
                              </span>
                            ))}
                            {selectedOauthToolItems.length > 8 ? (
                              <span className="meta-pill">
                                {i18n._({
                                  id: "+{count} more",
                                  message: "+{count} more",
                                  values: { count: selectedOauthToolItems.length - 8 },
                                })}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="field-hint">
                            {i18n._({
                              id: "Select at least one tool to derive the missing OAuth scopes for this run.",
                              message:
                                "Select at least one tool to derive the missing OAuth scopes for this run.",
                            })}
                          </span>
                        )}

                        <SettingsRecord
                          marker="3"
                          title={i18n._({
                            id: "Derived scope request",
                            message: "Derived scope request",
                          })}
                          description={i18n._({
                            id: "The final OAuth request is built from the selected tools and filtered to the user permissions that are still missing.",
                            message:
                              "The final OAuth request is built from the selected tools and filtered to the user permissions that are still missing.",
                          })}
                          meta={
                            <>
                              <span className="meta-pill">
                                {i18n._({
                                  id: "{count} scopes derived",
                                  message: "{count} scopes derived",
                                  values: { count: selectedToolDerivedOauthScopes.length },
                                })}
                              </span>
                              <span className="meta-pill">
                                {i18n._({
                                  id: "{count} sensitive scopes",
                                  message: "{count} sensitive scopes",
                                  values: {
                                    count: requestableOauthPermissionItems.filter(
                                      (item) =>
                                        selectedToolDerivedOauthScopes.includes(item.scope) &&
                                        item.sensitive,
                                    ).length,
                                  },
                                })}
                              </span>
                            </>
                          }
                        />
                        {selectedToolDerivedOauthScopes.length > 0 ? (
                          <div className="feishu-tool-selector-chip-list">
                            {selectedToolDerivedOauthScopes.map((scope) => (
                              <span className="meta-pill" key={scope}>
                                {scope}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="field-hint">
                            {i18n._({
                              id: "Select at least one tool to derive the missing OAuth scopes for this run.",
                              message:
                                "Select at least one tool to derive the missing OAuth scopes for this run.",
                            })}
                          </span>
                        )}
                      </div>
                      <div className="feishu-oauth-scope-list">
                        {requestableOauthToolItems.map((item) => {
                          const checked = selectedOauthToolNames.includes(item.toolName);
                          return (
                            <label className="feishu-oauth-scope-list__item" key={item.toolName}>
                              <input
                                checked={checked}
                                onChange={() => toggleOauthToolSelection(item.toolName)}
                                type="checkbox"
                              />
                              <div className="feishu-oauth-scope-list__content">
                                <strong>{item.title}</strong>
                                <span>{item.description || item.toolName}</span>
                                <div className="feishu-tool-selector-chip-list">
                                  <span className="meta-pill">{item.categoryTitle}</span>
                                  <span className="meta-pill">
                                    {i18n._({
                                      id: "{count} missing scopes",
                                      message: "{count} missing scopes",
                                      values: { count: item.requestableScopeCount },
                                    })}
                                  </span>
                                  {item.sensitiveScopeCount > 0 ? (
                                    <span className="meta-pill meta-pill--warning">
                                      {i18n._({
                                        id: "{count} sensitive scopes",
                                        message: "{count} sensitive scopes",
                                        values: { count: item.sensitiveScopeCount },
                                      })}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                  {oauthScopeRequestMode === "selected_missing" ? (
                    <>
                      <div className="feishu-tool-selector-card__actions">
                        <Button intent="secondary" onClick={selectAllOauthScopes} type="button">
                          {i18n._({
                            id: "Select all requestable scopes",
                            message: "Select all requestable scopes",
                          })}
                        </Button>
                        <Button intent="secondary" onClick={clearOauthScopes} type="button">
                          {i18n._({
                            id: "Clear selected scopes",
                            message: "Clear selected scopes",
                          })}
                        </Button>
                        <span className="field-hint">
                          {i18n._({
                            id: "Only the checked scopes will be included in the next OAuth authorization URL.",
                            message:
                              "Only the checked scopes will be included in the next OAuth authorization URL.",
                          })}
                        </span>
                      </div>
                      <div className="feishu-oauth-scope-list">
                        {requestableOauthPermissionItems.map((item) => {
                          const checked = selectedOauthScopes.includes(item.scope);
                          return (
                            <label className="feishu-oauth-scope-list__item" key={item.scope}>
                              <input
                                checked={checked}
                                onChange={() => toggleOauthScopeSelection(item.scope)}
                                type="checkbox"
                              />
                              <div className="feishu-oauth-scope-list__content">
                                <strong>{item.scope}</strong>
                                <span>{item.reason ?? item.status}</span>
                                <div className="feishu-tool-selector-chip-list">
                                  <span className="meta-pill">{item.status}</span>
                                  {item.source ? <span className="meta-pill">{item.source}</span> : null}
                                  {item.sensitive ? (
                                    <span className="meta-pill meta-pill--warning">
                                      {i18n._({ id: "Sensitive", message: "Sensitive" })}
                                    </span>
                                  ) : null}
                                  {item.tools && item.tools.length > 0 ? (
                                    <span className="meta-pill">
                                      {i18n._({
                                        id: "{count} tools",
                                        message: "{count} tools",
                                        values: { count: item.tools.length },
                                      })}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                  {oauthScopeRequestMode === "manual" ? (
                    <>
                      <TextArea
                        label={i18n._({
                          id: "Manual OAuth scopes",
                          message: "Manual OAuth scopes",
                        })}
                        onChange={(event) => setManualOauthScopesInput(event.target.value)}
                        placeholder={i18n._({
                          id: "Enter one scope per line or separate scopes with commas.",
                          message: "Enter one scope per line or separate scopes with commas.",
                        })}
                        rows={6}
                        value={manualOauthScopesInput}
                      />
                      <span className="field-hint">
                        {i18n._({
                          id: "Manual mode sends exactly the normalized scopes listed here. Duplicates and blank lines are removed automatically.",
                          message:
                            "Manual mode sends exactly the normalized scopes listed here. Duplicates and blank lines are removed automatically.",
                        })}
                      </span>
                      {manualOauthScopes.length > 0 ? (
                        <div className="feishu-tool-selector-chip-list">
                          {manualOauthScopes.map((scope) => (
                            <span className="meta-pill" key={scope}>
                              {scope}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
              <div className="setting-row__actions">
                <Button
                  disabled={
                    !workspaceId ||
                    (oauthScopeRequestMode === "selected_tools" && selectedToolDerivedOauthScopes.length === 0) ||
                    (oauthScopeRequestMode === "selected_missing" && selectedOauthScopeCount === 0) ||
                    (oauthScopeRequestMode === "manual" && manualOauthScopes.length === 0)
                  }
                  intent="secondary"
                  isLoading={oauthMutation.isPending}
                  onClick={() => oauthMutation.mutate()}
                >
                  {i18n._({ id: "Start Feishu OAuth", message: "Start Feishu OAuth" })}
                </Button>
                <Button
                  disabled={
                    !workspaceId ||
                    !oauthStatusQuery.data ||
                    oauthStatusQuery.data.status === "not_connected" ||
                    oauthStatusQuery.data.status === "disabled"
                  }
                  intent="danger"
                  isLoading={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate()}
                >
                  {i18n._({
                    id: "Revoke Feishu authorization",
                    message: "Revoke Feishu authorization",
                  })}
                </Button>
              </div>
              {oauthMutation.data?.authorizationUrl ? (
                <InlineNotice
                  dismissible
                  noticeKey="feishu-tools-oauth-url"
                  title={i18n._({
                    id: "Authorization URL opened in a new tab",
                    message: "Authorization URL opened in a new tab",
                  })}
                  tone="info"
                >
                  <a
                    href={oauthMutation.data.authorizationUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {oauthMutation.data.authorizationUrl}
                  </a>
                </InlineNotice>
              ) : null}
              {oauthMutation.error ? (
                <InlineNotice
                  dismissible
                  noticeKey={`feishu-tools-oauth-${getErrorMessage(oauthMutation.error)}`}
                  title={i18n._({ id: "OAuth failed", message: "OAuth failed" })}
                  tone="error"
                >
                  {getErrorMessage(oauthMutation.error)}
                </InlineNotice>
              ) : null}
              {revokeMutation.error ? (
                <InlineNotice
                  dismissible
                  noticeKey={`feishu-tools-revoke-${getErrorMessage(revokeMutation.error)}`}
                  title={i18n._({ id: "Revoke failed", message: "Revoke failed" })}
                  tone="error"
                >
                  {getErrorMessage(revokeMutation.error)}
                </InlineNotice>
              ) : null}
              {statusQuery.data ? (
                <SettingsJsonPreview
                  title={i18n._({ id: "Status", message: "Status" })}
                  description={i18n._({
                    id: "Latest readiness snapshot returned by the backend.",
                    message: "Latest readiness snapshot returned by the backend.",
                  })}
                  value={statusQuery.data}
                />
              ) : null}
              {runtimeIntegration ? (
                <SettingsRecord
                  marker={runtimeIntegration.threadEnabled ? "OK" : "MCP"}
                  title={i18n._({
                    id: "Thread and bot integration",
                    message: "Thread and bot integration",
                  })}
                  description={
                    runtimeIntegration.detail ??
                    i18n._({
                      id: "Feishu thread integration is managed through workspace MCP configuration.",
                      message:
                        "Feishu thread integration is managed through workspace MCP configuration.",
                    })
                  }
                  meta={
                    <>
                      <StatusPill status={runtimeIntegration.status} />
                      {runtimeIntegration.serverName ? (
                        <span className="meta-pill">{runtimeIntegration.serverName}</span>
                      ) : null}
                      {runtimeIntegration.threadEnabled ? (
                        <span className="meta-pill">
                          {i18n._({ id: "Thread enabled", message: "Thread enabled" })}
                        </span>
                      ) : null}
                      {runtimeIntegration.botEnabled ? (
                        <span className="meta-pill">
                          {i18n._({ id: "Bot via thread", message: "Bot via thread" })}
                        </span>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {runtimeIntegration &&
              (!runtimeIntegration.allowlistAppliedInThread ||
                !runtimeIntegration.writeGuardAppliedInThread) ? (
                <InlineNotice
                  noticeKey="feishu-tools-runtime-guardrails"
                  title={i18n._({
                    id: "Runtime guardrail scope",
                    message: "Runtime guardrail scope",
                  })}
                  tone="info"
                >
                  {i18n._({
                    id: "Current thread integration syncs the managed MCP server into runtime, but the backend-only tool allowlist and sensitive write guard still apply to the direct Feishu invoke API rather than arbitrary endpoint-provided MCP tools.",
                    message:
                      "Current thread integration syncs the managed MCP server into runtime, but the backend-only tool allowlist and sensitive write guard still apply to the direct Feishu invoke API rather than arbitrary endpoint-provided MCP tools.",
                  })}
                </InlineNotice>
              ) : null}
            </div>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={i18n._({ id: "Capabilities", message: "Capabilities" })}
          description={i18n._({
            id: "Review the current modeling summary, then use the configuration panel above for full browsing and selection.",
            message:
              "Review the current modeling summary, then use the configuration panel above for full browsing and selection.",
          })}
        >
          <SettingRow
            title={i18n._({ id: "Model summary", message: "Model summary" })}
            description={i18n._({
              id: "Tool details now live in the configuration popup so the page keeps a single source of truth.",
              message:
                "Tool details now live in the configuration popup so the page keeps a single source of truth.",
            })}
          >
            <div className="form-stack">
              <SettingsRecord
                marker="TL"
                title={i18n._({ id: "Feishu tool model", message: "Feishu tool model" })}
                description={i18n._({
                  id: "Use Configure tool panel in the Configuration section to browse, filter, paginate, and select tools.",
                  message:
                    "Use Configure tool panel in the Configuration section to browse, filter, paginate, and select tools.",
                })}
                meta={
                  <>
                    <span className="meta-pill">
                      {i18n._({
                        id: "{count} modeled tools",
                        message: "{count} modeled tools",
                        values: {
                          count: capabilitiesQuery.data?.summary?.totalCount ?? totalToolCount,
                        },
                      })}
                    </span>
                    <span className="meta-pill">
                      {i18n._({
                        id: "{count} categories",
                        message: "{count} categories",
                        values: { count: categories.length },
                      })}
                    </span>
                    {capabilitiesQuery.data?.summary?.stage ? (
                      <span className="meta-pill">
                        {capabilitiesQuery.data.summary.stage}
                      </span>
                    ) : null}
                  </>
                }
              />
              {categories.length > 0 ? (
                <div className="feishu-tool-selector-chip-list">
                  {categories.map((category) => (
                    <span className="meta-pill" key={category.id}>
                      {category.title}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </SettingRow>
          {capabilitiesQuery.error ? (
            <InlineNotice
              dismissible
              noticeKey={`feishu-tools-capabilities-${getErrorMessage(capabilitiesQuery.error)}`}
              title={i18n._({
                id: "Capabilities unavailable",
                message: "Capabilities unavailable",
              })}
              tone="error"
            >
              {getErrorMessage(capabilitiesQuery.error)}
            </InlineNotice>
          ) : null}
        </SettingsGroup>

        <SettingsGroup
          title={i18n._({ id: "Permissions", message: "Permissions" })}
          description={i18n._({
            id: "Review required scopes, missing scopes, and sensitive permissions before rollout.",
            message:
              "Review required scopes, missing scopes, and sensitive permissions before rollout.",
          })}
        >
          <SettingRow
            title={i18n._({ id: "Scope checklist", message: "Scope checklist" })}
            description={i18n._({
              id: "The backend groups app scopes, user scopes, and sensitive scopes into a stable result.",
              message:
                "The backend groups app scopes, user scopes, and sensitive scopes into a stable result.",
            })}
          >
            <div className="form-stack">
              {permissionsQuery.data ? (
                <SettingsRecord
                  marker="SC"
                  title={i18n._({ id: "Permission summary", message: "Permission summary" })}
                  description={i18n._({
                    id: "Use this summary to separate already granted scopes from OAuth gaps and sensitive writes.",
                    message:
                      "Use this summary to separate already granted scopes from OAuth gaps and sensitive writes.",
                  })}
                  meta={
                    <>
                      {permissionsQuery.data.overallStatus ? (
                        <StatusPill status={permissionsQuery.data.overallStatus} />
                      ) : null}
                      <span className="meta-pill">
                        {i18n._({
                          id: "{count} granted",
                          message: "{count} granted",
                          values: { count: grantedPermissionItems.length },
                        })}
                      </span>
                      <span
                        className={
                          missingPermissionItems.length > 0
                            ? "meta-pill meta-pill--warning"
                            : "meta-pill"
                        }
                      >
                        {i18n._({
                          id: "{count} missing",
                          message: "{count} missing",
                          values: { count: missingPermissionItems.length },
                        })}
                      </span>
                      <span
                        className={
                          sensitivePermissionItems.length > 0
                            ? "meta-pill meta-pill--warning"
                            : "meta-pill"
                        }
                      >
                        {i18n._({
                          id: "{count} sensitive",
                          message: "{count} sensitive",
                          values: { count: sensitivePermissionItems.length },
                        })}
                      </span>
                    </>
                  }
                />
              ) : null}
              {permissionsQuery.data?.suggestions && permissionsQuery.data.suggestions.length > 0 ? (
                <SettingsRecord
                  marker="TIP"
                  title={i18n._({ id: "Suggested next steps", message: "Suggested next steps" })}
                  description={permissionsQuery.data.suggestions.join(" ")}
                />
              ) : null}
              <div className="feishu-permissions-table__toolbar">
                <Input
                  label={i18n._({ id: "Search permissions", message: "Search permissions" })}
                  onChange={(event) => setPermissionQuery(event.target.value)}
                  placeholder={i18n._({
                    id: "Search by scope, status, source, reason, or tool name.",
                    message: "Search by scope, status, source, reason, or tool name.",
                  })}
                  value={permissionQuery}
                />
                <div className="field field--full">
                  <span className="field-label">
                    {i18n._({ id: "Rows per page", message: "Rows per page" })}
                  </span>
                  <SelectControl
                    ariaLabel={i18n._({ id: "Rows per page", message: "Rows per page" })}
                    className="feishu-form-select"
                    fullWidth
                    onChange={(value) => setPermissionPageSize(value)}
                    options={toolSelectorPageSizeOptions}
                    value={permissionPageSize}
                  />
                </div>
              </div>
              {filteredPermissionItems.length > 0 ? (
                <>
                  <div className="feishu-permissions-table__viewport">
                    <table className="feishu-permissions-table">
                      <colgroup>
                        <col className="feishu-permissions-table__col feishu-permissions-table__col--status" />
                        <col className="feishu-permissions-table__col feishu-permissions-table__col--scope" />
                        <col className="feishu-permissions-table__col feishu-permissions-table__col--source" />
                        <col className="feishu-permissions-table__col feishu-permissions-table__col--reason" />
                        <col className="feishu-permissions-table__col feishu-permissions-table__col--tools" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="feishu-permissions-table__header" scope="col">
                            {i18n._({ id: "Status", message: "Status" })}
                          </th>
                          <th className="feishu-permissions-table__header" scope="col">
                            {i18n._({ id: "Scope", message: "Scope" })}
                          </th>
                          <th className="feishu-permissions-table__header" scope="col">
                            {i18n._({ id: "Source", message: "Source" })}
                          </th>
                          <th className="feishu-permissions-table__header" scope="col">
                            {i18n._({ id: "Reason", message: "Reason" })}
                          </th>
                          <th className="feishu-permissions-table__header" scope="col">
                            {i18n._({ id: "Related tools", message: "Related tools" })}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedPermissionItems.map((item) => (
                          <tr
                            className={[
                              "feishu-permissions-table__row",
                              item.sensitive ? "feishu-permissions-table__row--sensitive" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            key={item.scope}
                          >
                            <td className="feishu-permissions-table__cell">
                              <div className="feishu-permissions-table__status">
                                <StatusPill status={item.status} />
                                {item.sensitive ? (
                                  <span className="meta-pill meta-pill--warning">
                                    {i18n._({ id: "Sensitive", message: "Sensitive" })}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="feishu-permissions-table__cell">
                              <div className="feishu-permissions-table__scope">{item.scope}</div>
                            </td>
                            <td className="feishu-permissions-table__cell">
                              <div className="feishu-permissions-table__source">
                                {item.source || "—"}
                              </div>
                            </td>
                            <td className="feishu-permissions-table__cell">
                              <div className="feishu-permissions-table__reason">
                                {item.reason || item.status}
                              </div>
                            </td>
                            <td className="feishu-permissions-table__cell">
                              <div className="feishu-permissions-table__tools">
                                {item.tools && item.tools.length > 0 ? (
                                  <>
                                    <span className="meta-pill">
                                      {i18n._({
                                        id: "{count} tools",
                                        message: "{count} tools",
                                        values: { count: item.tools.length },
                                      })}
                                    </span>
                                    <span className="feishu-permissions-table__tools-preview">
                                      {item.tools.join(", ")}
                                    </span>
                                  </>
                                ) : (
                                  <span className="field-hint">—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="feishu-tool-selector-pagination">
                    <span className="field-hint">
                      {i18n._({
                        id: "Showing {start}-{end} of {total} filtered permissions.",
                        message: "Showing {start}-{end} of {total} filtered permissions.",
                        values: {
                          start: pagedPermissionStart,
                          end: pagedPermissionEnd,
                          total: filteredPermissionItems.length,
                        },
                      })}
                    </span>
                    <div className="feishu-tool-selector-pagination__actions">
                      <span className="meta-pill">
                        {i18n._({
                          id: "Page {page} of {total} permissions",
                          message: "Page {page} of {total} permissions",
                          values: { page: permissionPage, total: permissionTotalPages },
                        })}
                      </span>
                      <Button
                        disabled={permissionPage <= 1}
                        intent="secondary"
                        onClick={() => setPermissionPage((current) => Math.max(1, current - 1))}
                        size="sm"
                        type="button"
                      >
                        {i18n._({ id: "Previous page", message: "Previous page" })}
                      </Button>
                      <Button
                        disabled={permissionPage >= permissionTotalPages}
                        intent="secondary"
                        onClick={() =>
                          setPermissionPage((current) => Math.min(permissionTotalPages, current + 1))
                        }
                        size="sm"
                        type="button"
                      >
                        {i18n._({ id: "Next page", message: "Next page" })}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="feishu-tool-selector-empty">
                  <strong>
                    {i18n._({
                      id: "No permissions match the current search.",
                      message: "No permissions match the current search.",
                    })}
                  </strong>
                  <span>
                    {i18n._({
                      id: "Adjust the permission search query to bring matching scopes back into view.",
                      message:
                        "Adjust the permission search query to bring matching scopes back into view.",
                    })}
                  </span>
                </div>
              )}
              {permissionsQuery.data?.grantedScopes && permissionsQuery.data.grantedScopes.length > 0 ? (
                <SettingsJsonPreview
                  title={i18n._({ id: "Granted scope set", message: "Granted scope set" })}
                  description={i18n._({
                    id: "Normalized granted scopes currently attached to the workspace Feishu OAuth token.",
                    message:
                      "Normalized granted scopes currently attached to the workspace Feishu OAuth token.",
                  })}
                  value={permissionsQuery.data.grantedScopes}
                />
              ) : null}
              {permissionsQuery.data?.missingScopes && permissionsQuery.data.missingScopes.length > 0 ? (
                <SettingsJsonPreview
                  title={i18n._({ id: "Missing scope set", message: "Missing scope set" })}
                  description={i18n._({
                    id: "Scopes still missing from the current Feishu OAuth authorization.",
                    message:
                      "Scopes still missing from the current Feishu OAuth authorization.",
                  })}
                  value={permissionsQuery.data.missingScopes}
                />
              ) : null}
              {permissionsQuery.data ? (
                <SettingsJsonPreview
                  title={i18n._({ id: "Permission result", message: "Permission result" })}
                  description={i18n._({
                    id: "Full permission payload returned by the backend.",
                    message: "Full permission payload returned by the backend.",
                  })}
                  value={permissionsQuery.data}
                />
              ) : null}
            </div>
          </SettingRow>
          {permissionsQuery.error ? (
            <InlineNotice
              dismissible
              noticeKey={`feishu-tools-permissions-${getErrorMessage(permissionsQuery.error)}`}
              title={i18n._({
                id: "Permissions unavailable",
                message: "Permissions unavailable",
              })}
              tone="error"
            >
              {getErrorMessage(permissionsQuery.error)}
            </InlineNotice>
          ) : null}
        </SettingsGroup>

        <SettingsGroup
          title={i18n._({ id: "Invoke tool (debug)", message: "Invoke tool (debug)" })}
          description={i18n._({
            id: "Exercise a Feishu tool end to end against the configured app. Intended for workspace admins.",
            message:
              "Exercise a Feishu tool end to end against the configured app. Intended for workspace admins.",
          })}
        >
          <SettingRow
            title={i18n._({ id: "Invoke", message: "Invoke" })}
            description={i18n._({
              id: "Provide a tool name, an optional action, and JSON params. Results show the response envelope returned by the backend.",
              message:
                "Provide a tool name, an optional action, and JSON params. Results show the response envelope returned by the backend.",
            })}
          >
            <form
              className="form-stack"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                if (workspaceId) {
                  invokeMutation.mutate();
                }
              }}
            >
              <Input
                label={i18n._({ id: "Tool name", message: "Tool name" })}
                onChange={(event) => setInvokeToolName(event.target.value)}
                placeholder="feishu_fetch_doc"
                value={invokeToolName}
              />
              <Input
                label={i18n._({ id: "Action (optional)", message: "Action (optional)" })}
                onChange={(event) => setInvokeAction(event.target.value)}
                placeholder="append_text"
                value={invokeAction}
              />
              <TextArea
                label={i18n._({ id: "Params (JSON)", message: "Params (JSON)" })}
                onChange={(event) => setInvokeParamsInput(event.target.value)}
                placeholder='{"documentId": "doc_xxx"}'
                rows={6}
                value={invokeParamsInput}
              />
              {invokeParamsError ? (
                <InlineNotice
                  dismissible
                  noticeKey={`feishu-tools-invoke-params-${invokeParamsError}`}
                  title={i18n._({ id: "Invalid params JSON", message: "Invalid params JSON" })}
                  tone="error"
                >
                  {invokeParamsError}
                </InlineNotice>
              ) : null}
              <div className="setting-row__actions">
                <Button disabled={!workspaceId} isLoading={invokeMutation.isPending} type="submit">
                  {i18n._({ id: "Invoke tool", message: "Invoke tool" })}
                </Button>
              </div>
            </form>
            {activeInvokeId ? (
              <div className="field-hint">
                {i18n._({
                  id: "Invocation {invocationId} · state {state} · {count} progress events",
                  message:
                    "Invocation {invocationId} · state {state} · {count} progress events",
                  values: {
                    invocationId: activeInvokeId,
                    state:
                      latestInvokeTimelineEvent?.state ??
                      (invokeMutation.isPending
                        ? i18n._({ id: "pending", message: "pending" })
                        : i18n._({ id: "idle", message: "idle" })),
                    count: invokeTimeline.length,
                  },
                })}
              </div>
            ) : null}
            {activeInvokeId ? (
              <SettingsJsonPreview
                title={i18n._({ id: "Invoke progress", message: "Invoke progress" })}
                description={i18n._({
                  id: "Live invocation stages from the workspace event stream. The final invoke response includes the same timeline for callers that do not subscribe.",
                  message:
                    "Live invocation stages from the workspace event stream. The final invoke response includes the same timeline for callers that do not subscribe.",
                })}
                value={{
                  invocationId: activeInvokeId,
                  latest: latestInvokeTimelineEvent,
                  events: invokeTimeline,
                }}
              />
            ) : null}
            {invokeMutation.data ? (
              <SettingsJsonPreview
                title={i18n._({ id: "Invoke result", message: "Invoke result" })}
                description={i18n._({
                  id: "Full tool invocation envelope including principal, duration, and any structured error.",
                  message:
                    "Full tool invocation envelope including principal, duration, and any structured error.",
                })}
                value={invokeMutation.data}
              />
            ) : null}
            {invokeMutation.error && !invokeParamsError ? (
              <InlineNotice
                dismissible
                noticeKey={`feishu-tools-invoke-${getErrorMessage(invokeMutation.error)}`}
                title={i18n._({ id: "Invoke failed", message: "Invoke failed" })}
                tone="error"
              >
                {getErrorMessage(invokeMutation.error)}
              </InlineNotice>
            ) : null}
          </SettingRow>
        </SettingsGroup>
      </div>
      {toolSelectorOpen ? (
        <Modal
          description={i18n._({
            id: "Choose whether the workspace exposes all modeled tools or only a selected subset. The form supports search, category filtering, and visible-range bulk actions.",
            message:
              "Choose whether the workspace exposes all modeled tools or only a selected subset. The form supports search, category filtering, and visible-range bulk actions.",
          })}
          footer={
            <>
              <Button intent="secondary" onClick={closeToolSelector} type="button">
                {i18n._({ id: "Cancel", message: "Cancel" })}
              </Button>
              <Button onClick={applyToolSelector} type="button">
                {i18n._({ id: "Apply tool selection", message: "Apply tool selection" })}
              </Button>
            </>
          }
          maxWidth="min(920px, 100%)"
          onClose={closeToolSelector}
          title={i18n._({ id: "Configure Feishu tool panel", message: "Configure Feishu tool panel" })}
        >
          <div className="feishu-tool-selector-modal">
            <div className="feishu-tool-selector-summary">
              <span className="meta-pill">
                {toolSelectorDraftMode === "all"
                  ? i18n._({ id: "Expose all", message: "Expose all" })
                  : i18n._({ id: "Selected only", message: "Selected only" })}
              </span>
              <span className="meta-pill">
                {i18n._({
                  id: "{count} selected in draft",
                  message: "{count} selected in draft",
                  values: {
                    count:
                      toolSelectorDraftMode === "all"
                        ? totalToolCount
                        : toolSelectorDraftSelection.length,
                  },
                })}
              </span>
              <span className="meta-pill">
                {i18n._({
                  id: "{count} visible",
                  message: "{count} visible",
                  values: { count: visibleToolNames.length },
                })}
              </span>
            </div>

            <fieldset className="feishu-tool-selector-mode" aria-label={i18n._({ id: "Tool exposure mode", message: "Tool exposure mode" })}>
              <legend>{i18n._({ id: "Tool exposure mode", message: "Tool exposure mode" })}</legend>
              <label className="feishu-tool-selector-mode__option">
                <input
                  checked={toolSelectorDraftMode === "all"}
                  name="feishu-tool-selector-mode"
                  onChange={() => setToolSelectorDraftMode("all")}
                  type="radio"
                />
                <div>
                  <strong>{i18n._({ id: "Expose all modeled tools", message: "Expose all modeled tools" })}</strong>
                  <span>
                    {i18n._({
                      id: "Use a single selection mode that leaves the backend allowlist empty.",
                      message:
                        "Use a single selection mode that leaves the backend allowlist empty.",
                    })}
                  </span>
                </div>
              </label>
              <label className="feishu-tool-selector-mode__option">
                <input
                  checked={toolSelectorDraftMode === "custom"}
                  name="feishu-tool-selector-mode"
                  onChange={() => setToolSelectorDraftMode("custom")}
                  type="radio"
                />
                <div>
                  <strong>{i18n._({ id: "Restrict to selected tools", message: "Restrict to selected tools" })}</strong>
                  <span>
                    {i18n._({
                      id: "Switch to multi-select mode and choose the exact tools that stay exposed.",
                      message:
                        "Switch to multi-select mode and choose the exact tools that stay exposed.",
                    })}
                  </span>
                </div>
              </label>
            </fieldset>

              <div className="feishu-tool-selector-toolbar">
                <Input
                  label={i18n._({ id: "Filter tools", message: "Filter tools" })}
                  onChange={(event) => setToolSelectorQuery(event.target.value)}
                  placeholder={i18n._({
                    id: "Search by tool name, title, description, or risk.",
                    message: "Search by tool name, title, description, or risk.",
                  })}
                  value={toolSelectorQuery}
                />
                <div className="field field--full">
                  <span className="field-label">
                    {i18n._({ id: "Category filter", message: "Category filter" })}
                  </span>
                  <SelectControl
                    ariaLabel={i18n._({ id: "Category filter", message: "Category filter" })}
                    className="feishu-form-select"
                    fullWidth
                    onChange={(value) => setToolSelectorCategory(value)}
                    options={toolSelectorCategoryOptions}
                    value={toolSelectorCategory}
                  />
                </div>
                <div className="field field--full">
                  <span className="field-label">
                    {i18n._({ id: "Rows per page", message: "Rows per page" })}
                  </span>
                  <SelectControl
                    ariaLabel={i18n._({ id: "Rows per page", message: "Rows per page" })}
                    className="feishu-form-select"
                    fullWidth
                    onChange={(value) => setToolSelectorPageSize(value)}
                    options={toolSelectorPageSizeOptions}
                    value={toolSelectorPageSize}
                  />
                </div>
              </div>

            <div className="feishu-tool-selector-bulk-actions">
              <Button
                disabled={toolSelectorDraftMode !== "custom" || visibleToolNames.length === 0}
                intent="secondary"
                onClick={handleSelectAllVisible}
                size="sm"
                type="button"
              >
                {i18n._({ id: "Select all visible", message: "Select all visible" })}
              </Button>
              <Button
                disabled={toolSelectorDraftMode !== "custom" || visibleToolNames.length === 0}
                intent="secondary"
                onClick={handleClearVisible}
                size="sm"
                type="button"
              >
                {i18n._({ id: "Clear visible", message: "Clear visible" })}
              </Button>
              <Button
                disabled={toolSelectorDraftMode !== "custom" || toolCatalog.length === 0}
                intent="ghost"
                onClick={() => setToolSelectorDraftSelection(normalizeToolNames(toolCatalog.map((item) => item.toolName)))}
                size="sm"
                type="button"
              >
                {i18n._({ id: "Select every tool", message: "Select every tool" })}
              </Button>
            </div>

            {toolSelectorDraftMode === "all" ? (
              <InlineNotice
                noticeKey="feishu-tool-selector-all-mode"
                title={i18n._({ id: "Expose-all mode active", message: "Expose-all mode active" })}
                tone="info"
              >
                {i18n._({
                  id: "The selector keeps your draft picks, but the backend will receive an empty allowlist until you switch back to selected-only mode.",
                  message:
                    "The selector keeps your draft picks, but the backend will receive an empty allowlist until you switch back to selected-only mode.",
                })}
              </InlineNotice>
            ) : null}

            <div className="feishu-tool-selector-results">
              {visibleToolRows.length > 0 ? (
                <div className="feishu-tool-selector-table__viewport">
                  <table className="feishu-tool-selector-table">
                    <colgroup>
                      <col className="feishu-tool-selector-table__col feishu-tool-selector-table__col--toggle" />
                      <col className="feishu-tool-selector-table__col feishu-tool-selector-table__col--tool" />
                      <col className="feishu-tool-selector-table__col feishu-tool-selector-table__col--category" />
                      <col className="feishu-tool-selector-table__col feishu-tool-selector-table__col--controls" />
                      <col className="feishu-tool-selector-table__col feishu-tool-selector-table__col--scopes" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th
                          className="feishu-tool-selector-table__header feishu-tool-selector-table__header--toggle"
                          scope="col"
                        >
                          {i18n._({ id: "Enabled", message: "Enabled" })}
                        </th>
                        <th className="feishu-tool-selector-table__header" scope="col">
                          {i18n._({ id: "Tool", message: "Tool" })}
                        </th>
                        <th className="feishu-tool-selector-table__header" scope="col">
                          {i18n._({ id: "Category", message: "Category" })}
                        </th>
                        <th className="feishu-tool-selector-table__header" scope="col">
                          {i18n._({ id: "Controls", message: "Controls" })}
                        </th>
                        <th className="feishu-tool-selector-table__header" scope="col">
                          {i18n._({ id: "Scope footprint", message: "Scope footprint" })}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedVisibleToolRows.map((item) => {
                        const checked =
                          toolSelectorDraftMode === "all" ||
                          toolSelectorDraftSelection.includes(item.toolName);
                        return (
                          <tr
                            className={[
                              "feishu-tool-selector-table__row",
                              checked ? "feishu-tool-selector-table__row--selected" : "",
                              toolSelectorDraftMode === "all" ? "feishu-tool-selector-table__row--muted" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            key={item.toolName}
                          >
                            <td className="feishu-tool-selector-table__cell feishu-tool-selector-table__cell--toggle">
                              <Switch
                                aria-label={`${item.title ?? item.toolName}`}
                                checked={checked}
                                disabled={toolSelectorDraftMode === "all"}
                                onChange={() => toggleToolSelection(item.toolName)}
                              />
                            </td>
                            <td className="feishu-tool-selector-table__cell">
                              <div className="feishu-tool-selector-table__primary">
                                <strong>{item.title ?? item.toolName}</strong>
                                <p>{item.description ?? item.toolName}</p>
                                <code>{item.toolName}</code>
                              </div>
                            </td>
                            <td className="feishu-tool-selector-table__cell">
                              <div className="feishu-tool-selector-table__secondary">
                                <strong>{item.categoryTitle}</strong>
                                {item.categoryDescription ? <span>{item.categoryDescription}</span> : null}
                              </div>
                            </td>
                            <td className="feishu-tool-selector-table__cell">
                              <div className="feishu-tool-selector-table__meta">
                                <span className="meta-pill">{item.stage ?? "phase_1"}</span>
                                <span className="meta-pill">{item.riskLevel ?? "read"}</span>
                              </div>
                            </td>
                            <td className="feishu-tool-selector-table__cell">
                              <div className="feishu-tool-selector-table__scopes">
                                {item.requiredScopes && item.requiredScopes.length > 0 ? (
                                  <>
                                    <span className="meta-pill">
                                      {i18n._({
                                        id: "{count} scopes",
                                        message: "{count} scopes",
                                        values: { count: item.requiredScopes.length },
                                      })}
                                    </span>
                                    <span className="feishu-tool-selector-table__scope-preview">
                                      {item.requiredScopes.slice(0, 2).join(", ")}
                                      {item.requiredScopes.length > 2
                                        ? i18n._({
                                            id: " and {count} more",
                                            message: " and {count} more",
                                            values: { count: item.requiredScopes.length - 2 },
                                          })
                                        : ""}
                                    </span>
                                  </>
                                ) : (
                                  <span className="field-hint">
                                    {i18n._({ id: "No extra scopes", message: "No extra scopes" })}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="feishu-tool-selector-empty">
                  <strong>{i18n._({ id: "No tools match the current filters.", message: "No tools match the current filters." })}</strong>
                  <span>
                    {i18n._({
                      id: "Adjust the search text or category filter to bring tools back into view.",
                      message:
                        "Adjust the search text or category filter to bring tools back into view.",
                    })}
                  </span>
                </div>
              )}
            </div>
            {visibleToolRows.length > 0 ? (
              <div className="feishu-tool-selector-pagination">
                <span className="field-hint">
                  {i18n._({
                    id: "Showing {start}-{end} of {total} filtered tools.",
                    message: "Showing {start}-{end} of {total} filtered tools.",
                    values: {
                      start: pagedVisibleStart,
                      end: pagedVisibleEnd,
                      total: visibleToolRows.length,
                    },
                  })}
                </span>
                <div className="feishu-tool-selector-pagination__actions">
                  <span className="meta-pill">
                    {i18n._({
                      id: "Page {page} of {total}",
                      message: "Page {page} of {total}",
                      values: { page: toolSelectorPage, total: toolSelectorTotalPages },
                    })}
                  </span>
                  <Button
                    disabled={toolSelectorPage <= 1}
                    intent="secondary"
                    onClick={() => setToolSelectorPage((current) => Math.max(1, current - 1))}
                    size="sm"
                    type="button"
                  >
                    {i18n._({ id: "Previous page", message: "Previous page" })}
                  </Button>
                  <Button
                    disabled={toolSelectorPage >= toolSelectorTotalPages}
                    intent="secondary"
                    onClick={() =>
                      setToolSelectorPage((current) => Math.min(toolSelectorTotalPages, current + 1))
                    }
                    size="sm"
                    type="button"
                  >
                    {i18n._({ id: "Next page", message: "Next page" })}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

type ToolCatalogEntry = {
  categoryId: string;
  categoryTitle: string;
  description?: string | null;
  items?: {
    enabled?: boolean;
    toolName: string;
    title?: string | null;
    description?: string | null;
    stage?: string | null;
    riskLevel?: string | null;
    requiredScopes?: string[] | null;
  }[];
};

function flattenToolCatalog(categories: FeishuToolsCapabilityCategory[]) {
  return categories.flatMap((category) =>
    (category.items ?? []).map((item) => ({
      ...item,
      categoryId: category.id,
      categoryTitle: category.title,
      categoryDescription: category.description,
    })),
  );
}

function filterToolSections(
  categories: FeishuToolsCapabilitiesResult["categories"],
  query: string,
  categoryFilter: string,
): ToolCatalogEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  return categories
    .filter((category) => categoryFilter === "all" || category.id === categoryFilter)
    .map((category) => ({
      categoryId: category.id,
      categoryTitle: category.title,
      description: category.description,
      items: (category.items ?? []).filter((item) => {
        if (!normalizedQuery) {
          return true;
        }
        const haystack = [
          category.title,
          category.description,
          item.toolName,
          item.title,
          item.description,
          item.stage,
          item.riskLevel,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      }),
    }))
    .filter((category) => (category.items?.length ?? 0) > 0);
}

function normalizeToolNames(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeScopeNames(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
}

function createFeishuInvocationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `feishu_invoke_${crypto.randomUUID()}`
  }
  return `feishu_invoke_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

function parseFeishuInvokeProgressPayload(
  payload: unknown,
): FeishuToolsInvokeProgressPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }
  const record = payload as Record<string, unknown>
  if (
    typeof record.invocationId !== "string" ||
    typeof record.sequence !== "number" ||
    typeof record.state !== "string" ||
    typeof record.ts !== "string"
  ) {
    return null
  }

  const detail =
    record.detail && typeof record.detail === "object" && !Array.isArray(record.detail)
      ? (record.detail as Record<string, unknown>)
      : null

  return {
    invocationId: record.invocationId,
    toolName: typeof record.toolName === "string" ? record.toolName : null,
    action: typeof record.action === "string" ? record.action : null,
    final: typeof record.final === "boolean" ? record.final : false,
    startedAt: typeof record.startedAt === "string" ? record.startedAt : null,
    sequence: record.sequence,
    state: record.state,
    message: typeof record.message === "string" ? record.message : null,
    ts: record.ts,
    detail,
  }
}

function mergeInvokeProgressEvents(
  current: FeishuToolsInvokeProgressEvent[],
  incoming: FeishuToolsInvokeProgressEvent,
) {
  const next = new Map(current.map((event) => [event.sequence, event] as const))
  next.set(incoming.sequence, incoming)
  return [...next.values()].sort((left, right) => left.sequence - right.sequence)
}

function areNormalizedStringListsEqual(left: string[], right: string[]) {
  const normalizedLeft = normalizeToolNames(left);
  const normalizedRight = normalizeToolNames(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function buildRequestableOauthPermissionItems(
  items: FeishuToolsPermissionItem[],
  scopes: string[],
) {
  const itemByScope = new Map(items.map((item) => [item.scope, item] as const));
  return normalizeScopeNames(scopes).map(
    (scope) =>
      itemByScope.get(scope) ?? {
        scope,
        status: "missing",
        source: "user_scope",
        reason: "",
        sensitive: false,
        tools: [],
      },
  );
}

function buildRequestableOauthToolItems(
  toolCatalog: ReturnType<typeof flattenToolCatalog>,
  permissionItems: FeishuToolsPermissionItem[],
) {
  const metaByTool = new Map(
    toolCatalog.map((item) => [
      item.toolName,
      {
        toolName: item.toolName,
        title: item.title?.trim() || item.toolName,
        description: item.description?.trim() || item.toolName,
        categoryTitle: item.categoryTitle,
        enabled: item.enabled !== false,
      },
    ]),
  );
  const counters = new Map<
    string,
    {
      requestableScopeCount: number;
      sensitiveScopeCount: number;
    }
  >();

  for (const item of permissionItems) {
    for (const toolName of item.tools ?? []) {
      const meta = metaByTool.get(toolName);
      if (!meta || !meta.enabled) {
        continue;
      }
      const current = counters.get(toolName) ?? {
        requestableScopeCount: 0,
        sensitiveScopeCount: 0,
      };
      current.requestableScopeCount += 1;
      if (item.sensitive) {
        current.sensitiveScopeCount += 1;
      }
      counters.set(toolName, current);
    }
  }

  return Array.from(counters.entries())
    .map(([toolName, counts]) => ({
      ...metaByTool.get(toolName)!,
      ...counts,
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function buildDefaultSelectedOauthToolNames(
  requestableToolItems: ReturnType<typeof buildRequestableOauthToolItems>,
  toolSelectionMode: "all" | "custom",
  selectedToolNames: string[],
) {
  const requestableToolNames = normalizeToolNames(
    requestableToolItems.map((item) => item.toolName),
  );
  if (toolSelectionMode === "all") {
    return requestableToolNames;
  }
  const selected = new Set(normalizeToolNames(selectedToolNames));
  return requestableToolNames.filter((toolName) => selected.has(toolName));
}

function buildRequestedScopesFromTools(
  permissionItems: FeishuToolsPermissionItem[],
  selectedToolNames: string[],
) {
  const selected = new Set(normalizeToolNames(selectedToolNames));
  const scopes = permissionItems
    .filter((item) => (item.tools ?? []).some((toolName) => selected.has(toolName)))
    .map((item) => item.scope);
  return normalizeScopeNames(scopes);
}

function buildRequestedOauthScopes(
  mode: "all_missing" | "selected_tools" | "selected_missing" | "manual",
  requestableScopes: string[],
  requestablePermissionItems: FeishuToolsPermissionItem[],
  selectedScopes: string[],
  selectedToolNames: string[],
  manualScopesInput: string,
) {
  if (mode === "selected_tools") {
    return buildRequestedScopesFromTools(requestablePermissionItems, selectedToolNames);
  }
  if (mode === "selected_missing") {
    const allowed = new Set(normalizeScopeNames(requestableScopes));
    return normalizeScopeNames(selectedScopes).filter((scope) => allowed.has(scope));
  }
  if (mode === "manual") {
    return normalizeScopeNames(parseScopeInput(manualScopesInput));
  }
  return normalizeScopeNames(requestableScopes);
}

function parseScopeInput(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveToolLabel(
  toolCatalog: ReturnType<typeof flattenToolCatalog>,
  toolName: string,
) {
  return (
    toolCatalog.find((item) => item.toolName === toolName)?.title?.trim() ||
    toolName
  );
}

function authStatusMarker(status: string) {
  switch (status) {
    case "connected":
      return "OK";
    case "connected_no_refresh":
      return "NR";
    case "refresh_required":
      return "RF";
    case "expired":
      return "EX";
    case "disabled":
      return "--";
    default:
      return "..";
  }
}

function authStatusDescription(status: string) {
  switch (status) {
    case "connected":
      return i18n._({
        id: "The workspace has a valid Feishu user token.",
        message: "The workspace has a valid Feishu user token.",
      });
    case "connected_no_refresh":
      return i18n._({
        id: "The workspace has a Feishu access token, but no refresh token was saved. Re-run OAuth before the access token expires.",
        message:
          "The workspace has a Feishu access token, but no refresh token was saved. Re-run OAuth before the access token expires.",
      });
    case "refresh_required":
      return i18n._({
        id: "The access token expired; the next tool call will attempt a refresh.",
        message:
          "The access token expired; the next tool call will attempt a refresh.",
      });
    case "expired":
      return i18n._({
        id: "Both tokens expired; a new OAuth login is required.",
        message: "Both tokens expired; a new OAuth login is required.",
      });
    case "app_only":
      return i18n._({
        id: "App-only mode is active; user-scoped tools are unavailable.",
        message: "App-only mode is active; user-scoped tools are unavailable.",
      });
    case "disabled":
      return i18n._({
        id: "Feishu tools are disabled for this workspace.",
        message: "Feishu tools are disabled for this workspace.",
      });
    default:
      return i18n._({
        id: "No Feishu user token is persisted for this workspace yet.",
        message: "No Feishu user token is persisted for this workspace yet.",
      });
  }
}

function buildPersistedTokenSnapshot(authState?: FeishuToolsAuthState | null) {
  if (!authState) {
    return null;
  }
  const hasTokenMaterial =
    Boolean(authState.hasAccessToken) ||
    Boolean(authState.hasRefreshToken) ||
    Boolean(authState.accessTokenPreview) ||
    Boolean(authState.refreshTokenPreview);
  if (!hasTokenMaterial) {
    return null;
  }

  return [
    {
      key: "status",
      label: i18n._({ id: "Status", message: "Status" }),
      value: authState.status,
      code: false,
    },
    {
      key: "hasAccessToken",
      label: i18n._({ id: "Access token saved", message: "Access token saved" }),
      value: Boolean(authState.hasAccessToken)
        ? i18n._({ id: "Yes", message: "Yes" })
        : i18n._({ id: "No", message: "No" }),
      code: false,
    },
    {
      key: "accessTokenPreview",
      label: i18n._({
        id: "Access token preview",
        message: "Access token preview",
      }),
      value: authState.accessTokenPreview || "—",
      code: true,
    },
    {
      key: "hasRefreshToken",
      label: i18n._({ id: "Refresh token saved", message: "Refresh token saved" }),
      value: Boolean(authState.hasRefreshToken)
        ? i18n._({ id: "Yes", message: "Yes" })
        : i18n._({ id: "No", message: "No" }),
      code: false,
    },
    {
      key: "refreshTokenPreview",
      label: i18n._({
        id: "Refresh token preview",
        message: "Refresh token preview",
      }),
      value: authState.refreshTokenPreview || "—",
      code: true,
    },
    {
      key: "obtainedAt",
      label: i18n._({ id: "Obtained at", message: "Obtained at" }),
      value: authState.obtainedAt || "—",
      code: false,
    },
    {
      key: "accessTokenExpiresAt",
      label: i18n._({
        id: "Access token expires at",
        message: "Access token expires at",
      }),
      value: authState.expiresAt || "—",
      code: false,
    },
    {
      key: "refreshTokenExpiresAt",
      label: i18n._({
        id: "Refresh token expires at",
        message: "Refresh token expires at",
      }),
      value: authState.refreshExpiresAt || "—",
      code: false,
    },
    {
      key: "openId",
      label: i18n._({ id: "Open ID", message: "Open ID" }),
      value: authState.openId || "—",
      code: true,
    },
    {
      key: "unionId",
      label: i18n._({ id: "Union ID", message: "Union ID" }),
      value: authState.unionId || "—",
      code: true,
    },
  ];
}

function formatPersistedTokenSnapshotForCopy(
  snapshot:
    | Array<{
        key: string;
        label: string;
        value: string;
        code: boolean;
      }>
    | null,
) {
  if (!snapshot || snapshot.length === 0) {
    return "";
  }
  return snapshot.map((item) => `${item.label}: ${item.value}`).join("\n");
}
