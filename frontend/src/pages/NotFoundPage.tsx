import { Link } from 'react-router-dom'
import { i18n } from '../i18n/runtime'

export function NotFoundPage() {
  return (
    <section className="screen screen--centered">
      <section className="empty-card">
        <p className="page-header__eyebrow">404</p>
        <h1>{i18n._({ id: 'Route Not Found', message: 'Route Not Found' })}</h1>
        <p className="page-header__description">
          {i18n._({
            id: 'This route does not exist in the rebuilt web IDE yet.',
            message: 'This route does not exist in the rebuilt web IDE yet.',
          })}
        </p>
        <div className="header-actions">
          <Link className="ide-button" to="/workspaces">
            {i18n._({ id: 'Back to Workspaces', message: 'Back to Workspaces' })}
          </Link>
        </div>
      </section>
    </section>
  )
}
