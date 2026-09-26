import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="app-main">
      <section className="section">
        <div className="empty-state">
          <p className="empty-title">Nothing here</p>
          <p className="empty-body">That page does not exist.</p>
          <Link className="btn btn-secondary" to="/overview">
            Go to the overview
          </Link>
        </div>
      </section>
    </main>
  );
}
