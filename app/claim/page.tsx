import { ClaimForm } from "@/components/claim-form";

export const dynamic = "force-dynamic";

interface ClaimPageProps {
  searchParams: Promise<{ code?: string }>;
}

export default async function ClaimPage({ searchParams }: ClaimPageProps) {
  const { code = "" } = await searchParams;
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-md px-8 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">
          Claim your invite
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Set a password to claim your acropolisOS membership. You will be
          taken to sign in with the email tied to your invite.
        </p>
        {code ? null : (
          <p
            role="alert"
            className="mt-4 rounded border border-amber-700 bg-amber-900/30 p-3 text-sm"
          >
            No invite code in the URL. The link should look like
            <code className="ml-1 text-amber-200">
              /claim?code=&lt;32-char-code&gt;
            </code>
            .
          </p>
        )}
        <ClaimForm code={code} />
      </div>
    </main>
  );
}
