CREATE TABLE feed_events (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  request_id text NOT NULL DEFAULT '',
  event_type text NOT NULL CHECK (event_type IN (
    'impression', 'open', 'dwell', 'complete', 'like', 'favorite',
    'comment', 'follow', 'share', 'notInterested', 'hideAuthor'
  )),
  post_id text REFERENCES posts(id) ON DELETE SET NULL,
  position integer CHECK (position IS NULL OR (position >= 0 AND position <= 10000)),
  dwell_ms integer CHECK (dwell_ms IS NULL OR (dwell_ms >= 0 AND dwell_ms <= 86400000)),
  feed_mode text NOT NULL DEFAULT 'forYou' CHECK (feed_mode IN ('forYou', 'following', 'recent')),
  algorithm_version text NOT NULL DEFAULT '',
  content_revision text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);

CREATE INDEX feed_events_user_created ON feed_events(user_id, created_at DESC, id DESC);
CREATE INDEX feed_events_post_type_created ON feed_events(post_id, event_type, created_at DESC);
CREATE INDEX feed_events_user_type_post ON feed_events(user_id, event_type, post_id, created_at DESC);
