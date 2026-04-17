// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://a493a14a10049f35378a9c35ec04910a@o4511233424883712.ingest.us.sentry.io/4511233427046400",
  tracesSampleRate: 0,
  sendDefaultPii: false,
});
