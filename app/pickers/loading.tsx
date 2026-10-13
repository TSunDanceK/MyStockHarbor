// THE PICKERS LOADING STATE (#553 COWORK #86/#87). Replaces a "TEST LOADING
// PAGE" placeholder that could reach a visitor between pages: a short line and
// a few muted rows in the shape of the results table, in the site's dark tones.
// No figures, no claims -- just that the list is on its way.
export default function LoadingPickers() {
  return (
    <div className="pkLoad" role="status" aria-live="polite">
      <p className="pkLoadText">Loading…</p>
      <div className="pkLoadRows" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="pkLoadRow" />
        ))}
      </div>
      <style>{`
        .pkLoad { max-width: 1200px; margin: 0 auto; padding: 32px 16px 48px; }
        .pkLoadText { margin: 0 0 16px; font-size: 14px; color: rgba(148,163,184,0.85); }
        .pkLoadRows { display: grid; gap: 10px; }
        .pkLoadRow {
          height: 44px; border-radius: 10px;
          background: rgba(148,163,184,0.08); border: 1px solid rgba(255,255,255,0.05);
          animation: pkLoadPulse 1.4s ease-in-out infinite;
        }
        @keyframes pkLoadPulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .pkLoadRow { animation: none; } }
      `}</style>
    </div>
  );
}
