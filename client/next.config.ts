import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

const nextConfig: NextConfig = {
  output: "export",
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default withSentryConfig(withBundleAnalyzer(nextConfig), {
  org: "deckedgg",
  project: "javascript-nextjs",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
  // tracesSampleRate: 0 + replay rates: 0 in our init mean we never *use* this
  // code — these flags tree-shake it out of the client bundle entirely.
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
    excludeReplayWorker: true,
  },
});
