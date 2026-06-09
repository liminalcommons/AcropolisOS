import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 blocks cross-origin dev resources by default. The app is reached
  // via the cloudflared tunnel host, so the /_next/webpack-hmr WebSocket was
  // blocked — which deadlocks the RSC debug-channel stream and prevents
  // hydrateRoot from ever running (app-wide non-interactivity). Allow the
  // tunnel + localhost dev origins so HMR connects and hydration completes.
  allowedDevOrigins: ["acropolisos.castalia.one", "localhost:3030"],
};

export default nextConfig;
