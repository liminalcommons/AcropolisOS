import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center font-sans">
      <h1 className="text-lg font-semibold text-foreground">Not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">That page doesn’t exist.</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
      >
        Back to your board
      </Link>
    </div>
  );
}
