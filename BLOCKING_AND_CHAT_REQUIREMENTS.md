# Blocking And Chat Requirements

Date: 2026-07-07

## Purpose

This document turns Rudy's product decisions about blocking, profile visibility, private messages, and chat timestamps into implementation instructions for Claude Code or another engineering agent.

Do not treat this as a request to rewrite the whole app. The expected follow-up is a focused patch against the existing SwiftUI app.

## Current Context

- App path: `/Users/rudy2009/Documents/欧美团app`
- Relevant files observed during discussion:
  - `ZhouBianTuan/MessageViews.swift`
  - `ZhouBianTuan/MockAppStore.swift`
  - `ZhouBianTuan/ProfileViews.swift`
  - `ZhouBianTuan/SearchViews.swift`
  - `ZhouBianTuan/SettingsViews.swift`
  - `ZhouBianTuan/ZhouBianTuanApp.swift`
- Root route registration already exists in `ZhouBianTuanApp.swift` via `navigationDestination(for: Route.self)`, including `.userProfile`.
- Current worktree has uncommitted changes from prior fixes. Review the diff before making more edits.

## Latest Override From Rudy

Rudy later updated the blocking semantics. These rules override older notes in this document:

- When A blocks B, the backend and app should remove both follow edges: A -> B and B -> A.
- Unblocking does not restore either follow edge.
- If users want to follow again after unblock, they must follow manually.
- Block-related send failures take priority over the "unfollowed peer can receive at most two messages" rule.
- Local failed block messages are visible only to the sender, are not uploaded as successful cloud messages, and do not count toward the two-message limit.

## Confirmed Product Decisions

### 1. Chat Avatar Navigation

Claude's concern is accepted: if `NavigationLink(value: Route.userProfile(...))` works inside `ChatView`, prefer value navigation over the current `Button + navigationDestination(isPresented:)` workaround.

Implementation guidance:

- First verify whether value navigation works from:
  - chat header avatar/name
  - incoming message avatar
  - outgoing self avatar, if it remains tappable
- If it works, revert these avatar/profile entry points back to `NavigationLink(value:)`.
- If it does not work, document the exact failure symptom before keeping a local state-driven workaround.
- Avoid forced or duplicate profile presentation behavior.

Rationale:

- The root `NavigationStack` already owns `Route` destinations.
- Value navigation is simpler and should reduce accidental presentation bugs.

### 2. Following And Follower Lists After Blocking

When the current user blocks another user:

- Automatically remove the current user's follow relationship to the blocked user.
- Automatically remove the blocked user's follow relationship to the current user.
- Hide the blocked user from the current user's visible "following" list.
- Hide the blocked user from the current user's visible "followers" list.
- Counts should reflect the real relationship graph after both follow edges are removed.

Important nuance:

- Display lists and numeric relationship counts are not the same thing.
- A blocked user is hidden from relation lists and should no longer remain counted as a follower when the block action removed that follow edge.

Unblock entry:

- Since blocked users are hidden from ordinary relation lists, "Settings -> Account & Security -> Blocked Users" remains the primary unblock entry.

### 3. Bidirectional Visibility

Blocking should be a two-way visibility restriction for ordinary user content.

If user A blocks user B:

- A should not see B's ordinary posts/content.
- B should not see A's ordinary posts/content.
- B should not be able to effectively send messages to A.
- Existing private message history must remain available to preserve conversation evidence.

This likely requires backend support.

Frontend-only logic can reliably know "users I blocked" from local state. It cannot reliably know "users who blocked me" unless the backend provides that state or returns a clear error when an action is rejected.

Claude should evaluate whether the backend already exposes:

- `blockedUserIDs`: users I blocked.
- `blockedByUserIDs`: users who blocked me.
- a send-message error code that means "recipient has blocked current user".

If missing, propose backend/API changes instead of pretending the frontend can infer it.

### 4. Private Message History And Failed Sends

Existing private message threads should be retained even when one side blocks the other.

Expected chat behavior:

- Users can still enter existing chat threads after blocking.
- Historical messages remain visible.
- The message input remains visible.
- Sending is intercepted when blocking prevents delivery.
- The app should create a local-only failed message bubble on the sender side, similar to WeChat.
- The failed message must not be delivered to the other user.
- The failed message must not be uploaded as a normal successful cloud message.
- The failed message persists locally after leaving and reopening the chat.
- After the blocking condition is resolved, the user can tap the red failure indicator/failure area to retry.
- On retry success, do not leave duplicate content in the chat. Either convert the failed local message to a normal sent message, or replace it with the successful message.

Failure UI:

- Show a red exclamation mark near the failed bubble.
- Show small text below the bubble explaining why sending failed.

Failure reason priority:

1. If the other user has blocked me, show:
   - `你已被对方拉黑，无法发送消息`
2. Else if I blocked the other user, show:
   - `你已拉黑对方，解除拉黑后才能发送`
3. If both are true, the other-user-blocked-me message has priority:
   - `你已被对方拉黑，无法发送消息`

Implementation note:

- The current app likely needs a local message delivery status model, for example `sending`, `sent`, `failedBlockedByPeer`, `failedBlockedPeer`.
- Avoid representing these failed messages as ordinary successful messages.

### 5. Blocked User Profile Behavior

