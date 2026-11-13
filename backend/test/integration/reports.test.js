import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startTestApp, makeUser, query, withTransaction, id } from './helpers.js';
import { canReadAsset } from '../../src/assets.js';
import { getCurrentSyncCursor, loadSyncPayload } from '../../src/sync.js';
import { applySafetyAction } from '../../src/safety/actionService.js';
import { assetCapability, assetCapabilityReader } from '../../src/assetCapability.js';
import { userForToken } from '../../src/auth.js';
import { config } from '../../src/config.js';

let api;
before(async () => {
  config.safety.enabled = true;
  config.safety.reportBurstMaxMinute = 100;
  config.safety.reportAccountMax24h = 100;
  config.safety.reportIpMax24h = 500;
  api = await startTestApp();
});
after(async () => { await api.close(); });
async function post(user) {
  const postID=id('p');
  await query("INSERT INTO posts(id,author_id,title,description,deadline) VALUES($1,$2,'Reported post','Original content',now()+interval '1 day')",[postID,user.id]);
  return postID;
}
async function submit(user,type,sourceID,clientRequestID=id('request')) {
  return api.request('/reports',{method:'POST',token:user.token,body:{clientRequestID,sourceType:type,sourceID,reasonCode:'other',reportedField:'content',detail:'Synthetic report for testing'}});
}

test('canonical case reports deduplicate retries, preserve evidence, and expose only the reporter own public status',async()=>{
  const owner=await makeUser(), reporter=await makeUser(), stranger=await makeUser();
  const postID=await post(owner), requestID=id('request');
  const results=await Promise.all([submit(reporter,'post',postID,requestID),submit(reporter,'post',postID,requestID)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
  const saved=(await results[0].json()).report;
  assert.ok(saved.caseID);assert.equal(saved.status,'received');assert.equal(saved.snapshot,undefined);
  const own=await api.request('/me/reports',{token:reporter.token}).then(r=>r.json());
  assert.equal(own.reports.length,1);assert.equal(own.reports[0].id,saved.id);
  assert.equal((await api.request('/me/reports',{token:stranger.token}).then(r=>r.json())).reports.length,0);
  assert.equal((await api.request('/moderation/reports',{token:stranger.token})).status,404);
  assert.equal((await query('SELECT count(*)::int AS n FROM safety_evidence WHERE case_id=$1',[saved.caseID])).rows[0].n,1);
});

test('a case action invalidates public readers and immediately revokes image visibility',async()=>{
  const owner=await makeUser(), reporter=await makeUser(), reader=await makeUser();
  const postID=await post(owner),key=`post/${owner.id}/public.jpg`;
  await query('UPDATE posts SET image_object_keys=ARRAY[$2]::text[] WHERE id=$1',[postID,key]);
  const report=(await submit(reporter,'post',postID).then(r=>r.json())).report;
  assert.equal(await canReadAsset(key,null),true);
  const cursor=await getCurrentSyncCursor();
  const result=await withTransaction(client=>applySafetyAction(client,{caseId:report.caseID,idempotencyKey:id('action'),actionType:'hide_post',targetType:'post',targetId:postID,actorType:'admin',actorId:'synthetic-admin',reason:'Verified synthetic evidence'}));
  assert.ok(result.syncEvents.every(e=>e.id));
  const sync=await loadSyncPayload(reader.id,{cursor});assert.equal(sync.contentRefreshRequired,true);
  assert.equal(await canReadAsset(key,null),false);
  assert.equal((await api.request(`/posts/${postID}`,{token:reader.token})).status,404);
});

test('private messages require participation and legacy image capabilities remain scoped and revocable',async()=>{
  const sender=await makeUser(),recipient=await makeUser(),stranger=await makeUser();
  const thread=id('t'),message=id('m'),key=`message/${sender.id}/private.jpg`;
  await query('INSERT INTO message_threads(id,buyer_user_id,publisher_user_id) VALUES($1,$2,$3)',[thread,recipient.id,sender.id]);
  await query("INSERT INTO direct_messages(id,thread_id,sender_id,body,image_object_key) VALUES($1,$2,$3,'Private synthetic message',$4)",[message,thread,sender.id,key]);
  assert.equal((await submit(stranger,'direct_message',message)).status,403);
  const report=(await submit(recipient,'direct_message',message).then(r=>r.json())).report;
  assert.ok(report.caseID);assert.equal(await canReadAsset(key,stranger),false);
  const cap=assetCapability(key,recipient.id),viewer=await assetCapabilityReader(key,cap);
  assert.equal(viewer.id,recipient.id);assert.equal(await canReadAsset(key,viewer),true);
  assert.equal(await assetCapabilityReader(key+'other',cap),null);
  await assert.rejects(userForToken(cap));
  const cursor=await getCurrentSyncCursor();
  await withTransaction(client=>applySafetyAction(client,{caseId:report.caseID,idempotencyKey:id('action'),actionType:'hide_message',targetType:'direct_message',targetId:message,actorType:'admin',actorId:'synthetic-admin',reason:'Private evidence checked'}));
  assert.equal(await canReadAsset(key,viewer),false);
  const sync=await loadSyncPayload(recipient.id,{cursor});
  assert.equal(sync.messageThreads[0].messages[0].isSafetyHidden,true);
  assert.equal(sync.messageThreads[0].messages[0].body,'');
});

test('report pagination preserves all rows with identical timestamps',async()=>{
  const owner=await makeUser(),reporter=await makeUser();
  for(let i=0;i<6;i++)assert.equal((await submit(reporter,'post',await post(owner))).status,201);
  await query("UPDATE reports SET created_at='2026-09-12T00:00:00Z' WHERE reporter_id=$1",[reporter.id]);
  const ids=[],cursors=new Set();let cursor;
  do{const page=await api.request('/me/reports?limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{token:reporter.token}).then(r=>r.json());
    ids.push(...page.reports.map(r=>r.id));cursor=page.nextCursor;
    if(cursor){assert.equal(cursors.has(cursor),false);cursors.add(cursor);}
  }while(cursor);
  assert.equal(ids.length,6);assert.equal(new Set(ids).size,6);
});
