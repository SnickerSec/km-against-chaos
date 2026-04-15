import * as Sentry from "@sentry/node";

// Must be imported before any other module that might throw.
// No-op when SENTRY_DSN is not set (local dev, CI, etc.)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.RAILWAY_GIT_COMMIT_SHA,
    // Error tracking only — performance is noisier and costs quota.
    tracesSampleRate: 0,
    // Don't capture PII from request bodies (we manually JSON.parse anyway
    // and bodies can contain auth tokens / game state)
    sendDefaultPii: false,
  });
}

export { Sentry };
