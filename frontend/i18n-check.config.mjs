export default {
  files: [],
  texts: [
    'English',
  ],
  textPatterns: [
    '/^[A-Za-z]:\\/[\\w./-]+$/i',
    '/^\\/api\\/.*\\$\\{…\\}/',
  ],
  entries: [
    {
      filePattern: 'src/components/workspace/CreateWorkspaceDialog.tsx',
      attribute: 'placeholder',
      text: 'E:/projects/my-app',
      reason: '示例路径',
    },
    // Dev-only profiler debug labels
    {
      filePattern: 'src/components/workspace/threadConversationProfiler.tsx',
      kind: 'literal',
      reason: 'Dev-only profiler debug label',
    },
    {
      filePattern: 'src/components/workspace/threadConversationProfiler.tsx',
      kind: 'return-literal',
      reason: 'Dev-only profiler debug label',
    },
    // Technical kind/source identifiers in threadLiveState
    {
      filePattern: 'src/pages/threadLiveState.ts',
      text: 'thread-live',
      reason: 'Debug log label identifier',
    },
    // UI component technical identifiers
    {
      filePattern: 'src/components/ui/Tabs.tsx',
      kind: 'variable-initializer',
      reason: 'Technical DOM id pattern',
    },
    {
      filePattern: 'src/components/ui/Slider.tsx',
      kind: 'array-element',
      reason: 'CSS class name',
    },
    {
      filePattern: 'src/components/ui/TextArea.tsx',
      kind: 'array-element',
      reason: 'CSS class name',
    },
    {
      filePattern: 'src/components/shell/NotificationCenter.tsx',
      text: '/bots/${…}/logs',
      reason: 'Internal navigation path template',
    },
    // i18n config technical text
    {
      filePattern: 'src/i18n/config.ts',
      reason: 'Locale metadata (native labels)',
    },
    // Command palette group names (technical categories)
    {
      filePattern: 'src/components/shell/CommandPalette.tsx',
      kind: 'array-element',
      reason: 'Command palette group category key',
    },
    {
      filePattern: 'src/components/shell/AppShell.tsx',
      kind: 'object-property',
      property: 'group',
      reason: 'Command palette group category key',
    },
    {
      filePattern: 'src/components/shell/AppShell.tsx',
      kind: 'object-property',
      property: 'shortcut',
      reason: 'Keyboard shortcut display',
    },
    {
      filePattern: 'src/components/shell/AppShell.tsx',
      kind: 'return-literal',
      reason: 'Keyboard shortcut display',
    },
    {
      filePattern: 'src/components/shell/AppShell.tsx',
      kind: 'literal',
      reason: 'Keyboard shortcut display',
    },
    {
      filePattern: 'src/components/shell/AppMenuBar.tsx',
      kind: 'array-element',
      reason: 'Menu bar category key',
    },
    // Turn policy display - technical enum labels
    {
      filePattern: 'src/lib/turn-policy-display.ts',
      reason: 'Turn policy technical enum label',
    },
    // Workspace stream - internal event source identifiers
    {
      filePattern: 'src/hooks/useWorkspaceStream.ts',
      reason: 'Internal event source identifier',
    },
    // Debug utilities
    {
      filePattern: 'src/features/thread-terminal/threadTerminalDebugUtils.ts',
      reason: 'Debug utility technical label',
    },
    {
      filePattern: 'src/features/thread-terminal/threadTerminalStressHelpers.ts',
      reason: 'Debug/stress test utility',
    },
    // Turn policy compare page - technical enum values
    {
      filePattern: 'src/pages/WorkspaceTurnPolicyComparePage.tsx',
      text: 'Interactive',
      reason: 'Turn policy type enum value',
    },
    {
      filePattern: 'src/pages/WorkspaceTurnPolicyComparePage.tsx',
      text: 'Automation',
      reason: 'Turn policy type enum value',
    },
    {
      filePattern: 'src/pages/WorkspaceTurnPolicyComparePage.tsx',
      text: 'Bot',
      reason: 'Turn policy type enum value',
    },
    {
      filePattern: 'src/pages/WorkspaceTurnPolicyComparePage.tsx',
      text: 'last24Hours',
      reason: 'Time range enum value',
    },
    {
      filePattern: 'src/pages/workspaces/WorkspaceTurnPolicySourceSummarySection.tsx',
      text: 'last24Hours',
      reason: 'Time range enum value',
    },
    {
      filePattern: 'src/pages/workspaces/WorkspaceHookConfigurationEditorSection.tsx',
      text: '${…}\\.codex\\hooks.json',
      reason: 'Example file path pattern',
    },
    // Runtime recovery - technical identifiers
    {
      filePattern: 'src/features/workspaces/runtimeRecovery.ts',
      reason: 'Runtime recovery technical label',
    },
    // Shell environment diagnostics - technical identifiers
    {
      filePattern: 'src/features/settings/shell-environment-diagnostics.ts',
      reason: 'Shell environment technical label',
    },
    // Session start template - technical identifiers
    {
      filePattern: 'src/lib/session-start-template.ts',
      reason: 'Technical template label',
    },
    // Thread terminal shell utils - technical identifiers
    {
      filePattern: 'src/features/thread-terminal/threadTerminalShellUtils.ts',
      reason: 'Technical shell utility label',
    },
    // Thread turn retry prompts - sent to AI model, not user-facing
    {
      filePattern: 'src/pages/threadPageTurnHelpers.ts',
      reason: 'AI model retry prompt (not user-facing)',
    },
    // Settings local store - auto-generated theme names and template defaults
    {
      filePattern: 'src/features/settings/local-store.ts',
      kind: 'literal',
      reason: 'Auto-generated theme name / template default',
    },
    // React component displayName - technical identifier
    {
      filePattern: 'src/components/ui/Button.tsx',
      kind: 'literal',
      reason: 'React component displayName',
    },
    {
      filePattern: 'src/components/ui/Input.tsx',
      kind: 'literal',
      reason: 'React component displayName',
    },
    {
      filePattern: 'src/components/ui/Slider.tsx',
      kind: 'literal',
      reason: 'React component displayName',
    },
    {
      filePattern: 'src/components/ui/Switch.tsx',
      kind: 'literal',
      reason: 'React component displayName',
    },
    {
      filePattern: 'src/components/ui/TextArea.tsx',
      kind: 'literal',
      reason: 'React component displayName',
    },
    {
      filePattern: 'src/components/ui/Input.tsx',
      kind: 'variable-initializer',
      reason: 'React component displayName',
    },
    // Thread terminal viewport - technical labels
    {
      filePattern: 'src/features/thread-terminal/ThreadTerminalViewport.tsx',
      reason: 'Terminal viewport technical label',
    },
    // API client - error code matching
    {
      filePattern: 'src/lib/api-client.ts',
      reason: 'API error code / technical identifier',
    },
    // Error utils - technical error identifiers
    {
      filePattern: 'src/lib/error-utils.ts',
      reason: 'Error classification technical identifier',
    },
    // Route error - technical identifiers
    {
      filePattern: 'src/lib/route-error.ts',
      reason: 'Route error technical identifier',
    },
    // Approvals cache - technical identifiers
    {
      filePattern: 'src/features/approvals/cache.ts',
      reason: 'Approvals cache technical label',
    },
    // Thread terminal viewport - technical label
    {
      filePattern: 'src/features/thread-terminal/ThreadTerminalViewport.tsx',
      reason: 'Terminal technical label',
    },
    // === New whitelist entries ===
    // renderers.tsx - debug log messages (not user-facing)
    {
      filePattern: 'src/components/workspace/renderers.tsx',
      text: 'commandExecution without command/output/status',
      reason: 'Debug log suppression reason (not user-facing)',
    },
    {
      filePattern: 'src/components/workspace/renderers.tsx',
      text: '${…} without text',
      reason: 'Debug log suppression template (not user-facing)',
    },
    {
      filePattern: 'src/components/workspace/renderers.tsx',
      text: 'conversation entry omitted: ${…}',
      reason: 'Debug log suppression message (not user-facing)',
    },
    {
      filePattern: 'src/components/workspace/renderers.tsx',
      text: '${…} ... [truncated, ${…} more chars]',
      reason: 'Debug truncation template (not user-facing)',
    },
    // threadLiveState.ts - all debug log labels (not user-facing)
    {
      filePattern: 'src/pages/threadLiveState.ts',
      reason: 'Debug log / event replay technical label (not user-facing)',
    },
    // useSystemAppearancePreferences.ts - CSS media query strings
    {
      filePattern: 'src/features/settings/useSystemAppearancePreferences.ts',
      reason: 'CSS media query string (technical)',
    },
    // config-scenarios.ts - PATHEXT environment variable value
    {
      filePattern: 'src/features/settings/config-scenarios.ts',
      reason: 'Windows PATHEXT environment variable value (technical)',
    },
    // runtime-sensitive-config.ts - PATHEXT environment variable value
    {
      filePattern: 'src/features/settings/runtime-sensitive-config.ts',
      reason: 'Windows PATHEXT environment variable value (technical)',
    },
    // ConfigSettingsPage.tsx - PATHEXT in example JSON
    {
      filePattern: 'src/pages/settings/ConfigSettingsPage.tsx',
      text: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
      reason: 'Windows PATHEXT value in example JSON (technical)',
    },
    // local-store.ts - CSS font stacks and git templates (technical/technical defaults)
    {
      filePattern: 'src/features/settings/local-store.ts',
      kind: 'object-property',
      property: 'gitCommitTemplate',
      reason: 'Default git commit template (technical default)',
    },
    {
      filePattern: 'src/features/settings/local-store.ts',
      kind: 'object-property',
      property: 'gitPullRequestTemplate',
      reason: 'Default git PR template (technical default)',
    },
    {
      filePattern: 'src/features/settings/local-store.ts',
      kind: 'object-property',
      property: 'uiFont',
      reason: 'CSS font stack (technical)',
    },
    {
      filePattern: 'src/features/settings/local-store.ts',
      kind: 'object-property',
      property: 'codeFont',
      reason: 'CSS font stack (technical)',
    },
    {
      filePattern: 'src/features/settings/local-store.ts',
      kind: 'object-property',
      property: 'terminalFont',
      reason: 'CSS font stack (technical)',
    },
    // BotsPage.tsx - route paths and CSS
    {
      filePattern: 'src/pages/BotsPage.tsx',
      text: ':thread:',
      reason: 'Emoji key in icon map (technical)',
    },
    {
      filePattern: 'src/pages/BotsPage.tsx',
      text: '/bots/${…}/logs',
      reason: 'Internal navigation path template',
    },
    {
      filePattern: 'src/pages/BotsPage.tsx',
      text: 'opacity 180ms ease',
      reason: 'CSS transition value (technical)',
    },
    // EnvironmentSettingsPage.tsx - technical identifiers
    {
      filePattern: 'src/pages/settings/EnvironmentSettingsPage.tsx',
      text: 'shell_environment_policy.',
      reason: 'Config key prefix (technical)',
    },
    {
      filePattern: 'src/pages/settings/EnvironmentSettingsPage.tsx',
      text: 'Δdrop',
      reason: 'Technical delta label (not user-facing)',
    },
    {
      filePattern: 'src/pages/settings/EnvironmentSettingsPage.tsx',
      text: 'Δqueue',
      reason: 'Technical delta label (not user-facing)',
    },
    {
      filePattern: 'src/pages/settings/EnvironmentSettingsPage.tsx',
      text: 'Δbytes',
      reason: 'Technical delta label (not user-facing)',
    },
    // threadTerminalStressDomain.ts - debug/stress test label
    {
      filePattern: 'src/features/thread-terminal/threadTerminalStressDomain.ts',
      reason: 'Debug/stress test utility label (not user-facing)',
    },
    // useThreadTerminalStressHistoryState.ts - debug filename
    {
      filePattern: 'src/features/thread-terminal/useThreadTerminalStressHistoryState.ts',
      reason: 'Debug export filename template (not user-facing)',
    },
    // frontend-runtime-mode.ts - debug truncation
    {
      filePattern: 'src/lib/frontend-runtime-mode.ts',
      reason: 'Debug truncation template (not user-facing)',
    },
    // hook-run-display.ts - debug label
    {
      filePattern: 'src/lib/hook-run-display.ts',
      reason: 'Debug display label (not user-facing)',
    },
    // workspace-stream-broadcast.ts - channel prefix
    {
      filePattern: 'src/lib/workspace-stream-broadcast.ts',
      reason: 'Broadcast channel prefix (technical identifier)',
    },
    // AutomationDetailPage.tsx - CSS value
    {
      filePattern: 'src/pages/AutomationDetailPage.tsx',
      reason: 'CSS value / technical property (not user-facing)',
    },
    // AppearanceSettingsPage.tsx - code preview template
    {
      filePattern: 'src/pages/settings/AppearanceSettingsPage.tsx',
      reason: 'Theme config code preview (technical display)',
    },
    // threadPageComposerShared.tsx - storage prefix and model identifier
    {
      filePattern: 'src/pages/thread-page/threadPageComposerShared.tsx',
      text: 'codex-server:composer-preferences:',
      reason: 'LocalStorage key prefix (technical)',
    },
    {
      filePattern: 'src/pages/thread-page/threadPageComposerShared.tsx',
      text: 'gpt-5.3-codex',
      reason: 'Model identifier (technical)',
    },
    // ThreadPageLayout.tsx - CSS class
    {
      filePattern: 'src/pages/thread-page/ThreadPageLayout.tsx',
      text: 'screen workbench-screen',
      reason: 'CSS class name (technical)',
    },
    // threadPageRecoveryExecution.ts - debug info
    {
      filePattern: 'src/pages/thread-page/threadPageRecoveryExecution.ts',
      reason: 'Debug recovery info (not user-facing)',
    },
    // ThreadWorkbenchRailHookConfigurationSection.tsx - file path pattern
    {
      filePattern: 'src/pages/thread-page/ThreadWorkbenchRailHookConfigurationSection.tsx',
      text: '.codex/hooks.json, hooks.json',
      reason: 'File path pattern example (technical)',
    },
    // ThreadWorkbenchRailWorkbenchToolsSection.tsx - example command
    {
      filePattern: 'src/pages/thread-page/ThreadWorkbenchRailWorkbenchToolsSection.tsx',
      text: 'node script.js',
      reason: 'Example command (technical)',
    },
    // useThreadPageRefreshEffects.ts - debug reason
    {
      filePattern: 'src/pages/thread-page/useThreadPageRefreshEffects.ts',
      reason: 'Debug refresh reason (not user-facing)',
    },
    // useThreadViewportAutoScroll.ts - debug log
    {
      filePattern: 'src/pages/thread-page/useThreadViewportAutoScroll.ts',
      reason: 'Debug scroll log (not user-facing)',
    },
    // notification-center catalog - technical topic identifiers
    {
      filePattern: 'src/features/notification-center/catalog.ts',
      kind: 'object-property',
      property: 'topic',
      reason: 'Notification topic identifier catalog',
    },
    // logStreamUtils.ts - backend raw message matcher for legacy compatibility
    {
      filePattern: 'src/features/bots/logStreamUtils.ts',
      text: 'Poll completed successfully. No new messages.',
      reason: 'Backend raw runtime message matcher for legacy compatibility',
    },
    // FeishuToolsSettingsPage.tsx - window.open feature string, not user text
    {
      filePattern: 'src/pages/settings/FeishuToolsSettingsPage.tsx',
      text: 'noopener,noreferrer',
      reason: 'window.open features string (browser security token, not UI text)',
    },
  ],
}
