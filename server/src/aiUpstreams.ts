import type { RequestMiddleware } from "@fal-ai/serverless-client";

// Base URLs for AI vendors. On Railway these point at keyproxy, and
// DEEPSEEK_API_KEY / ELEVENLABS_API_KEY / FAL_KEY hold scoped proxy tokens
// rather than the real vendor keys. Unset, they default to the vendors.
export const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
export const ELEVENLABS_BASE_URL = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
const FAL_PROXY_URL = process.env.FAL_PROXY_URL;

// fal's own proxyUrl option is a no-op outside the browser, so server-side
// requests are routed through keyproxy with a request middleware instead.
const falProxyMiddleware: RequestMiddleware = async (req) => ({
  ...req,
  url: FAL_PROXY_URL!,
  headers: { ...(req.headers || {}), "x-fal-target-url": req.url },
});

export function falConfig() {
  return {
    credentials: process.env.FAL_KEY,
    ...(FAL_PROXY_URL ? { requestMiddleware: falProxyMiddleware } : {}),
  };
}

// fetch() an authenticated fal REST URL, directly or via keyproxy.
export function falFetch(url: string, init: RequestInit = {}) {
  const headers = { ...(init.headers as Record<string, string>), Authorization: `Key ${process.env.FAL_KEY}` };
  if (!FAL_PROXY_URL) return fetch(url, { ...init, headers });
  return fetch(FAL_PROXY_URL, { ...init, headers: { ...headers, "x-fal-target-url": url } });
}
