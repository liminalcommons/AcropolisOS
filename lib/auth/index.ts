import NextAuth from "next-auth";
import { buildAuthConfig } from "./config";

export const { auth, handlers, signIn, signOut } = NextAuth(buildAuthConfig());

export { buildAuthConfig } from "./config";
export type { Actor, Ctx, AcropolisSession } from "../ctx";
export { createCtx } from "../ctx";
