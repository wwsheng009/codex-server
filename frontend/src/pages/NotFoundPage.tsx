import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="screen screen--centered">
      <section className="empty-card">
        <p className="page-header__eyebrow">404</p>
        <h1>Route Not Found</h1>
        <p className="page-header__description">This route does not exist in the rebuilt web IDE yet.</p>
        <div className="header-actions">
          <Link className="ide-button" to="/workspaces">
            Back to Workspaces
          </Link>
        </div>
      </section>
    </section>
  )
}
