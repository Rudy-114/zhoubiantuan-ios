import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startTestApp,makeUser,query,id} from './helpers.js';
import {getCurrentSyncCursor} from '../../src/sync.js';
let api;
before(async()=>{api=await startTestApp();});
after(async()=>{await api.close();});

async function history(user,threadID) {
  let cursor, messages=[];
  do {
    const response=await api.request(`/messages/threads/${threadID}/messages?limit=50`+(cursor?'&cursor='+cursor:''),{token:user.token});
    assert.equal(response.status,200,await response.clone().text());
    const page=await response.json();messages.push(...page.thread.messages);cursor=page.nextCursor;
    assert.ok(messages.length<2000);
  }while(cursor);
  return messages;
}

test('long histories are complete and read/new/deleted message sync size stays bounded',async()=>{
  const sender=await makeUser(),reader=await makeUser(),stranger=await makeUser(),threadID=id('t'),prefix=id('dm');
  await query('INSERT INTO message_threads(id,buyer_user_id,publisher_user_id) VALUES($1,$2,$3)',[threadID,sender.id,reader.id]);
  await query(`INSERT INTO direct_messages(id,thread_id,sender_id,body,created_at)
    SELECT $1||'-'||n,$2,$3,'History '||n,'2026-01-01'::timestamptz+n*interval '0.000001 second' FROM generate_series(1,615) n`,[prefix,threadID,sender.id]);
  const all=await history(reader,threadID);assert.equal(all.length,615);assert.equal(new Set(all.map(m=>m.id)).size,615);
  assert.equal((await api.request(`/messages/threads/${threadID}/messages`,{token:stranger.token})).status,404);
  const bootstrap=await api.request('/bootstrap',{token:reader.token}).then(r=>r.json());
  assert.equal(bootstrap.messageThreads.find(t=>t.id===threadID).messages.length,1);
  let cursor=await getCurrentSyncCursor();
  assert.equal((await api.request(`/messages/threads/${threadID}/read`,{method:'POST',token:reader.token})).status,204);
  let sync=await api.request('/sync?cursor='+cursor,{token:reader.token}).then(r=>r.json());
  assert.equal(sync.messageThreads.find(t=>t.id===threadID).messages.length,0);
  assert.equal(sync.messageThreads.find(t=>t.id===threadID).unreadCount,0);
  assert.ok(JSON.stringify(sync).length<15000);
  cursor=await getCurrentSyncCursor();
  assert.equal((await api.request(`/messages/threads/${threadID}/messages/${prefix}-1`,{method:'DELETE',token:reader.token})).status,200);
  sync=await api.request('/sync?cursor='+cursor,{token:reader.token}).then(r=>r.json());
  const deletion=sync.messageThreads.find(t=>t.id===threadID).messages;
  assert.equal(deletion.length,1);assert.equal(deletion[0].id,prefix+'-1');assert.equal(deletion[0].body,'');assert.equal(deletion[0].isDeletedForMe,true);assert.equal(deletion[0].revision,2);
  const senderHistory=await history(sender,threadID);assert.equal(senderHistory.find(m=>m.id===prefix+'-1').body,'History 1');
  await query('INSERT INTO follows(follower_id,following_id) VALUES($1,$2)',[reader.id,sender.id]);
  cursor=await getCurrentSyncCursor();
  const sent=await api.request(`/messages/threads/${threadID}/messages`,{method:'POST',token:sender.token,body:{messageID:id('m'),recipientUserID:reader.id,body:'One new message'}});
  assert.equal(sent.status,201,await sent.clone().text());
  assert.equal((await sent.json()).thread.messages.length,1);
  sync=await api.request('/sync?cursor='+cursor,{token:reader.token}).then(r=>r.json());
  assert.equal(sync.messageThreads.find(t=>t.id===threadID).messages.length,1);
  assert.equal(sync.messageThreads.find(t=>t.id===threadID).messages[0].body,'One new message');
  const removedPost=id('p');
  await query("INSERT INTO posts(id,author_id,title,deadline,status) VALUES($1,$2,'Old listing',now(),'deleted')",[removedPost,sender.id]);
  await query('UPDATE message_threads SET related_post_id=$2 WHERE id=$1',[threadID,removedPost]);
  const continuation=await api.request(`/messages/threads/${threadID}/messages`,{method:'POST',token:sender.token,body:{messageID:id('m'),recipientUserID:reader.id,relatedPostID:removedPost,body:'Continue existing chat'}});
  assert.equal(continuation.status,201);
  assert.equal((await api.request(`/messages/threads/${id('t')}/messages`,{method:'POST',token:sender.token,body:{messageID:id('m'),recipientUserID:stranger.id,sharedPostID:removedPost,body:'Invalid share'}})).status,400);
});

test('more than one hundred conversations are paged per account and each preview belongs to its own thread',async()=>{
  const owner=await makeUser(),prefix=id('peer'),threadPrefix=id('mt');
  await query("INSERT INTO users(id,nickname) SELECT $1||'-'||n,'Peer '||n FROM generate_series(1,115) n",[prefix]);
  await query(`INSERT INTO message_threads(id,buyer_user_id,publisher_user_id,updated_at)
    SELECT $1||'-'||n,$2,$3||'-'||n,now()-n*interval '1 second' FROM generate_series(1,115) n`,[threadPrefix,owner.id,prefix]);
  await query(`INSERT INTO direct_messages(id,thread_id,sender_id,body)
    SELECT $1||'-dm-'||n,$1||'-'||n,$2||'-'||n,'Preview '||n FROM generate_series(1,115) n`,[threadPrefix,prefix]);
  const threads=[];let cursor;
  do {
    const response=await api.request('/messages/threads?limit=25'+(cursor?'&cursor='+cursor:''),{token:owner.token});
    assert.equal(response.status,200,await response.clone().text());
    const page=await response.json();threads.push(...page.messageThreads);cursor=page.nextCursor;
    assert.equal(page.unreadMessageCount,115);
    assert.ok(page.users.some(u=>u.id===owner.id));assert.ok(threads.length<200);
  }while(cursor);
  assert.equal(threads.length,115);assert.equal(new Set(threads.map(t=>t.id)).size,115);
  for(const thread of threads) {
    assert.equal(thread.messages.length,1);
    assert.equal(thread.messages[0].senderID,thread.publisherUserID);
    assert.equal(thread.messages[0].body,'Preview '+thread.id.split('-').at(-1));
  }
});
