import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startTestApp,makeUser,query,id} from './helpers.js';
let api;
before(async()=>{api=await startTestApp();});
after(async()=>{await api.close();});
async function collect(path,token,key) {
  let cursor,items=[];
  do {
    const response=await api.request(path+(path.includes('?')?'&':'?')+'limit=30'+(cursor?'&cursor='+cursor:''),{token});
    assert.equal(response.status,200,await response.clone().text());
    const page=await response.json();items.push(...page[key]);cursor=page.nextCursor;
    assert.ok(items.length<2000,'pagination must advance');
  }while(cursor);
  return items;
}

test('old favorites and author/search results survive the bootstrap cutoff and cursor ties have no gaps',async()=>{
  const author=await makeUser(),reader=await makeUser(),prefix=id('p'),phrase=id('needle'),collectionID=id('col');
  await query("INSERT INTO group_collections(id,owner_id,name,deadline) VALUES($1,$2,'Paged collection',now()+interval '1 day')",[collectionID,author.id]);
  await query(`INSERT INTO posts(id,author_id,collection_id,title,deadline,created_at)
    SELECT $1||'-'||n,$2,$3,$4,now()+interval '1 day','2026-01-01'::timestamptz + (n/3)*interval '0.000001 second' FROM generate_series(1,215) n`,[prefix,author.id,collectionID,phrase]);
  const oldest=prefix+'-1';
  await query('INSERT INTO post_favorites(user_id,post_id) VALUES($1,$2)',[reader.id,oldest]);
  const favorites=await collect('/feed?favorites=true',reader.token,'posts');
  assert.ok(favorites.some(p=>p.id===oldest));
  const own=await collect('/feed?authorID='+author.id,reader.token,'posts');
  assert.equal(own.length,215);assert.equal(new Set(own.map(p=>p.id)).size,215);
  const searched=await collect('/feed?q='+phrase,reader.token,'posts');
  assert.equal(searched.length,215);
  const collectionPosts=await collect('/feed?collectionID='+collectionID,reader.token,'posts');
  assert.equal(collectionPosts.length,215);
  const detail=await api.request('/posts/'+oldest,{token:reader.token}).then(r=>r.json());
  assert.ok(detail.users.some(u=>u.id===author.id));assert.ok(detail.collections.some(c=>c.id===collectionID));
  await query('INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2)',[reader.id,author.id]);
  assert.equal((await collect('/feed?favorites=true',reader.token,'posts')).length,0);
  assert.equal((await api.request('/posts/'+oldest,{token:reader.token})).status,404);
});

test('all comments are paged per post and include authors without leaking hidden rows',async()=>{
  const author=await makeUser(),reader=await makeUser(),postID=id('p'),prefix=id('cm');
  await query("INSERT INTO posts(id,author_id,title,deadline) VALUES($1,$2,'Comment pages',now()+interval '1 day')",[postID,author.id]);
  await query(`INSERT INTO comments(id,post_id,author_id,body,created_at)
    SELECT $1||'-'||n,$2,$3,'Comment '||n,'2026-01-01'::timestamptz + n*interval '0.000001 second' FROM generate_series(1,515) n`,[prefix,postID,author.id]);
  const comments=await collect('/posts/'+postID+'/comments',reader.token,'comments');
  assert.equal(comments.length,515);assert.equal(new Set(comments.map(c=>c.id)).size,515);
  const detail=await api.request('/posts/'+postID,{token:reader.token}).then(r=>r.json());
  assert.equal(detail.comments.length,30);assert.equal(detail.commentsHasMore,true);assert.ok(detail.commentsNextCursor);
  assert.ok(detail.users.some(u=>u.id===author.id));
  await query("UPDATE comments SET status='removed' WHERE id=$1",[prefix+'-1']);
  assert.equal((await collect('/posts/'+postID+'/comments',reader.token,'comments')).length,514);
});

test('collections and leaders can be fetched outside global recent lists and invalid cursors fail explicitly',async()=>{
  const owner=await makeUser(),prefix=id('col');
  await query(`INSERT INTO group_collections(id,owner_id,name,deadline,created_at)
    SELECT $1||'-'||n,$2,'Collection '||n,now()+interval '1 day',now()-n*interval '1 second' FROM generate_series(1,205) n`,[prefix,owner.id]);
  const collections=await collect('/collections?ownerID='+owner.id,owner.token,'collections');
  assert.equal(collections.length,205);assert.equal(new Set(collections.map(c=>c.id)).size,205);
  const users=await collect('/users?id='+owner.id,owner.token,'users');assert.equal(users[0].id,owner.id);
  assert.equal((await api.request('/feed?cursor=not-valid')).status,400);
  assert.equal((await api.request('/feed?limit=10000')).status,400);
  assert.equal((await api.request('/feed?favorites=true')).status,401);
});
