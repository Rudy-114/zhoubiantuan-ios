import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, makeUser, query, id } from './helpers.js';
import { canReadAsset } from '../../src/assets.js';
import { getCurrentSyncCursor } from '../../src/sync.js';

let api;
before(async () => { api = await startTestApp(); });
after(async () => { await api.close(); });
async function post(user) {
  const postID = id('p');
  await query("INSERT INTO posts(id,author_id,title,description,deadline) VALUES($1,$2,'Reported post','Original content',now()+interval '1 day')", [postID,user.id]);
  return postID;
}
async function submit(user, type, targetID) {
  return api.request('/reports', { method: 'POST', token: user.token, body: { targetType: type, targetID, reason: 'Potential scam', detail: 'Synthetic report for testing' } });
}
async function queue(admin) { return (await api.request('/moderation/reports?status=pending', { token: admin.token }).then(r => r.json())).reports; }
async function decide(admin, report, action = 'remove') {
  return api.request(`/moderation/reports/${report.id}/decision`, { method: 'POST', token: admin.token,
    body: { action, reason: 'Reviewed synthetic evidence', targetVersion: report.currentSnapshot?.version } });
}

test('report creation deduplicates retries and reporter, stranger and moderator see only their permitted data', async () => {
  const owner = await makeUser(), reporter = await makeUser(), stranger = await makeUser(), moderator = await makeUser({role:'moderator'});
  const postID = await post(owner);
  const responses = await Promise.all([1,2].map(() => submit(reporter,'post',postID)));
  assert.deepEqual(responses.map(r => r.status).sort(), [200,201]);
  const saved = (await responses[0].json()).report;
  assert.equal(saved.snapshot, undefined);
  const own = await api.request('/reports', {token:reporter.token}).then(r => r.json());
  assert.equal(own.reports.length, 1); assert.equal(own.reports[0].snapshot, undefined);
  assert.equal((await api.request('/reports', {token:stranger.token}).then(r => r.json())).reports.length, 0);
  assert.equal((await api.request('/moderation/reports', {token:stranger.token})).status,403);
  assert.equal((await api.request(`/moderation/reports/${saved.id}/decision`, {method:'POST',token:stranger.token,body:{action:'remove',reason:'No rights'}})).status,403);
  const adminReport = (await queue(moderator)).find(r => r.id===saved.id);
  assert.match(adminReport.snapshot.text, /Original content/);
  assert.equal(adminReport.currentSnapshot.version,'1');
  assert.equal((await submit(stranger, 'unknown', postID)).status,400);
});

test('moderator decisions are atomic, reject changed evidence and invalidate other readers and the reporter', async () => {
  const owner = await makeUser(), reporter = await makeUser(), reader = await makeUser(), moderator = await makeUser({role:'moderator'});
  const postID = await post(owner), reportID = (await submit(reporter,'post',postID).then(r => r.json())).report.id;
  const stale = (await queue(moderator)).find(r => r.id===reportID);
  await query("UPDATE posts SET description='Updated content',updated_at=now() WHERE id=$1",[postID]);
  assert.equal((await decide(moderator,stale)).status,409);
  assert.equal((await query('SELECT status FROM reports WHERE id=$1',[reportID])).rows[0].status,'pending');
  const fresh = (await queue(moderator)).find(r=>r.id===reportID), cursor = await getCurrentSyncCursor();
  assert.equal((await decide(moderator,fresh)).status,200);
  assert.equal((await decide(moderator,fresh)).status,409);
  assert.equal((await api.request(`/posts/${postID}`,{token:reader.token})).status,404);
  const readerSync = await api.request(`/sync?cursor=${cursor}`,{token:reader.token}).then(r=>r.json());
  assert.ok(readerSync.removedPostIDs.includes(postID));
  const reporterSync = await api.request(`/sync?cursor=${cursor}`,{token:reporter.token}).then(r=>r.json());
  assert.equal(reporterSync.reports.find(r=>r.id===reportID).status,'removed');
  assert.equal(reporterSync.reports.find(r=>r.id===reportID).snapshot,undefined);
  assert.equal((await query('SELECT handled_by FROM reports WHERE id=$1',[reportID])).rows[0].handled_by,moderator.id);
});

