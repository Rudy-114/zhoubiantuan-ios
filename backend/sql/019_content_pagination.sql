CREATE INDEX posts_public_page ON posts(created_at DESC,id DESC) WHERE status='active';
CREATE INDEX posts_author_page ON posts(author_id,created_at DESC,id DESC);
CREATE INDEX posts_collection_page ON posts(collection_id,created_at DESC,id DESC);
CREATE INDEX collections_owner_page ON group_collections(owner_id,created_at DESC,id DESC);
CREATE INDEX comments_post_page ON comments(post_id,created_at DESC,id DESC);
CREATE INDEX users_page ON users(created_at DESC,id DESC) WHERE status='active' AND deleted_at IS NULL;
