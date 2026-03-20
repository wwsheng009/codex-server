const KEYS = {
  leftSidebarCollapsed: 'codex-server:left-sidebar-collapsed',
  leftSidebarWidth: 'codex-server:left-sidebar-width',
  workspaceThreadGroupsCollapsed: 'codex-server:workspace-thread-groups-collapsed',
  rightRailExpanded: 'codex-server:right-rail-expanded',
  rightRailWidth: 'codex-server:right-rail-width',
  surfacePanelWidths: 'codex-server:surface-panel-widths',
  surfacePanelSides: 'codex-server:surface-panel-sides',
} as const

function canUseStorage() {
  return typeof window !== 'undefined'
}

function readStorage(key: string) {
  if (!canUseStorage()) {
    return null
  }

  return window.localStorage.getItem(key)
}

function writeStorage(key: string, value: string) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(key, value)
}

export function readBooleanPreference(key: keyof typeof KEYS, fallback: boolean) {
  const raw = readStorage(KEYS[key])
  return raw === null ? fallback : raw === 'true'
}

export function writeBooleanPreference(key: keyof typeof KEYS, value: boolean) {
  writeStorage(KEYS[key], String(value))
}

export function readNumberPreference(
  key: keyof typeof KEYS,
  fallback: number,
  limits?: { min?: number; max?: number },
) {
  const raw = Number(readStorage(KEYS[key]))
  if (!Number.isFinite(raw)) {
    return fallback
  }

  if (typeof limits?.min === 'number' && raw < limits.min) {
    return fallback
  }

  if (typeof limits?.max === 'number' && raw > limits.max) {
    return fallback
  }

  return raw
}

export function writeNumberPreference(key: keyof typeof KEYS, value: number) {
  writeStorage(KEYS[key], String(value))
}

export function readJsonPreference<T>(key: keyof typeof KEYS, fallback: T) {
  const raw = readStorage(KEYS[key])
  if (!raw) {
    return fallback
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJsonPreference(key: keyof typeof KEYS, value: unknown) {
  writeStorage(KEYS[key], JSON.stringify(value))
}
