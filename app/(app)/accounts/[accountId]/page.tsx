export default async function CardAccountPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return (
    <main className="app-main">
      <section className="section">
        <div className="page-head">
          <div>
            <div className="page-kicker">Credit card</div>
            <h1 className="page-title">{accountId}</h1>
          </div>
        </div>
      </section>
    </main>
  );
}
