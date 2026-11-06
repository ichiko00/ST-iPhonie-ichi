const name = v => String(v ?? '').replace(/[<>\u0000-\u001f]/g,' ').trim().slice(0,40);
export const MEMBERSHIP_HINT = /加入.{0,40}群|入群|退群|退出.{0,40}群|离开.{0,40}群|移出.{0,40}群|踢出.{0,40}群|邀请.{0,30}加入|拉.{0,20}进群|群[\s\S]{0,80}(?:加入|退出|离开|移出)/;
export function parseGroupEvents(raw,{groups=[],text='',user='我'}={}) {
 let data;try{data=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw Error('群成员变化没有返回有效JSON，未更新成员');}
 if(!Array.isArray(data?.events))throw Error('群成员变化结果缺少events数组');
 const source=text.replace(/\s+/g,''),events=[],seen=new Set();
 for(const e of data.events.slice(0,30)){
  const group=name(e?.group),member=name(e?.member),action=e?.action,evidence=String(e?.evidence||'').trim().slice(0,1000);
  if(!['join','leave'].includes(action)||!member||['me',user].includes(member))continue;
  const matching=groups.filter(g=>g.name===group);if(matching.length!==1)continue;
  const quote=evidence.replace(/\s+/g,'');
  if(!quote||!source.includes(quote)||!quote.includes(member))continue;
  if(groups.length>1&&!quote.includes(group))continue;
  // Intentions, questions, refusals, hypothetical plans and applications do not alter actual membership.
  if(/打算|计划|准备|如果|假如|要不要|是否|还没|尚未|没有|并未|不要|别让|想要|想加入|想退出|想离开|想退群|明天|即将|将要|要加入|要退出|申请|试图/.test(evidence))continue;
  if(action==='join'&&!/加入|入群|进群|拉入/.test(evidence))continue;
  if(action==='leave'&&!/退出|退群|离开|移出|踢出/.test(evidence))continue;
  const key=JSON.stringify([matching[0].id,member,action]);if(seen.has(key))continue;seen.add(key);
  events.push({threadId:matching[0].id,group,member,action,evidence,actor:name(e.actor),persona:String(e.persona||'').slice(0,2000)});
 }
 return events;
}
export function memberChange(current,{add=[],remove=[]}={}) {
 const before=[...new Set(current.map(name).filter(Boolean))],gone=new Set(remove.map(name)),joined=[...new Set(add.map(name).filter(Boolean))];
 const members=before.filter(n=>!gone.has(n));for(const n of joined)if(!members.includes(n))members.push(n);
 if(members.length<1)throw Error('群聊至少保留一名角色；最后一位成员无法直接移除，请先保留或添加其他成员');
 if(members.length>20)throw Error('群聊最多20名角色');
 return {members,added:members.filter(n=>!before.includes(n)),removed:before.filter(n=>!members.includes(n))};
}
