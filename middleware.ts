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
