// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://a493a14a10049f35378a9c35ec04910a@o4511233424883712.ingest.us.sentry.io/4511233427046400",
  tracesSampleRate: 0,
  sendDefaultPii: false,
});
