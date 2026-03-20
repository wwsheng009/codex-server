import { SettingsGroup, SettingRow, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import { useSettingsLocalStore } from '../../features/settings/local-store'

export function GitSettingsPage() {
  const gitCommitTemplate = useSettingsLocalStore((state) => state.gitCommitTemplate)
  const gitPullRequestTemplate = useSettingsLocalStore((state) => state.gitPullRequestTemplate)
  const confirmGitActions = useSettingsLocalStore((state) => state.confirmGitActions)
  const setGitCommitTemplate = useSettingsLocalStore((state) => state.setGitCommitTemplate)
  const setGitPullRequestTemplate = useSettingsLocalStore((state) => state.setGitPullRequestTemplate)
  const setConfirmGitActions = useSettingsLocalStore((state) => state.setConfirmGitActions)

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description="Keep git-related writing templates and safety preferences in one predictable settings page."
        meta={<span className="meta-pill">{confirmGitActions ? 'Confirm before write' : 'Direct actions'}</span>}
        title="Git"
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description="Local-only git authoring defaults."
          title="Templates"
        >
          <SettingRow
            description="Default structure for generated commit messages."
            title="Commit Template"
          >
            <label className="field">
              <span>Template</span>
              <textarea
                className="ide-textarea"
                onChange={(event) => setGitCommitTemplate(event.target.value)}
                rows={6}
                value={gitCommitTemplate}
              />
            </label>
          </SettingRow>

          <SettingRow
            description="Default structure for generated pull request summaries."
            title="Pull Request Template"
          >
            <label className="field">
              <span>Template</span>
              <textarea
                className="ide-textarea"
                onChange={(event) => setGitPullRequestTemplate(event.target.value)}
                rows={8}
                value={gitPullRequestTemplate}
              />
            </label>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description="Safety defaults for git-affecting flows."
          title="Guardrails"
        >
          <SettingRow
            description="Require an explicit confirmation step before applying git-affecting actions from future settings-aware workflows."
            title="Confirmation"
          >
            <label className="field field--inline">
              <span>Confirm Git Actions</span>
              <input
                checked={confirmGitActions}
                onChange={(event) => setConfirmGitActions(event.target.checked)}
                type="checkbox"
              />
            </label>
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}
