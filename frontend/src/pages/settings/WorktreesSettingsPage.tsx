import { useMemo } from 'react'

import { SettingsGroup, SettingRow, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import { useSettingsLocalStore } from '../../features/settings/local-store'
import { useSettingsShellContext } from '../../features/settings/shell-context'

export function WorktreesSettingsPage() {
  const { workspaces } = useSettingsShellContext()
  const maxWorktrees = useSettingsLocalStore((state) => state.maxWorktrees)
  const autoPruneDays = useSettingsLocalStore((state) => state.autoPruneDays)
  const reuseBranches = useSettingsLocalStore((state) => state.reuseBranches)
  const setMaxWorktrees = useSettingsLocalStore((state) => state.setMaxWorktrees)
  const setAutoPruneDays = useSettingsLocalStore((state) => state.setAutoPruneDays)
  const setReuseBranches = useSettingsLocalStore((state) => state.setReuseBranches)

  const rootSummary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const workspace of workspaces) {
      counts.set(workspace.rootPath, (counts.get(workspace.rootPath) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([rootPath, count]) => ({ rootPath, count }))
  }, [workspaces])

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description="Review worktree retention policy and root reuse behavior. Current worktree data is approximated from registered workspace roots."
        meta={
          <>
            <span className="meta-pill">{maxWorktrees} max</span>
            <span className="meta-pill">{autoPruneDays}d prune</span>
          </>
        }
        title="Worktrees"
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description="Local policy controls for future worktree-aware flows."
          title="Policy"
        >
          <SettingRow
            description="Limit how many worktrees this client should keep visible before pruning guidance appears."
            title="Maximum Worktrees"
          >
            <label className="field">
              <span>Max Worktrees</span>
              <input
                onChange={(event) => setMaxWorktrees(Number.parseInt(event.target.value || '0', 10) || 0)}
                type="number"
                value={maxWorktrees}
              />
            </label>
          </SettingRow>

          <SettingRow
            description="Control local cleanup timing and whether existing branches should be reused."
            title="Cleanup"
          >
            <label className="field">
              <span>Auto Prune Days</span>
              <input
                onChange={(event) => setAutoPruneDays(Number.parseInt(event.target.value || '0', 10) || 0)}
                type="number"
                value={autoPruneDays}
              />
            </label>
            <label className="field field--inline">
              <span>Reuse Branches</span>
              <input
                checked={reuseBranches}
                onChange={(event) => setReuseBranches(event.target.checked)}
                type="checkbox"
              />
            </label>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description="Distinct roots currently represented by the registered workspace list."
          title="Registered Roots"
        >
          <SettingRow
            description="This is not yet live git worktree discovery. It is a stable placeholder using the roots already known to the client."
            title="Root Overview"
          >
            {!rootSummary.length ? <div className="empty-state">No roots available yet.</div> : null}
            <div className="directory-list">
              {rootSummary.map((root) => (
                <article className="directory-item" key={root.rootPath}>
                  <div className="directory-item__icon">WT</div>
                  <div className="directory-item__body">
                    <strong>{root.rootPath}</strong>
                    <p>{root.count} registered workspace{root.count === 1 ? '' : 's'} share this root.</p>
                  </div>
                  <div className="directory-item__meta">
                    <span className="meta-pill">{root.count}</span>
                  </div>
                </article>
              ))}
            </div>
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}
