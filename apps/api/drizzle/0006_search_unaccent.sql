-- Search ignores accents (#88, decision 0026): "limon" finds "Limón". `unaccent` is one of
-- Postgres's own extensions, available on Render and in the postgres Docker image, and trusted,
-- so the database's owner can create it. Written by hand: Drizzle's schema can't express an
-- extension.
CREATE EXTENSION IF NOT EXISTS unaccent;