If I have blocked a user and I open that user's profile:

- The profile can still open.
- Basic profile information remains visible:
  - avatar
  - nickname
  - basic bio/header information
- Ordinary post content is hidden.
- The empty state should say something like:
  - `对方还没发过任何帖子`
- The "send private message" button should not be disabled.
- Tapping "send private message" should open the chat thread.
- Actual sending inside the chat should fail using the local failed-message behavior described above.
- The block button should show:
  - `已拉黑 · 点击解除`
- Unblocking must require a confirmation alert with `确认` / `取消`, same spirit as the block confirmation.
- The follow button should be disabled while the user is blocked, because blocked users cannot be followed.

### 6. Other User Empty Profile Copy

For another user's profile when visible posts are empty:

- Do not show the current-user publishing CTA.
- Use other-user copy, such as:
  - `他还没有发布过任何作品`

For a blocked user's profile, use the blocked-profile empty copy instead:

- `对方还没发过任何帖子`

This distinction matters:

- "He has not posted" is a neutral empty profile state.
- "The other party has no visible posts" while blocked should not leak whether hidden posts exist.

### 7. Admin And Moderator Views

Current product decision:

- Normal users register inside the iOS app.
- Future admins/moderators should be independent accounts in a separate backend/admin surface.
- This round does not need to design or implement that independent admin backend.

Implementation guidance for the current iOS app:

- Ordinary user views should apply blocking visibility rules.
- Future admin/moderator backend views must use raw, unfiltered data that is not affected by a normal user's personal block list.
- Existing in-app admin/moderation development screens do not need a broad rewrite in this round.
- Claude should flag any current query where applying `post(id:)` or other user-filtered helpers could accidentally hide moderation/report data.

### 8. Chat Time Separators

Remove hardcoded chat timestamps such as `05-03 23:26` and `05-04 15:36`.

Use real `DirectMessage.createdAt` values.

Display rules:

- Show a time separator before the first visible message.
- Show another separator when the gap from the previous visible message is more than 5 minutes.
- If the message is from today, show only time:
  - `HH:mm`
  - example: `12:27`
- If the message is not from today but is in the current year, show date plus time:
  - `MM-dd HH:mm`
  - example: `07-08 09:12`
- If the message is from a different year, show year, date, and time:
  - `yyyy-MM-dd HH:mm`
  - example: `2027-01-02 09:12`

## Suggested Implementation Order

1. Review current uncommitted diff and decide whether to keep or revert the chat avatar navigation workaround.
2. Model blocking visibility without destructively deleting posts, comments, or message threads.
3. Add or adjust relation-list filtering separately from follower/following counts.
4. Preserve blocked private message threads and implement local failed-message status.
5. Add retry behavior for failed blocked-send messages.
6. Update blocked profile button states and confirmation alerts.
7. Replace hardcoded chat timestamps with real separators.
8. Re-run simulator build and manually verify the key flows.

## Acceptance Criteria

- Tapping chat avatars opens the correct profile without duplicate/forced presentations.
- Blocking a user hides ordinary content in feeds/search/profile from ordinary views.
- Unblocking restores visibility without requiring reinstalling the app.
- Blocking removes the blocked user from visible following/follower lists and removes both underlying follow edges.
- Settings blocked-user page remains an unblock path.
- Blocked profile still opens and allows entering chat, but not following.
- Sending while blocked creates a persistent failed local message with red exclamation UI and correct reason text.
- Failed blocked-send messages can be retried after unblock without duplicate messages.
- Existing chat history remains visible as evidence.
- Admin/moderation review paths are not silently broken by ordinary-user block filters.
- Chat timestamps are generated from real message dates using the agreed display rules.
- Debug/local fallback behavior does not leak into Release-only backend semantics.

## Open Technical Questions For Claude

- Does `NavigationLink(value: Route.userProfile(...))` currently work in `ChatView` under the app's root `NavigationStack`?
- Does the backend expose "users who blocked me", or only "users I blocked"?
- Does the send-message backend endpoint return a distinct block-related error code?
- Where should local failed-message state be persisted so it survives app restart without syncing as a successful message?
- Should failed local messages be included in `persistThreads()` as a new status field, and how should older persisted messages migrate?
- Which current admin/moderation screens use user-filtered helpers and need future raw-query alternatives?

## Verification Plan

Run from project root:

```sh
git diff --check
xcodebuild -project ZhouBianTuan.xcodeproj \
  -scheme ZhouBianTuan \
  -configuration Debug \
  -destination 'id=4A818C18-C716-4104-A797-D2A0D5C422F9' \
  build CODE_SIGNING_ALLOWED=NO
```

Manual simulator checks:

- Existing chat -> tap peer avatar -> profile opens and back navigation works.
- User A blocks user B -> B disappears from A's visible lists/feed/search/profile content.
- A opens B profile from blocked users/history -> basic profile visible, posts hidden, send private message opens chat.
- A tries to message B while A blocked B -> failed local bubble with `你已拉黑对方，解除拉黑后才能发送`.
- If backend can simulate B blocking A -> A sends to B -> failed local bubble with `你已被对方拉黑，无法发送消息`.
- Unblock -> retry failed message -> successful single message, no duplicate.
- Chat timeline displays real date separators rather than hardcoded dates.
