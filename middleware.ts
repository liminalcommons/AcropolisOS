import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { isSetupComplete } from "@/lib/setup/state";
import { getSetupFile } from "@/lib/setup/config";
import { nextRouteForAuth } from "@/lib/middleware/route-decision";

export default async function middleware(req: NextRequest) {
  const session = await auth();
  const setupComplete = await isSetupComplete(getSetupFile());
  const decision = nextRouteForAuth({
    authenticated: !!session?.user,
    setupComplete,
    pathname: req.nextUrl.pathname,
  });
  if (decision.type === "redirect") {
    const url = req.nextUrl.clone();
    url.pathname = decision.to;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

// Force Node.js runtime: the setup/state and setup/config modules read
// setup.json from disk via node:path / node:fs. Edge runtime can't load
// node: built-ins, so middleware throws on every request without this.
export const runtime = "nodejs";
