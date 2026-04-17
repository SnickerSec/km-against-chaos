// Object storage abstraction. Writes to Cloudflare R2 when R2_* env vars are
// set; falls back to the local ./uploads directory otherwise (for tests and
// single-replica dev where Railway's persistent volume is fine).
//
// The goal of this module is to let every upload call site say
//     await storage.putObject("card-backs/abc.png", buf, "image/png")
//     storage.urlFor("card-backs/abc.png")
// without caring whether prod is on R2 or not. When we later remove the
// Railway volume to unblock numReplicas > 1, only this file's behaviour
// needs to change (and it already has, via the env-var fallback).

import { S3Client, PutObjectCommand, HeadObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { createLogger } from "./logger.js";

const log = createLogger("storage");

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const useR2 = !!(R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ENDPOINT && R2_BUCKET && R2_PUBLIC_URL);

let s3: S3Client | null = null;
if (useR2) {
  s3 = new S3Client({
    region: "auto", // R2 ignores region but the SDK insists
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID!,
      secretAccessKey: R2_SECRET_ACCESS_KEY!,
    },
  });
  log.info("r2 storage enabled", { endpoint: R2_ENDPOINT, bucket: R2_BUCKET });
}

// Local fallback — same layout the service has been using all along.
const LOCAL_DIR = process.env.UPLOAD_DIR || join(process.cwd(), "uploads");

/**
 * Store an object at `key` (e.g. "card-backs/abc.png"). Returns the public
 * URL clients should use to fetch it.
 */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  if (s3 && R2_BUCKET && R2_PUBLIC_URL) {
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Browsers cache for an hour — card backs change infrequently but the
      // URL includes a version param from the caller if they need to bust.
      CacheControl: "public, max-age=3600",
    }));
    return `${R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  }

  // Local disk fallback.
  const fullPath = join(LOCAL_DIR, key);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, body);
  return `/uploads/${key}`;
}

/**
 * Build the public URL for a given key without performing any I/O.
 * Useful for constructing URLs ahead of time.
 */
export function urlFor(key: string): string {
  if (useR2 && R2_PUBLIC_URL) {
    return `${R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  }
  return `/uploads/${key}`;
}

export function isUsingR2(): boolean {
  return useR2;
}

/**
 * Cheap existence check, used by cache-on-write call sites like TTS.
 * Returns true if the object is present.
 */
export async function hasObject(key: string): Promise<boolean> {
  if (s3 && R2_BUCKET) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      return true;
    } catch (err) {
      if (err instanceof S3ServiceException && (err.$metadata?.httpStatusCode === 404 || err.name === "NotFound")) {
        return false;
      }
      // Unknown error — treat as "unsure" and return false so the caller
      // regenerates. Cheaper than failing the user's request.
      log.error("hasObject error", { key, error: String(err) });
      return false;
    }
  }
  return existsSync(join(LOCAL_DIR, key));
}
