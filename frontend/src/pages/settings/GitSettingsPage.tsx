import { SettingsGroup, SettingRow, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import { useSettingsLocalStore } from '../../features/settings/local-store'
import { i18n } from '../../i18n/runtime'

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
        description={i18n._({
          id: 'Keep git-related writing templates and safety preferences in one predictable settings page.',
          message: 'Keep git-related writing templates and safety preferences in one predictable settings page.',
        })}
        meta={
          <span className="meta-pill">
            {confirmGitActions
              ? i18n._({ id: 'Confirm before write', message: 'Confirm before write' })
              : i18n._({ id: 'Direct actions', message: 'Direct actions' })}
          </span>
        }
        title={i18n._({ id: 'Git', message: 'Git' })}
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description={i18n._({
            id: 'Local-only git authoring defaults.',
            message: 'Local-only git authoring defaults.',
          })}
          title={i18n._({ id: 'Templates', message: 'Templates' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Default structure for generated commit messages.',
              message: 'Default structure for generated commit messages.',
            })}
            title={i18n._({ id: 'Commit Template', message: 'Commit Template' })}
          >
            <label className="field">
              <span>{i18n._({ id: 'Template', message: 'Template' })}</span>
              <textarea
                className="ide-textarea"
                onChange={(event) => setGitCommitTemplate(event.target.value)}
                rows={6}
                value={gitCommitTemplate}
              />
            </label>
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Default structure for generated pull request summaries.',
              message: 'Default structure for generated pull request summaries.',
            })}
            title={i18n._({ id: 'Pull Request Template', message: 'Pull Request Template' })}
          >
            <label className="field">
              <span>{i18n._({ id: 'Template', message: 'Template' })}</span>
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
          description={i18n._({
            id: 'Safety defaults for git-affecting flows.',
            message: 'Safety defaults for git-affecting flows.',
          })}
          title={i18n._({ id: 'Guardrails', message: 'Guardrails' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Require an explicit confirmation step before applying git-affecting actions from future settings-aware workflows.',
              message:
                'Require an explicit confirmation step before applying git-affecting actions from future settings-aware workflows.',
            })}
            title={i18n._({ id: 'Confirmation', message: 'Confirmation' })}
          >
            <label className="field field--inline">
              <span>{i18n._({ id: 'Confirm Git Actions', message: 'Confirm Git Actions' })}</span>
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
