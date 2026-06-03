ALTER TABLE posts
ADD COLUMN IF NOT EXISTS preview_image_object_keys text[] NOT NULL DEFAULT ARRAY[]::text[];
