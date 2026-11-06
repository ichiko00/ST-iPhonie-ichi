// Social graph is settings data: backed up with chat settings, isolated by the active partition.
const line = (v, n = 40) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const states = ['friend', 'pending', 'rejected', 'blocked'];
export function normalizeSocial(value = {}) {
  const entries = [], seen = new Set();
  for (const e of (Array.isArray(value?.entries) ? value.entries : []).slice(-1000)) {
    if (!e || typeof e !== 'object') continue;
    const name = line(e.name), scope = line(e.scope, 900), key = JSON.stringify([scope, name]);
    if (!name || name === 'me' || !states.includes(e.state) || seen.has(key)) continue;
    seen.add(key); entries.push({name, scope, state: e.state, owner: line(e.owner), persona: line(e.persona, 2000),
      message: line(e.message, 300), reason: line(e.reason, 500), at: Number.isFinite(e.at) ? e.at : 0,
      allowAlt: e.allowAlt !== false, attempts: Math.max(0, Math.min(20, Number(e.attempts) || 0))});
  }
  return {autoGroups: value?.autoGroups !== false, groupEvents: [...new Set((Array.isArray(value?.groupEvents)?value.groupEvents:[]).filter(x=>typeof x==='string').map(x=>x.slice(0,300)))].slice(-300), entries, autoRequests: value?.autoRequests === true, allowAlts: value?.allowAlts !== false};
}
export function parseSocialPlan(raw, {user = '', scope = '', requireRelationship=false} = {}) {
  let s = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (s.length > 120000) throw Error('生成结果过长，请缩小历史范围');
  let obj; try { obj = JSON.parse(s); } catch { throw Error('AI 没有返回有效 JSON，请重试；未修改联系人'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw Error('AI 返回的人脉格式无效');
  if (!Array.isArray(obj.contacts) && !Array.isArray(obj.groups)) throw Error('AI 返回缺少 contacts/groups 数组，不能据此判定没有人脉，请重试');
  const diagnostics = [];
  const contacts = [], names = new Set();
  for (const c of (Array.isArray(obj.contacts) ? obj.contacts : []).slice(0, 40)) {
    const name = line(c?.name); if (!name || ['me', user, '{{user}}', '{{char}}'].includes(name) || names.has(name)) continue;
    names.add(name); contacts.push({name, persona: line(c.persona, 2000), reason: line(c.reason, 500), message: line(c.message, 300), owner: line(c.owner), relationship:['friend','pending','unknown'].includes(c.relationship)?c.relationship:requireRelationship?'unknown':'friend',evidence:line(c.evidence,2000)});
  }
  const groups = [], used = new Set();
  for (const g of (Array.isArray(obj.groups) ? obj.groups : []).slice(0, 12)) {
    const name = line(g?.name), members = [...new Set((Array.isArray(g?.members) ? g.members : []).map(n => line(typeof n === 'object' ? n?.name : n)).filter(n => n && n !== user && n !== 'me'))].slice(0, 20);
    if (!name) {diagnostics.push('有一个群聊缺少名称');continue;}
    if (members.length < 2) {diagnostics.push(`群「${name}」只识别到 ${members.length} 位非用户成员，未达到当前群聊的两名角色要求`);continue;}
    if (used.has(name)) continue;
    used.add(name); groups.push({name, members, reason: line(g.reason, 500)});
  }
  return {scope, contacts, groups, diagnostics, summary: line(obj.summary || obj.reason, 800), sources: null};
}
export function blockedEntry(social, scope, name) { return social.entries.find(e => e.scope === scope && e.name === name && e.state === 'blocked'); }
export function waitingEntry(social, scope, name) { return social.entries.find(e => e.scope === scope && e.name === name && ['pending', 'rejected'].includes(e.state)); }

/** Roster extraction preserves chat displays inside code fences/details; unlike normal chat cleaning these ARE evidence. */
export function socialStoryText(value) {
  return String(value ?? '').replace(/<(script|style|think|thinking|analysis)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
    .replace(/<!--[\s\S]*?-->/g,' ').replace(/<phone\b[^>]*group\s*=\s*["']([^"']+)["'][^>]*>/gi,'\n【群聊：$1】\n')
    .replace(/```[a-z]*\s*\n?/gi,'').replace(/<(?:br|\/p|\/div|\/li|\/summary)\b[^>]*>/gi,'\n')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
export function collectSocialHistory(messages, {history=80,user='我',char='角色',budget=100000,each=24000}={}) {
  const available=(Array.isArray(messages)?messages:[]).filter(m=>!m.is_system && typeof m.mes==='string' && m.mes.trim());
  const requested=Math.max(10,Math.min(300,Number(history)||80)), selected=available.slice(-requested), story=[], hints=[];
  let chars=0,truncated=0;
  for(const m of selected.slice().reverse()) {
    const text=socialStoryText(m.mes), names=[...m.mes.matchAll(/<phone\b[^>]*group\s*=\s*["']([^"']+)["']/gi)].map(x=>x[1]);
    for(const name of names) if(!hints.some(h=>h.name===name)) hints.push({name,evidence:text.slice(0,1600)});
    const left=budget-chars; if(left<=0){truncated++;continue;}
    const limit=Math.min(each,left), kept=text.length>limit?text.slice(0,Math.floor(limit*.5))+'\n[中间部分因长度限制省略]\n'+text.slice(-Math.floor(limit*.5)):text;
    if(text.length>limit)truncated++;
    story.unshift(`${m.is_user?user:m.name||char}: ${kept}`);chars+=kept.length;
  }
  return {story,hints,available:available.length,requested,selected:selected.length,chars,truncated};
}
/** A member named in an existing group is already a concrete contact, not a speculative stranger. */
export function completeSocialPlan(plan, {known=[],user=''}={}) {
  const existing=new Set(known.map(c=>typeof c==='string'?c:c.name)), names=new Set(plan.contacts.map(c=>c.name));
  for(const group of plan.groups) for(const name of group.members) {
    if(name===user||name==='me'||existing.has(name)||names.has(name))continue;
    names.add(name);plan.contacts.push({name,persona:'',reason:`正文群聊「${group.name}」的成员。${group.reason||''}`,message:'',owner:'',relationship:'unknown',evidence:''});
  }
  return plan;
}
