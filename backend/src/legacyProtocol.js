import { query } from './db.js';
import { loadUnreadSnapshot, loadMessageThreadForUser } from './messages.js';
import { assetCapability } from './assetCapability.js';
import { config } from './config.js';

// Build 11 replaces entire conversations and requires an unread count on idle sync.
// Keep those response semantics bounded while build 12 opts into partial pages.
export function installLegacyProtocol(router) {
  router.use((req,res,next)=>{
    res.setHeader('X-ZBT-Protocol','2');
    if(req.get('X-ZBT-Protocol')==='2') return next();
    const send=res.json.bind(res);
    res.json=body=>{
      void adaptLegacyResponse(req,body).then(value=>send(value)).catch(next);
      return res;
    };
    next();
  });
}
export async function adaptLegacyResponse(req,body) {
  const userId=req.user?.id || body?.currentUser?.id;
  if(!userId || !body || typeof body!=='object') return body;
  const ids=[...new Set([...(body.messageThreads || []).map(t=>t.id),body.thread?.id].filter(Boolean))];
  if(ids.length) {
    const count=(await query('SELECT count(*)::int AS n FROM (SELECT id FROM direct_messages WHERE thread_id=ANY($1::text[]) LIMIT 2001) bounded',[ids])).rows[0].n;
    if(count>2000) { const error=new Error('聊天记录已升级，请安装新版周边团后继续查看');error.status=426;throw error; }
    const threads=await Promise.all(ids.map(id=>loadMessageThreadForUser({query},id,userId,{limit:2000,legacyComplete:true})));
    if(body.messageThreads)body.messageThreads=body.messageThreads.map(t=>threads.find(row=>row.id===t.id));
    if(body.thread)body.thread=threads.find(row=>row.id===body.thread.id);
  }
  if(body.messageThreads && body.unreadMessageCount==null)Object.assign(body,await loadUnreadSnapshot(userId));
  if(body.resetRequired) {const error=new Error('云端数据已升级，请退出后重新登录以刷新数据');error.status=409;throw error;}
  const base=config.publicApiBaseUrl.replace(/\/+$/,'')+'/assets/';
  const visit=value=>{
    if(typeof value==='string' && value.startsWith(base)) {
      const key=value.slice(base.length).split('/').map(decodeURIComponent).join('/');
      return value+'?a='+assetCapability(key,userId);
    }
    if(Array.isArray(value))return value.map(visit);
    if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v)]));
    return value;
  };
  return visit(body);
}
