'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="game-modal">
        <p className="eyebrow">Runtime error</p>
        <h2>Something went wrong</h2>
        <p>The arena hit an unexpected error. Retry the last action, or reload the page.</p>
        {error.digest ? <p className="section-label">Reference {error.digest}</p> : null}
        <button className="deploy-button" type="button" onClick={() => reset()}>
          <span>TRY AGAIN</span>
        </button>
        <button className="secondary-button" type="button" onClick={() => window.location.reload()}>
          RELOAD PAGE
        </button>
      </div>
    </div>
  );
}
