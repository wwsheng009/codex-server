import { i18n } from '../../i18n/runtime'

export type RuntimeSensitiveConfigItem = {
  keyPath: string
  description: string
}

export type SuggestedConfigTemplate = {
  title: string
  description: string
  value: unknown
}

export const runtimeSensitiveConfigItems: RuntimeSensitiveConfigItem[] = [
  {
    keyPath: 'shell_environment_policy',
    description: i18n._({
      id: 'Controls inherited environment variables for shell, command/exec, unified_exec, and thread/shellCommand child processes.',
      message:
        'Controls inherited environment variables for shell, command/exec, unified_exec, and thread/shellCommand child processes.',
    }),
  },
  {
    keyPath: 'approval_policy',
    description: i18n._({
      id: 'Changes the default approval behavior used by new thread and turn operations.',
      message: 'Changes the default approval behavior used by new thread and turn operations.',
    }),
  },
  {
    keyPath: 'sandbox_mode',
    description: i18n._({
      id: 'Changes the default sandbox mode for new sessions when no per-request override is provided.',
      message:
        'Changes the default sandbox mode for new sessions when no per-request override is provided.',
    }),
  },
  {
    keyPath: 'sandbox_workspace_write',
    description: i18n._({
      id: 'Changes workspace-write sandbox details such as writable roots and network access.',
      message: 'Changes workspace-write sandbox details such as writable roots and network access.',
    }),
  },
  {
    keyPath: 'model',
    description: i18n._({
      id: 'Changes the default model used by the runtime when requests do not override model explicitly.',
      message:
        'Changes the default model used by the runtime when requests do not override model explicitly.',
    }),
  },
  {
    keyPath: 'model_provider',
    description: i18n._({
      id: 'Changes the default model provider selection used by the runtime.',
      message: 'Changes the default model provider selection used by the runtime.',
    }),
  },
  {
    keyPath: 'model_reasoning_effort',
    description: i18n._({
      id: 'Changes the default reasoning effort applied by the runtime.',
      message: 'Changes the default reasoning effort applied by the runtime.',
    }),
  },
  {
    keyPath: 'model_reasoning_summary',
    description: i18n._({
      id: 'Changes the default reasoning summary behavior for new sessions.',
      message: 'Changes the default reasoning summary behavior for new sessions.',
    }),
  },
  {
    keyPath: 'model_verbosity',
    description: i18n._({
      id: 'Changes the default model verbosity used by the runtime.',
      message: 'Changes the default model verbosity used by the runtime.',
    }),
  },
  {
    keyPath: 'service_tier',
    description: i18n._({
      id: 'Changes the default service tier used by the runtime.',
      message: 'Changes the default service tier used by the runtime.',
    }),
  },
]

export function isRuntimeSensitiveConfigKey(keyPath: string) {
  return getRuntimeSensitiveConfigItem(keyPath) !== null
}

export function getRuntimeSensitiveConfigItem(keyPath: string) {
  const normalized = keyPath.trim()
  if (!normalized) {
    return null
  }

  return (
    runtimeSensitiveConfigItems.find(
      (item) => normalized === item.keyPath || normalized.startsWith(`${item.keyPath}.`),
    ) ?? null
  )
}

export function getSuggestedConfigTemplate(keyPath: string): SuggestedConfigTemplate | null {
  const normalized = keyPath.trim()
  if (!normalized) {
    return null
  }

  if (normalized === 'shell_environment_policy') {
    return {
      title: i18n._({
        id: 'Windows-safe shell environment policy',
        message: 'Windows-safe shell environment policy',
      }),
      description: i18n._({
        id: 'Minimal example that keeps inherit=core while restoring the Windows command-resolution variables most likely to break node/npm/cmd execution.',
        message:
          'Minimal example that keeps inherit=core while restoring the Windows command-resolution variables most likely to break node/npm/cmd execution.',
      }),
      value: {
        inherit: 'core',
        set: {
          PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
          SystemRoot: 'C:\\Windows',
          ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        },
      },
    }
  }

  if (normalized === 'approval_policy') {
    return {
      title: i18n._({ id: 'Approval policy example', message: 'Approval policy example' }),
      description: i18n._({
        id: 'Sets the default approval policy for new sessions.',
        message: 'Sets the default approval policy for new sessions.',
      }),
      value: 'on-request',
    }
  }

  if (normalized === 'sandbox_mode') {
    return {
      title: i18n._({ id: 'Sandbox mode example', message: 'Sandbox mode example' }),
      description: i18n._({
        id: 'Sets the default sandbox mode when requests do not override sandbox explicitly.',
        message: 'Sets the default sandbox mode when requests do not override sandbox explicitly.',
      }),
      value: 'workspace-write',
    }
  }

  if (normalized === 'sandbox_workspace_write') {
    return {
      title: i18n._({
        id: 'Workspace-write sandbox example',
        message: 'Workspace-write sandbox example',
      }),
      description: i18n._({
        id: 'Example workspace-write sandbox configuration with network enabled.',
        message: 'Example workspace-write sandbox configuration with network enabled.',
      }),
      value: {
        writable_roots: [],
        network_access: true,
        exclude_tmpdir_env_var: false,
        exclude_slash_tmp: false,
      },
    }
  }

  if (normalized === 'model') {
    return {
      title: i18n._({ id: 'Default model example', message: 'Default model example' }),
      description: i18n._({
        id: 'Sets the default model used by the runtime.',
        message: 'Sets the default model used by the runtime.',
      }),
      value: 'gpt-5.4',
    }
  }

  if (normalized === 'model_provider') {
    return {
      title: i18n._({ id: 'Model provider example', message: 'Model provider example' }),
      description: i18n._({
        id: 'Sets the default model provider identifier.',
        message: 'Sets the default model provider identifier.',
      }),
      value: 'openai',
    }
  }

  if (normalized === 'model_reasoning_effort') {
    return {
      title: i18n._({ id: 'Reasoning effort example', message: 'Reasoning effort example' }),
      description: i18n._({
        id: 'Sets the default reasoning effort for compatible models.',
        message: 'Sets the default reasoning effort for compatible models.',
      }),
      value: 'medium',
    }
  }

  if (normalized === 'model_reasoning_summary') {
    return {
      title: i18n._({ id: 'Reasoning summary example', message: 'Reasoning summary example' }),
      description: i18n._({
        id: 'Sets the default reasoning summary mode.',
        message: 'Sets the default reasoning summary mode.',
      }),
      value: 'auto',
    }
  }

  if (normalized === 'model_verbosity') {
    return {
      title: i18n._({ id: 'Model verbosity example', message: 'Model verbosity example' }),
      description: i18n._({
        id: 'Sets the default response verbosity.',
        message: 'Sets the default response verbosity.',
      }),
      value: 'medium',
    }
  }

  if (normalized === 'service_tier') {
    return {
      title: i18n._({ id: 'Service tier example', message: 'Service tier example' }),
      description: i18n._({
        id: 'Sets the default service tier for model requests.',
        message: 'Sets the default service tier for model requests.',
      }),
      value: 'auto',
    }
  }

  return null
}
