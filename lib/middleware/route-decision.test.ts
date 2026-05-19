import { describe, expect, it } from "vitest";
import { nextRouteForAuth } from "./route-decision";

describe("nextRouteForAuth", () => {
  it("redirects unauthenticated to /setup when setup is incomplete", () => {
    expect(
      nextRouteForAuth({
        authenticated: false,
        setupComplete: false,
        pathname: "/",
      }),
    ).toEqual({ type: "redirect", to: "/setup" });
  });

  it("redirects unauthenticated to /signin when setup is complete", () => {
    expect(
      nextRouteForAuth({
        authenticated: false,
        setupComplete: true,
        pathname: "/",
      }),
    ).toEqual({ type: "redirect", to: "/signin" });
  });

  it("does not redirect when the user is authenticated", () => {
    expect(
      nextRouteForAuth({
        authenticated: true,
        setupComplete: true,
        pathname: "/",
      }),
    ).toEqual({ type: "next" });
  });

  it("does not redirect /setup itself when setup is incomplete (avoid loop)", () => {
    expect(
      nextRouteForAuth({
        authenticated: false,
        setupComplete: false,
        pathname: "/setup",
      }),
    ).toEqual({ type: "next" });
  });

  it("does not redirect /signin itself when setup is complete (avoid loop)", () => {
    expect(
      nextRouteForAuth({
        authenticated: false,
        setupComplete: true,
        pathname: "/signin",
      }),
    ).toEqual({ type: "next" });
  });

  it("redirects /setup to /signin once setup is complete and user is unauthenticated", () => {
    expect(
      nextRouteForAuth({
        authenticated: false,
        setupComplete: true,
        pathname: "/setup",
      }),
    ).toEqual({ type: "redirect", to: "/signin" });
  });

  it("never intercepts /api/* (auth endpoints, etc.)", () => {
    expect(
      nextRouteForAuth({
        authenticated: false,
        setupComplete: false,
        pathname: "/api/auth/callback/credentials",
      }),
    ).toEqual({ type: "next" });
  });

  it("never intercepts /claim (public invite-claim flow, M4.2)", () => {
    expect(
      nextRouteForAuth({
        authenticated: false,
        setupComplete: true,
        pathname: "/claim",
      }),
    ).toEqual({ type: "next" });
  });

  it("never intercepts Next.js internals", () => {
    expect(
      nextRouteForAuth({
        authenticated: false,
        setupComplete: false,
        pathname: "/_next/static/foo.js",
      }),
    ).toEqual({ type: "next" });
  });
});
