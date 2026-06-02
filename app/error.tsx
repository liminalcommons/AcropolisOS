"use client";
// Route error boundary — catches throws from page/segment rendering + data. With
// app/page.tsx no longer swallowing resolution failures (Task 5), a DB/ontology
// failure now PROPAGATES here instead of collapsing into a silent empty board.
// Does NOT catch root-layout throws — that is global-error.tsx's job.
import { useEffect } from "react";

export default function Error({
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
    <div className="mx-auto max-w-md px-6 py-16 text-center font-sans">
      <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This view couldn’t load. The error has been logged.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
      >
        Try again
      </button>
    </div>
  );
}
