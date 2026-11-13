import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {startTestApp,makeUser,query,id} from './helpers.js';
import {adaptLegacyResponse} from '../../src/legacyProtocol.js';
import {assetCapability,assetCapabilityReader} from '../../src/assetCapability.js';
let api;before(async()=>{api=await startTestApp();});after(async()=>api.close());
async function conversation(n){
 const sender=await makeUser(),recipient=await makeUser(),thread=id('t');
 await query('INSERT INTO message_threads(id,buyer_user_id,publisher_user_id) VALUES($1,$2,$3)',[thread,recipient.id,sender.id]);
 await query("INSERT INTO direct_messages(id,thread_id,sender_id,body) SELECT $1||'-'||i,$1,$2,'Synthetic history '||i FROM generate_series(1,$3::int) i",[thread,sender.id,n]);
 return {sender,recipient,thread};
}
test('build 11 receives a complete conversation while protocol 2 remains paginated',async()=>{
 const {recipient,thread}=await conversation(125);
 const modern=await api.request('/bootstrap',{token:recipient.token});
 // Exercise the actual compatibility middleware with the same authenticated read.
 const legacy=await fetch(api.base+'/bootstrap',{headers:{authorization:'Bearer '+recipient.token}});
 assert.equal(modern.status,200);assert.equal(legacy.status,200);
 const a=await modern.json(),b=await legacy.json();
 assert.ok(a.messageThreads[0].messages.length<125);assert.equal(a.messageThreads[0].messagesArePartial,true);
 assert.equal(b.messageThreads[0].messages.length,125);assert.equal(b.messageThreads[0].messagesArePartial,false);
});
test('legacy idle sync includes unread count and oversized histories request an upgrade',async()=>{
 const {recipient,thread}=await conversation(2001);
 const idle=await adaptLegacyResponse({user:recipient},{messageThreads:[],events:[]});
 assert.equal(typeof idle.unreadMessageCount,'number');
 await assert.rejects(adaptLegacyResponse({user:recipient},{messageThreads:[{id:thread}]}),error=>error.status===426);
});
test('legacy reset requires reauthentication and expired image capabilities fail closed',async()=>{
 const user=await makeUser();
 await assert.rejects(adaptLegacyResponse({user},{resetRequired:true}),error=>error.status===409);
 const real=Date.now;
 let cap;try{Date.now=()=>real()-301000;cap=assetCapability('message/test/image.jpg',user.id);}finally{Date.now=real;}
 assert.equal(await assetCapabilityReader('message/test/image.jpg',cap),null);
});
