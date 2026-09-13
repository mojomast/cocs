'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#080f13',
          color: '#e8f0ed',
          fontFamily: 'Arial, Helvetica, sans-serif',
        }}
      >
        <div
          style={{
            width: 'min(440px, 92vw)',
            padding: 35,
            background: '#112024',
            border: '1px solid #779c893d',
            boxShadow: '0 20px 80px #0008',
          }}
        >
          <p style={{ margin: 0, color: '#9cb3ab', fontFamily: 'monospace', fontSize: 12, letterSpacing: 1.7 }}>
            RUNTIME ERROR
          </p>
          <h2 style={{ margin: '16px 0', fontSize: 34, letterSpacing: -1, lineHeight: 1.1 }}>
            Something went wrong
          </h2>
          <p style={{ margin: 0, color: '#98afa2', fontSize: 14, lineHeight: 1.7 }}>
            The arena could not start. Retry, or reload the page.
          </p>
          {error.digest ? (
            <p style={{ margin: '12px 0 0', color: '#b4c7bf', fontFamily: 'monospace', fontSize: 12 }}>
              Reference {error.digest}
            </p>
          ) : null}
          <button
            className="deploy-button"
            type="button"
            style={{
              border: '1px solid #cdfdb4',
              background: '#c4f7ab',
              color: '#142615',
              width: '100%',
              padding: '17px 19px',
              fontSize: 15,
              fontWeight: 750,
              letterSpacing: 1,
              marginTop: 25,
            }}
            onClick={() => reset()}
          >
            TRY AGAIN
          </button>
          <button
            className="secondary-button"
            type="button"
            style={{
              display: 'block',
              background: 'transparent',
              border: '1px solid #90baa143',
              padding: 14,
              color: '#b0ccb9',
              fontFamily: 'monospace',
              fontSize: 12,
              letterSpacing: 1,
              width: '100%',
              marginTop: 12,
            }}
            onClick={() => window.location.reload()}
          >
            RELOAD PAGE
          </button>
        </div>
      </body>
    </html>
  );
}
