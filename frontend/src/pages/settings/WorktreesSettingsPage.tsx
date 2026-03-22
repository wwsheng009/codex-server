import { useMemo } from 'react'

import { SettingsGroup, SettingRow, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import { useSettingsLocalStore } from '../../features/settings/local-store'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { Input } from '../../components/ui/Input'
import { Switch } from '../../components/ui/Switch'
import { i18n } from '../../i18n/runtime'

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
        description={i18n._({
          id: 'Review worktree retention policy and root reuse behavior. Current worktree data is approximated from registered workspace roots.',
          message:
            'Review worktree retention policy and root reuse behavior. Current worktree data is approximated from registered workspace roots.',
        })}
        meta={
          <>
            <span className="meta-pill">
              {i18n._({
                id: '{count} max',
                message: '{count} max',
                values: { count: maxWorktrees },
              })}
            </span>
            <span className="meta-pill">
              {i18n._({
                id: '{count}d prune',
                message: '{count}d prune',
                values: { count: autoPruneDays },
              })}
            </span>
          </>
        }
        title={i18n._({ id: 'Worktrees', message: 'Worktrees' })}
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description={i18n._({
            id: 'Local policy controls for future worktree-aware flows.',
            message: 'Local policy controls for future worktree-aware flows.',
          })}
          title={i18n._({ id: 'Policy', message: 'Policy' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Limit how many worktrees this client should keep visible before pruning guidance appears.',
              message: 'Limit how many worktrees this client should keep visible before pruning guidance appears.',
            })}
            title={i18n._({ id: 'Maximum Worktrees', message: 'Maximum Worktrees' })}
          >
            <Input
              label={i18n._({ id: 'Max Worktrees', message: 'Max Worktrees' })}
              onChange={(event) => setMaxWorktrees(Number.parseInt(event.target.value || '0', 10) || 0)}
              type="number"
              value={maxWorktrees}
            />
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Control local cleanup timing and whether existing branches should be reused.',
              message: 'Control local cleanup timing and whether existing branches should be reused.',
            })}
            title={i18n._({ id: 'Cleanup', message: 'Cleanup' })}
          >
            <Input
              label={i18n._({ id: 'Auto Prune Days', message: 'Auto Prune Days' })}
              onChange={(event) => setAutoPruneDays(Number.parseInt(event.target.value || '0', 10) || 0)}
              type="number"
              value={autoPruneDays}
            />
            <Switch
              label={i18n._({ id: 'Reuse Branches', message: 'Reuse Branches' })}
              checked={reuseBranches}
              onChange={(event) => setReuseBranches(event.target.checked)}
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Distinct roots currently represented by the registered workspace list.',
            message: 'Distinct roots currently represented by the registered workspace list.',
          })}
          title={i18n._({ id: 'Registered Roots', message: 'Registered Roots' })}
        >
          <SettingRow
            description={i18n._({
              id: 'This is not yet live git worktree discovery. It is a stable placeholder using the roots already known to the client.',
              message:
                'This is not yet live git worktree discovery. It is a stable placeholder using the roots already known to the client.',
            })}
            title={i18n._({ id: 'Root Overview', message: 'Root Overview' })}
          >
            {!rootSummary.length ? (
              <div className="empty-state">
                {i18n._({ id: 'No roots available yet.', message: 'No roots available yet.' })}
              </div>
            ) : null}
            <div className="directory-list">
              {rootSummary.map((root) => (
                <article className="directory-item" key={root.rootPath}>
                  <div className="directory-item__icon">WT</div>
                  <div className="directory-item__body">
                    <strong>{root.rootPath}</strong>
                    <p>
                      {root.count === 1
                        ? i18n._({
                            id: '{count} registered workspace shares this root.',
                            message: '{count} registered workspace shares this root.',
                            values: { count: root.count },
                          })
                        : i18n._({
                            id: '{count} registered workspaces share this root.',
                            message: '{count} registered workspaces share this root.',
                            values: { count: root.count },
                          })}
                    </p>
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
