"use client";

import { useEffect } from "react";

/**
 * Last-resort screen when even the root layout fails. It can't rely on our
 * fonts or CSS, so it's styled inline.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#fffaf0",
          color: "#2b2a33",
          fontFamily: "'Comic Sans MS', 'Chalkboard SE', cursive",
          textAlign: "center",
          padding: 24,
        }}
      >
        <title>Park Roulette</title>
        <div>
          <p style={{ fontSize: 56, margin: 0 }} aria-hidden>
            🖍️
          </p>
          <h1 style={{ fontSize: 32, margin: "8px 0" }}>
            Oops, a crayon snapped!
          </h1>
          <p style={{ fontSize: 18, opacity: 0.75 }}>
            Give it another try in a sec.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 16,
              fontSize: 20,
              padding: "12px 24px",
              border: "2.5px solid #2b2a33",
              borderRadius: 14,
              background: "#f7c933",
              boxShadow: "3px 4px 0 #2b2a33",
              fontFamily: "inherit",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