test('only participants can report private messages and moderator asset access is scoped to reported evidence', async () => {
  const sender = await makeUser(), receiver = await makeUser(), stranger = await makeUser(), moderator = await makeUser({role:'moderator'});
  const threadID=id('mt'), messageID=id('dm'), key=`guarded/message/${sender.id}/${id()}.jpg`, otherKey=`guarded/message/${sender.id}/${id()}.jpg`;
  await query('INSERT INTO message_threads(id,buyer_user_id,publisher_user_id) VALUES($1,$2,$3)',[threadID,sender.id,receiver.id]);
  await query("INSERT INTO direct_messages(id,thread_id,sender_id,body,image_object_key) VALUES($1,$2,$3,'Reported private text',$4),($5,$2,$3,'Unreported private text',$6)",[messageID,threadID,sender.id,key,id('dm'),otherKey]);
  const adminUser={id:moderator.id,email_verified:true,moderation_role:'moderator'};
  assert.equal(await canReadAsset(key,adminUser),false);
  assert.equal((await submit(stranger,'message',messageID)).status,404);
  const reportID=(await submit(receiver,'message',messageID).then(r=>r.json())).report.id;
  assert.equal(await canReadAsset(key,adminUser),true);
  assert.equal(await canReadAsset(otherKey,adminUser),false);
  assert.equal(await canReadAsset(key,{id:stranger.id}),false);
  const report=(await queue(moderator)).find(r=>r.id===reportID);
  assert.match(report.snapshot.text,/Reported private text/);
  assert.equal((await decide(moderator,report)).status,200);
  const message=(await query('SELECT * FROM direct_messages WHERE id=$1',[messageID])).rows[0];
  assert.ok(message.revoked_at); assert.equal(message.body,''); assert.equal(message.image_object_key,null);
  assert.equal(await canReadAsset(key,{id:receiver.id}),false);
  assert.equal(await canReadAsset(key,adminUser),false);
});

test('comment removal and user suspension take effect on the server, and ordinary users cannot grant themselves a role', async () => {
  const author=await makeUser(),reporter=await makeUser(),moderator=await makeUser({role:'moderator'}), postID=await post(author), commentID=id('cm');
  await query("INSERT INTO comments(id,post_id,author_id,body) VALUES($1,$2,$3,'Reported comment')",[commentID,postID,author.id]);
  const commentReport=(await submit(reporter,'comment',commentID).then(r=>r.json())).report;
  assert.equal((await decide(moderator,(await queue(moderator)).find(r=>r.id===commentReport.id))).status,200);
  assert.equal((await query('SELECT status FROM comments WHERE id=$1',[commentID])).rows[0].status,'removed');
  const userReport=(await submit(reporter,'user',author.id).then(r=>r.json())).report;
  assert.equal((await decide(moderator,(await queue(moderator)).find(r=>r.id===userReport.id),'suspend')).status,200);
  assert.equal((await api.request('/bootstrap',{token:author.token})).status,401);
  assert.equal((await api.request(`/posts/${postID}`)).status,404);
  assert.equal((await api.request('/bootstrap',{token:reporter.token}).then(r=>r.json())).currentUser.moderationRole,'user');
});

test('report pagination is complete and handled reports allow newly edited content to be reported again', async () => {
  const author=await makeUser(),reporter=await makeUser(),moderator=await makeUser({role:'moderator'});
  const ids=await Promise.all([1,2,3].map(()=>post(author)));
  for(const postID of ids) assert.equal((await submit(reporter,'post',postID)).status,201);
  const seen=[]; let cursor;
  do {
    const page=await api.request('/reports?limit=1'+(cursor?'&cursor='+cursor:''),{token:reporter.token}).then(r=>r.json());
    seen.push(...page.reports.map(r=>r.target.id)); cursor=page.nextCursor;
  } while(cursor);
  assert.deepEqual(new Set(seen),new Set(ids)); assert.equal(seen.length,3);
  const report=(await queue(moderator)).find(r=>r.target.id===ids[0]);
  assert.equal((await decide(moderator,report,'ignore')).status,200);
  assert.equal((await submit(reporter,'post',ids[0])).status,200);
  await query("UPDATE posts SET description='Changed after report',updated_at=now() WHERE id=$1",[ids[0]]);
  assert.equal((await submit(reporter,'post',ids[0])).status,201);
});
