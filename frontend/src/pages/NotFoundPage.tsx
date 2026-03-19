import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="page">
      <div className="card">
        <h1>Page Not Found</h1>
        <p>The requested route does not exist in this scaffold yet.</p>
        <Link className="button" to="/workspaces">
          Back to Workspaces
        </Link>
      </div>
    </section>
  )
}
