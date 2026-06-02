// Operator-only: mint a one-time passwordless sign-in link for the steward.
//
//   docker exec acropolisos-app sh -c \
//     "cd /app && npx --no-install tsx scripts/mint-magic-link.ts [email] [baseUrl]"
//
// email   defaults to steward@acropolisos.local
// baseUrl defaults to $AUTH_URL (the public tunnel host inside the container),
//         then http://localhost:3030
//
// Prints the URL to paste/tap. The token is single-use and expires (7d to
// first use); the session it establishes lasts the usual 30 days. Re-run any
// time to issue a fresh link — minting overwrites the previous one.
import { mintMagicLink } from "../lib/auth/magic-link";

async function main(): Promise<void> {
  const email = process.argv[2] ?? "steward@acropolisos.local";
  const baseUrl =
    process.argv[3] ?? process.env.AUTH_URL ?? "http://localhost:3030";

  const { url, expiresAt } = await mintMagicLink({ email, baseUrl });

  console.log("Magic sign-in link minted.");
  console.log(`  signs in: ${email}`);
  console.log(`  expires : ${expiresAt} (first use)`);
  console.log("");
  console.log(url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
