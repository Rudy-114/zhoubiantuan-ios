-- Stable keyset pagination for the moderation queue. The id tie-breaker keeps
-- rows with identical created_at values from moving between pages.
CREATE INDEX IF NOT EXISTS moderation_reviews_status_page
  ON moderation_reviews(status, created_at DESC, id DESC);
