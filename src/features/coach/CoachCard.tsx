/** Placeholder for the Phase 2 weekly review. Visibly not connected; no AI calls exist in this build. */
export function CoachCard() {
  return (
    <section className="card" aria-labelledby="coach-h">
      <div className="card-head">
        <h2 id="coach-h">Weekly review</h2>
        <span className="badge">Not set up</span>
      </div>
      <p className="small" style={{ margin: 0 }}>
        The AI weekly review arrives in Phase 2, behind a protected backend and only with your separate AI consent. It will
        cite your actual logs and say when data is missing. Logging meals and sets never needs AI.
      </p>
    </section>
  );
}
