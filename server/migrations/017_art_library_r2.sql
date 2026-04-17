-- Move AI-generated card art out of Postgres bytea and into Cloudflare R2.
-- r2_key holds the object key (e.g. "art/abc.png") once the image has been
-- uploaded to R2. /api/art-library/image/:id redirects to the R2 URL when
-- r2_key is set; otherwise it falls back to streaming the bytea.
--
-- The bytea `data` column is kept for rollback safety for now. A follow-up
-- migration will drop it once we're confident in the R2 path.

ALTER TABLE art_library ADD COLUMN IF NOT EXISTS r2_key TEXT;
