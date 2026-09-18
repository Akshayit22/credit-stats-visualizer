export default function SignInPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-8)',
      }}
    >
      <div style={{ width: 'min(380px, 100%)' }}>
        <h1 className="page-title" style={{ fontSize: 28 }}>
          cred-stats
        </h1>
        <p className="page-sub" style={{ marginTop: 'var(--space-3)' }}>
          No bank login. Statements are parsed, never stored as files.
        </p>
      </div>
    </main>
  );
}
