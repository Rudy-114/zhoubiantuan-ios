import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, makeUser, query, id } from "./helpers.js";

let api;

before(async () => { api = await startTestApp(); });
after(async () => { await api.close(); });

test("authenticated home Feed promotes followed authors and following mode filters", async () => {
  const viewer = await makeUser();
  const followed = await makeUser();
  const stranger = await makeUser();
  const followedPost = id("p-followed");
  const strangerPost = id("p-stranger");
  await query("INSERT INTO follows(follower_id,following_id) VALUES($1,$2)", [viewer.id, followed.id]);
  await query(`INSERT INTO posts(id,author_id,title,deadline,created_at,category_tags,fandom_tags)
    VALUES($1,$2,'Followed post',now()+interval '2 days',now()-interval '2 days',ARRAY['badge'],ARRAY['anime']),
           ($3,$4,'Stranger post',now()+interval '2 days',now(),ARRAY['other'],ARRAY['other'])`,
    [followedPost, followed.id, strangerPost, stranger.id]);

  const personalized = await api.request("/feed?limit=10", { token: viewer.token });
  assert.equal(personalized.status, 200, await personalized.clone().text());
  const personalizedBody = await personalized.json();
  assert.equal(personalizedBody.feed.mode, "forYou");
  assert.equal(personalizedBody.feed.algorithmVersion, "rules-v2");
  assert.equal(personalizedBody.feed.personalized, true);
  const followedIndex = personalizedBody.posts.findIndex(post => post.id === followedPost);
  const strangerIndex = personalizedBody.posts.findIndex(post => post.id === strangerPost);
  assert.ok(followedIndex >= 0 && strangerIndex >= 0 && followedIndex < strangerIndex);

  const following = await api.request("/feed?feedMode=following&limit=10", { token: viewer.token });
  assert.equal(following.status, 200, await following.clone().text());
  const followingBody = await following.json();
  assert.deepEqual(followingBody.posts.map(post => post.authorID), [followed.id]);
});

test("pull refresh creates a new exploratory order while pagination stays on its seed", async () => {
  const viewer = await makeUser();
  const author = await makeUser();
  const postIDs = Array.from({ length: 40 }, () => id("p-refresh"));
  await query(`INSERT INTO posts(id,author_id,title,deadline,created_at,category_tags,fandom_tags)
    SELECT value,$2,'Refresh candidate',now()+interval '2 days',now(),ARRAY['same'],ARRAY['same']
    FROM unnest($1::text[]) AS value`, [postIDs, author.id]);

  const request = seed => api.request(`/feed?limit=10&refreshSeed=${seed}`, { token: viewer.token });
  const first = await request("seed-a").then(async response => {
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  });
  const refreshed = await request("seed-b").then(async response => {
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  });
  assert.notDeepEqual(first.posts.map(post => post.id), refreshed.posts.map(post => post.id));

  const next = await api.request(`/feed?limit=10&refreshSeed=seed-a&cursor=${encodeURIComponent(first.nextCursor)}`, { token: viewer.token });
  assert.equal(next.status, 200, await next.clone().text());
  const mismatched = await api.request(`/feed?limit=10&refreshSeed=seed-b&cursor=${encodeURIComponent(first.nextCursor)}`, { token: viewer.token });
  assert.equal(mismatched.status, 400, await mismatched.clone().text());
});

test("Feed events accept batches, ignore invisible posts and deduplicate retries", async () => {
  const viewer = await makeUser();
  const author = await makeUser();
  const postID = id("p-event");
  await query("INSERT INTO posts(id,author_id,title,deadline) VALUES($1,$2,'Event post',now()+interval '2 days')", [postID, author.id]);
  const response = await api.request("/feed/events", {
    token: viewer.token,
    method: "POST",
    body: { events: [
      { eventID: "evt-1", eventType: "impression", postID, position: 0, feedMode: "forYou", algorithmVersion: "rules-v2" },
      { eventID: "evt-1", eventType: "impression", postID, position: 0, feedMode: "forYou", algorithmVersion: "rules-v2" },
      { eventID: "evt-hidden", eventType: "open", postID: "missing-post", feedMode: "forYou" }
    ] }
  });
  assert.equal(response.status, 202, await response.clone().text());
  assert.deepEqual(await response.json(), { accepted: 1, ignored: 1, duplicate: 1 });
  const saved = await query("SELECT event_id,event_type,post_id FROM feed_events WHERE user_id=$1", [viewer.id]);
  assert.deepEqual(saved.rows, [{ event_id: "evt-1", event_type: "impression", post_id: postID }]);
  const missingTarget = await api.request("/feed/events", {
    token: viewer.token, method: "POST", body: { events: [{ eventID: "evt-no-target", eventType: "notInterested" }] }
  });
  assert.equal(missingTarget.status, 400);
  const staleEvent = await api.request("/feed/events", {
    token: viewer.token, method: "POST", body: { events: [{ eventID: "evt-stale", eventType: "open", postID, occurredAt: "2020-01-01T00:00:00.000Z" }] }
  });
  assert.equal(staleEvent.status, 400);
});

test("personalized cursors read the frozen snapshot and recheck visibility", async () => {
  const viewer = await makeUser();
  const author = await makeUser();
  const postIDs = Array.from({ length: 7 }, () => id("p-snapshot"));
  await query(`INSERT INTO posts(id,author_id,title,deadline,created_at)
    SELECT value,$2,'Snapshot post',now()+interval '2 days',now()-((row_number() over ())::int * interval '1 minute')
    FROM unnest($1::text[]) AS value`, [postIDs, author.id]);
  const first = await api.request("/feed?limit=3", { token: viewer.token }).then(async response => {
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  });
  assert.equal(first.posts.length, 3);
  await query("UPDATE posts SET status='removed' WHERE id=$1", [first.posts[1].id]);
  const secondResponse = await api.request(`/feed?limit=3&cursor=${encodeURIComponent(first.nextCursor)}`, { token: viewer.token });
  assert.equal(secondResponse.status, 200, await secondResponse.clone().text());
  const second = await secondResponse.json();
  assert.ok(!second.posts.some(post => post.id === first.posts[1].id));
  assert.equal(new Set([...first.posts, ...second.posts].map(post => post.id)).size, first.posts.length + second.posts.length);
});
