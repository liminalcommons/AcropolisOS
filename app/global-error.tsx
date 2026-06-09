"use client";
// LAST-RESORT boundary: catches throws in the ROOT LAYOUT itself (app/layout.tsx
// runs auth()/createCtx/role reads OUTSIDE any try/catch). error.tsx cannot catch
// layout throws, so without this a DB outage AT BOOT — the most common real
// failure — hits Next's default error screen. This closes the totality pillar
// end-to-end. global-error REPLACES the layout, so it must render its own
// <html>/<body>; the theme stylesheet may not have loaded → INLINE styles only.
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
          margin: 0,
        }}
      >
        <div style={{ maxWidth: 420, margin: "0 auto", padding: "64px 24px", textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>acropolisOS is temporarily unavailable</h1>
          <p style={{ marginTop: 8, fontSize: 14, opacity: 0.7 }}>
            The app couldn’t start this request — usually a database or
            configuration issue. The error has been logged.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              padding: "8px 16px",
              fontSize: 14,
              borderRadius: 6,
              border: "1px solid #333",
              background: "transparent",
              color: "#fafafa",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
