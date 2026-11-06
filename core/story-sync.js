// Stable floor identifiers live in tavern message metadata; portable message fields remain story/storyVer.
export function storyHash(value){let a=2166136261,b=2246822507;for(const c of String(value??'')){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b^c.charCodeAt(0),3266489909);}return(a>>>0).toString(36)+'-'+(b>>>0).toString(36);}
export function legacyPhoneHash(value){let h=0;for(const c of String(value))h=(h*31+c.codePointAt(0))|0;return(h>>>0).toString(36);}
export function phoneContent(value){return[...String(value??'').matchAll(/<phone\b([^>]*)>([\s\S]*?)<\/phone\s*>/gi)].map(m=>({group:(m[1].match(/group\s*=\s*["'“”「『]?([^"'“”」』>]+)/)?.[1]||'').trim(),text:m[2].trim()})).filter(p=>p.text).map(p=>p.group+'|'+p.text).join('\n');}
const uuid=()=>crypto.randomUUID();
export function storySnapshot(ctx,{makeId=uuid}={}){
 const owner=String(ctx?.getCurrentChatId?.()||ctx?.chatId||'');if(!owner||!Array.isArray(ctx?.chat))return null;
 const meta=ctx.chatMetadata||(ctx.chatMetadata={});let state=meta.myPhoneTimeline,changed=false;
 if(!state||state.format!==1||state.owner!==owner||!/^[-\w]{1,80}$/.test(state.chatUid||'')){state={format:1,owner,chatUid:makeId(),floors:{}};meta.myPhoneTimeline=state;changed=true;}
 state.floors ||= {};const used=new Set(),sources=[];
 for(let index=0;index<ctx.chat.length;index++){
  const m=ctx.chat[index];if(!m||m.is_user||m.is_system||typeof m.mes!=='string')continue;
  const stamp=String(m.send_date||''),signature=JSON.stringify([m.name||'',stamp]);
  const variants=[...new Set([m.mes,...(Array.isArray(m.swipes)?m.swipes.filter(x=>typeof x==='string'):[])])];
  const hashes=variants.map(storyHash);
  let id=m.myPhoneFloorId||m.extra?.myPhoneFloorId;
  if(!/^[-\w]{1,80}$/.test(id||'')||used.has(id)){
   const matches=Object.entries(state.floors).filter(([key,f])=>!used.has(key)&&(stamp&&f.stamp?f.signature===signature:(f.hashes||[]).some(h=>hashes.includes(h))));
   id=matches.length===1?matches[0][0]:makeId();changed=true;
  }
  used.add(id);
  if(m.myPhoneFloorId!==id||m.extra?.myPhoneFloorId!==id){m.myPhoneFloorId=id;m.extra={...(m.extra&&typeof m.extra==='object'?m.extra:{}),myPhoneFloorId:id};changed=true;}
  const prior=state.floors[id],record={signature,stamp,hashes:[...new Set([...(prior?.hashes||[]),...hashes])].slice(-80),index};
  if(JSON.stringify(prior)!==JSON.stringify(record)){state.floors[id]=record;changed=true;}
  sources.push({story:`mp2:${state.chatUid}/${id}`,chatUid:state.chatUid,floorUid:id,owner,index,ver:storyHash(m.mes),raw:m.mes,signature,
   variants:variants.map(text=>({ver:storyHash(text),legacyVer:legacyPhoneHash(phoneContent(text)),hasPhone:!!phoneContent(text)}))});
 }
 return{chatUid:state.chatUid,owner,sources,changed};
}
const same=(a,b)=>a.length===b.length&&a.every(n=>b.includes(n));
const belongs=(row,ref)=>(row.windowOf||row.id)===ref.root&&(row.space||'')===(ref.space||'')&&(row.save||'')===(ref.save||'');
export function reconcileStoryRows(input,archiveInput,snapshot,{allowEmpty=false,makeId=uuid}={}){
 const rows=structuredClone(input),archives=structuredClone(archiveInput),sources=snapshot.sources,bySource=new Map(sources.map(s=>[s.story,s])),prefix=`mp2:${snapshot.chatUid}/`,warnings=[];
 if(!sources.length&&!allowEmpty)return{rows,archives,changed:[],removed:[],needsDelivery:[],warnings:['正文暂未加载，未清理关联消息']};
 let uncertain=0;
 // Migrate legacy chat|index links only if a phone-content version identifies exactly one current floor.
 for(const row of rows)for(const m of row.messages||[]){
  if(!m.story||m.story.startsWith('mp2:'))continue;
  const at=m.story.lastIndexOf('|');if(m.story.slice(0,at)!==snapshot.owner)continue;
  const candidates=sources.flatMap(s=>s.variants.filter(v=>v.hasPhone&&v.legacyVer===m.storyVer).map(v=>({s,v})));
  const unique=[...new Map(candidates.map(x=>[x.s.story+'|'+x.v.ver,x])).values()];
  if(unique.length===1){m.story=unique[0].s.story;m.storyVer=unique[0].v.ver;}else uncertain++;
 }
 if(uncertain)warnings.push(`${uncertain} 条旧手机消息无法可靠确认来源楼层，已保留，未猜测删除`);
 const activeOrder=new Map(archives.map(d=>[d.story,d.source?.index??-1]));
 const docs=new Map(archives.filter(d=>d.story?.startsWith(prefix)).map(d=>[d.story,d]));
 for(const source of sources){let doc=docs.get(source.story);if(!doc){doc={id:source.story,story:source.story,kind:'storyArchive',chatUid:snapshot.chatUid,source:{},activeVer:null,versions:{}};archives.push(doc);docs.set(source.story,doc);}doc.source={owner:source.owner,index:source.index,floorUid:source.floorUid,signature:source.signature,variants:source.variants};}
 for(const row of rows)for(const m of row.messages||[])if(m.story?.startsWith(prefix)&&!docs.has(m.story)){const doc={id:m.story,story:m.story,kind:'storyArchive',chatUid:snapshot.chatUid,source:{index:-1},activeVer:m.storyVer,versions:{}};archives.push(doc);docs.set(m.story,doc);}
 // Capture the complete currently displayed source messages before any removal, including local edits.
 for(const doc of docs.values()){
  doc.versions ||= {};const versions=new Set([...(doc.activeVer?[doc.activeVer]:[]),...rows.flatMap(r=>(r.messages||[]).filter(m=>m.story===doc.story).map(m=>m.storyVer))]);
  for(const ver of versions){if(!ver)continue;const pack=doc.versions[ver]||{delivered:false,groups:[]};pack.messages=rows.flatMap(r=>(r.messages||[]).map((message,index)=>({threadId:r.id,message,index})).filter(x=>x.message.story===doc.story&&x.message.storyVer===ver));if(pack.messages.length)pack.delivered=true;doc.versions[ver]=pack;}
  const target=bySource.get(doc.story)?.ver||null;if(target&&!doc.versions[target])doc.versions[target]={delivered:false,messages:[],groups:[]};
  if(Object.keys(doc.versions).length>80)throw Error('一个正文楼层的归档版本超过80个，请先导出备份后整理；本次未删除消息');
 }
 const switched=[...docs.values()].some(doc=>doc.activeVer!==(bySource.get(doc.story)?.ver||null));
 const allowedGroups=new Set();
 if(switched){
  const activeEffects=[...docs.values()].sort((a,b)=>(activeOrder.get(a.story)??a.source.index??-1)-(activeOrder.get(b.story)??b.source.index??-1)).flatMap(doc=>(doc.versions[doc.activeVer]?.groups||[]));
  const wantedEffects=sources.flatMap(s=>docs.get(s.story)?.versions[s.ver]?.groups||[]),keys=new Map();
  for(const effect of [...activeEffects,...wantedEffects])keys.set(JSON.stringify([effect.root,effect.space||'',effect.save||'']),effect);
  for(const [key,ref]of keys){
   const previous=activeEffects.filter(e=>belongs({id:e.root,space:e.space,save:e.save},ref)),wanted=wantedEffects.filter(e=>belongs({id:e.root,space:e.space,save:e.save},ref)),windows=rows.filter(r=>r.type==='group'&&belongs(r,ref));
   if(!windows.length)continue;const baseline=(previous[0]||wanted[0]).before,expected=previous.at(-1)?.after||baseline;
   if(windows.some(r=>!same(r.members,expected))){warnings.push(`「${windows[0].name}」成员曾被独立修改，保留当前名单，未强行回滚`);continue;}
   let next=[...baseline];for(const e of wanted){next=next.filter(n=>!e.removed.includes(n));for(const n of e.added)if(!next.includes(n))next.push(n);}
   if(!next.length||next.length>20){warnings.push(`「${windows[0].name}」的剧情变更产生不完整名单，已保留当前成员`);continue;}
   for(const r of windows)r.members=[...next];allowedGroups.add(key);
  }
 }
 const obsolete=m=>m.story?.startsWith(prefix)&&bySource.get(m.story)?.ver!==m.storyVer;
 const removed=[];
 for(const row of rows){const before=row.messages||[];row.messages=before.filter(m=>!m.story?.startsWith(prefix)||bySource.get(m.story)?.ver===m.storyVer);removed.push(...before.filter(m=>!row.messages.includes(m)).map(message=>({threadId:row.id,message})));if(row.alts?.versions){row.alts.versions=row.alts.versions.map(v=>v.filter(m=>!obsolete(m)));if(row.alts.versions.filter(v=>v.length).length<2)delete row.alts;}row.unread=Math.max(0,(row.unread||0)-before.filter(m=>!row.messages.includes(m)&&m.from!=='me'&&!['system','notice'].includes(m.kind)).length);}
 for(const source of sources){const doc=docs.get(source.story),pack=doc.versions[source.ver];
  const forbidden=new Set((pack.groups||[]).filter(e=>switched&&!allowedGroups.has(JSON.stringify([e.root,e.space||'',e.save||'']))).flatMap(e=>e.messageIds||[]));
  const remap=new Map();
  for(const entry of pack.messages||[]){const row=rows.find(r=>r.id===entry.threadId);if(!row||row.messages.some(m=>m.id===entry.message.id)||forbidden.has(entry.message.id))continue;
    const oldId=entry.message.id,newId=makeId();remap.set(oldId,newId);entry.message={...entry.message,id:newId,updatedAt:Date.now()};
    row.messages.push(structuredClone(entry.message));row.messages.sort((a,b)=>(a.at||0)-(b.at||0));}
  for(const effect of pack.groups||[])effect.messageIds=(effect.messageIds||[]).map(id=>remap.get(id)||id);
  if(remap.size)for(const row of rows)for(const list of row.alts?.versions||[])for(const m of list)if(remap.has(m.id))m.id=remap.get(m.id);
 }
 const needsDelivery=[];
 for(const doc of docs.values()){doc.activeVer=bySource.get(doc.story)?.ver||null;doc.updatedAt=Date.now();if(doc.activeVer&&!doc.versions[doc.activeVer].delivered&&bySource.get(doc.story).variants.some(v=>v.ver===doc.activeVer&&v.hasPhone))needsDelivery.push(doc.story);}
 const changed=rows.filter((r,i)=>JSON.stringify(r)!==JSON.stringify(input[i]));for(const row of changed)row.updatedAt=Math.max(Date.now(),(row.updatedAt||0)+1);
 return{rows,archives,changed,removed,needsDelivery,warnings};
}
export function validateStoryArchives(values){
 if(!Array.isArray(values)||values.length>20000)throw Error('楼层关联归档格式无效');
 return values.map(d=>{if(!d||typeof d.id!=='string'||d.id!==d.story||!/^mp2:[\w-]+\/[\w-]+$/.test(d.story)||!d.versions||typeof d.versions!=='object'||Object.keys(d.versions).length>80)throw Error('楼层关联归档损坏');for(const[ver,pack]of Object.entries(d.versions)){if(['__proto__','constructor','prototype'].includes(ver)||!/^[\w-]{1,40}$/.test(ver)||!Array.isArray(pack.messages)||!Array.isArray(pack.groups))throw Error('楼层关联版本损坏');for(const g of pack.groups)if(!g||typeof g.root!=='string'||![g.before,g.after,g.added,g.removed,g.messageIds].every(Array.isArray))throw Error('群成员关联归档损坏');for(const e of pack.messages)if(!e?.message?.id||e.message.story!==d.story||e.message.storyVer!==ver||typeof e.threadId!=='string')throw Error('楼层关联消息不匹配');}return structuredClone(d);});
}

/** Reconnect portable archives to the same tavern chat after an app-only backup round trip. Ambiguity stays unlinked. */
export function hydrateStoryMetadata(ctx,archives){
 const owner=String(ctx?.getCurrentChatId?.()||ctx?.chatId||'');if(!owner||ctx.chatMetadata?.myPhoneTimeline)return false;
 const messages=(ctx.chat||[]).filter(m=>m&&!m.is_user&&!m.is_system&&typeof m.mes==='string'),hashes=new Set(messages.flatMap(m=>[m.mes,...(m.swipes||[]).filter(x=>typeof x==='string')].map(storyHash)));
 const eligible=archives.filter(d=>d.source?.owner===owner&&(d.source.variants||[]).some(v=>hashes.has(v.ver))),uids=[...new Set(eligible.map(d=>d.chatUid))];
 if(uids.length!==1)return false;
 const floors={};for(const d of archives.filter(d=>d.chatUid===uids[0]&&d.source?.owner===owner)){const id=d.source.floorUid||d.story.split('/').at(-1);let stamp='';try{stamp=JSON.parse(d.source.signature||'[]')[1]||'';}catch{}floors[id]={signature:d.source.signature||'',stamp,hashes:(d.source.variants||[]).map(v=>v.ver),index:d.source.index};}
 ctx.chatMetadata ||= {};ctx.chatMetadata.myPhoneTimeline={format:1,owner,chatUid:uids[0],floors};return true;
}
