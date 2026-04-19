// Client-side Sentry init. Deferred to idle time so the Sentry.init() work
// (global handler registration, scope setup, network DSN parsing) doesn't
// block FCP/LCP. The SDK module is still bundled eagerly because Next.js
// imports this file during hydration; deferring the *call* is the win.
//
// Narrow tradeoff: errors thrown in the few ms between hydration and the
// idle callback firing won't be captured. Most real errors happen after
// user interaction, well past that window.

import * as Sentry from "@sentry/nextjs";

function initSentry() {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
    sendDefaultPii: false,
  });
}

if (typeof window !== "undefined") {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === "function") {
    idle(initSentry, { timeout: 3000 });
  } else {
    setTimeout(initSentry, 0);
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
