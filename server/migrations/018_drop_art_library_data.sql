-- Drop the art_library.data bytea column. Followup to migration 017; every
-- row now has an r2_key pointing at the Cloudflare R2 object. /image/:id
-- redirects to R2 and /thumb/:id fetches from R2 before resizing, so the
-- bytea is no longer referenced.
ALTER TABLE art_library DROP COLUMN IF EXISTS data;
