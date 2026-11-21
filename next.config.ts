import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The API tests build and start their own copy of the app. A separate
  // directory keeps that build from touching a running `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
