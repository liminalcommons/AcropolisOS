import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await auth();
  const name =
    typeof session?.user?.email === "string"
      ? session.user.email
      : "steward";
  return (
    <main>
      <div className="mx-auto max-w-2xl px-8 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome to acropolisOS
        </h1>
        <p className="mt-3 text-muted-foreground">
          Signed in as {name}. Setup is complete.
        </p>
        <p className="mt-6 text-sm text-muted-foreground">
          Open the chat panel to start exploring your ontology. Stewards can
          review proposals at <code className="text-foreground">/proposals</code>.
        </p>
      </div>
    </main>
  );
}
