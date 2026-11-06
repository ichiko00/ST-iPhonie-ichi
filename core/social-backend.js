import {normalizeSocial, parseSocialPlan, completeSocialPlan, blockedEntry, waitingEntry} from './social.js';

export const socialMethods = {
  socialScope() { return this.here()?.key || ''; },
  socialData() { return normalizeSocial(this.settings.chat.social); },
  socialEntry(name) { return this.socialData().entries.find(e => e.scope === this.socialScope() && e.name === name); },
  socialScopeFor(thread) { const how=this.settings.chat.partition; return how==='chat' && thread?.save ? `${thread.space}#${thread.save}` : how==='card' || how==='chat' ? thread?.space || this.socialScope() : ''; },
  socialBlocked(name, scope = this.socialScope()) { return !!blockedEntry(this.socialData(), scope, name); },
  socialWaiting(name, scope = this.socialScope()) { return !!waitingEntry(this.socialData(), scope, name); },
  socialAssert(name, scope = this.socialScope()) { if (this.socialBlocked(name, scope)) throw Error(`「${name}」在黑名单中，消息和电话已拦截；请先移出黑名单`); if (this.socialWaiting(name, scope)) throw Error(`请先通过「${name}」的好友申请`); },
  socialWrite(change) {
    this.assertOpen(); const next = this.getState(), data = normalizeSocial(next.chat.social);
    change(data); next.chat.social = normalizeSocial(data); this.save(next); this.emit('chat', {friend: true, social: true}); return this.socialSnapshot();
  },
  socialSnapshot() { const data = this.socialData(); return {...data, scope: this.socialScope(), entries: data.entries.filter(e => e.scope === this.socialScope())}; },
  socialSet(name, patch) {
    const scope = this.socialScope(); name = String(name || '').trim().slice(0, 40); if (!name || name === 'me') throw Error('联系人名字无效');
    return this.socialWrite(data => { let e = data.entries.find(e => e.scope === scope && e.name === name); if (!e) { e = {name, scope, state: 'friend', at: 0, attempts: 0}; data.entries.push(e); } Object.assign(e, patch, {name, scope, at: Date.now()}); });
  },
  socialOptions(patch) { return this.socialWrite(data => { for (const key of ['autoRequests', 'allowAlts', 'autoGroups']) if (typeof patch?.[key] === 'boolean') data[key] = patch[key]; }); },
  socialBlock(name) { return this.socialSet(name, {state: 'blocked', allowAlt: true}); },
  socialUnblock(name) { if (!this.socialBlocked(name)) throw Error('这个人不在黑名单'); return this.socialSet(name, {state: 'friend'}); },
  async socialRequest(value) {
    const c = parseSocialPlan(JSON.stringify({contacts: [value]})).contacts[0]; if (!c) return false;
    const old = this.socialEntry(c.name), data = this.socialData();
    if (old || this.socialBlocked(c.name)) return false; // no repeated requests after rejection
    if (data.entries.filter(e => e.scope === this.socialScope() && e.state === 'pending').length >= 30) return false;
    if (c.owner) {
      const owner = this.socialEntry(c.owner);
      if (!data.allowAlts || owner?.state !== 'blocked' || !owner.allowAlt || owner.attempts >= 2) return false;
      if (this.contacts().some(x => x.name === c.name)) return false;
      if (data.entries.some(e => e.scope === this.socialScope() && e.owner === c.owner && e.state === 'pending')) return false;
      this.socialSet(c.owner, {attempts: owner.attempts + 1});
    } else if (this.contacts().some(x => x.name === c.name)) return false;
    this.socialSet(c.name, {...c, state: 'pending'}); return true;
  },
  async socialDecide(name, action) {
    const scope=this.socialScope(), tag=this.spaceTag(); const e = this.socialEntry(name); if (e?.state !== 'pending') throw Error('申请已处理或不属于当前分区');
    if (action === 'reject') { this.socialSet(name, {state: 'rejected'}); return; }
    if (!['accept', 'release'].includes(action)) throw Error('未知申请操作');
    if (action === 'release' && !e.owner) throw Error('这不是小号申请');
    const target = action === 'release' ? e.owner : name;
    if (action === 'release') { if (!this.socialBlocked(target)) throw Error('原账号已不在黑名单'); this.socialUnblock(target); this.socialSet(name, {state: 'rejected'}); }
    else {
      if (!this.contacts().some(c => c.name === target)) this.saveContact({name: target, persona: e.owner ? `${e.persona}\n真实身份：${e.owner}。这是用户明确通过的小号；原账号的黑名单不自动解除。` : e.persona});
      this.socialSet(name, {state: 'friend'});
    }
    const list=await this.threads();
    if(this.socialScope()!==scope) throw Error('已切换分区，请回到原聊天查看好友关系');
    const t = list.find(t=>t.type==='dm'&&t.members[0]===target) || await this.chats.create({type:'dm',members:[target],...tag});
    if(this.socialScope()!==scope) throw Error('已切换分区，请回到原聊天查看好友关系');
    if (t.friend?.by === 'me') await this.chats.update(t.id, {friend: null});
    if(action==='release')for(const other of list)if(other.type==='dm'&&other.members[0]===target&&other.blocked)await this.chats.update(other.id,{blocked:null});
    await this.chats.append(t.id, [{from: 'me', kind: 'system', text: action === 'release' ? `你已将${target}移出黑名单` : `你通过了${name}的好友申请`}], {read: true});
    this.emit('chat', {threadId: t.id, friend: true}); return t;
  },
  async socialApply(plan, selected) {
    if (plan?.scope !== this.socialScope() || (plan.cardKey !== undefined && plan.cardKey !== this.cardKey()) || (plan.saveKey !== undefined && plan.saveKey !== this.saveKey())) throw Error('已切换角色卡或聊天，请重新整理人脉');
    const scope=this.socialScope(), tag=this.spaceTag();
    const clean = completeSocialPlan(parseSocialPlan(JSON.stringify(plan), {scope: plan.scope}),{known:this.contacts()}), chosen = new Set(selected?.contacts || []), wanted = new Set(selected?.groups || []);
    let contacts = 0, groups = 0, skipped = 0, requests=0;const details=[];const skip=(name,reason)=>{skipped++;details.push({name,reason});};
    for (const c of clean.contacts.filter(c => chosen.has(c.name))) {
      if(this.socialScope()!==scope)throw Error('已切换分区，请重新整理人脉');
      if(this.socialBlocked(c.name)){skip(c.name,'在黑名单中，请先手动移出黑名单');continue;}
      const entry=this.socialEntry(c.name);
      if(c.relationship==='unknown'){skip(c.name,'尚无已添加好友或收到申请的明确依据，请补充正文后重试');continue;}
      if(c.relationship==='pending'){
        if(entry?.state==='friend'||this.contacts().some(x=>x.name===c.name)){details.push({name:c.name,reason:'已经是好友，不重复生成申请'});continue;}
        if(entry?.state==='rejected'){skip(c.name,'该账号的申请已被你拒绝，不重复恢复');continue;}
        if(entry?.state==='pending'){details.push({name:c.name,reason:'申请已在“新的朋友”中等待处理'});continue;}
        this.socialSet(c.name,{...c,state:'pending'});requests++;details.push({name:c.name,reason:'新好友申请已放入“新的朋友”，等待你通过或拒绝'});continue;
      }
      const owner=c.owner||entry?.owner;
      if(owner){
        const existed=this.contacts().some(x=>x.name===c.name);
        if(!existed)this.saveContact({name:c.name,persona:[c.persona,'账号真实身份：'+owner+'。正文中已添加的好友账号；不自动解除原账号黑名单。'].filter(Boolean).join('\n')});
        this.socialSet(c.name,{...c,owner,state:'friend'});
        const list=await this.threads();const thread=list.find(t=>t.type==='dm'&&t.members[0]===c.name)||await this.chats.create({type:'dm',members:[c.name],...tag});
        if(thread.friend?.by==='me')await this.chats.update(thread.id,{friend:null});
        if(!existed)contacts++;else details.push({name:c.name,reason:'已有好友账号已同步关系'});continue;
      }
      if(entry?.state==='pending'){await this.socialDecide(c.name,'accept');contacts++;continue;}
      if(entry?.state==='rejected')this.socialSet(c.name,{state:'friend'});
      if (this.contacts().some(x => x.name === c.name)) {details.push({name:c.name,reason:'已在当前联系人中，无需重复添加'});continue;}
      this.saveContact({name: c.name, persona: [c.persona, c.reason && '与你的关系：' + c.reason].filter(Boolean).join('\n')}); contacts++;
    }
    const threads = await this.threads();
    for (const g of clean.groups.filter(g => wanted.has(g.name))) {
      if(this.socialScope()!==scope) throw Error('已切换分区，请回到原聊天查看已添加的人脉');
      const members = g.members.filter(n => this.contacts().some(c => c.name === n) && !this.socialBlocked(n) && !this.socialWaiting(n));
      if(members.length<2){skip(g.name,'可加入的好友不足两名；请先处理成员的申请或黑名单');continue;}if(threads.some(t=>t.type==='group'&&t.name===g.name)){skip(g.name,'同名群聊已存在');continue;}
      const t = await this.chats.create({type: 'group', name: g.name, members, ...tag}); if(!threads.some(x=>x.id===t.id)) threads.push(t); groups++;
    }
    this.emit('chat', {social: true}); return {contacts, groups, skipped, requests, details};
  },
  async socialGroupMembers(id, options={}) {
    const thread=await this.chats.get(id);if(!thread||thread.type!=='group')throw Error('这个群聊已不存在');
    if(this.socialScopeFor(thread)!==this.socialScope())throw Error('请回到这个群所属的角色卡或聊天再操作');
    const add=[...new Set((options.add||[]).map(n=>String(n).trim()).filter(Boolean))];
    if(add.some(n=>!this.contacts().some(c=>c.name===n)))throw Error('请先将新成员添加为联系人');
    if(add.some(n=>this.socialBlocked(n)||this.socialWaiting(n)))throw Error('新成员中有黑名单或未通过好友验证的账号');
    const result=await this.chats.changeGroupMembers(id,{add,remove:options.remove||[],source:options.source==='story'?'story':'manual',...(options.sourceRef?{sourceRef:options.sourceRef}:{})});
    this.emit('chat',{threadId:id,membership:true});return result;
  },
  async socialFilter(thread, items) {
    if (thread.type === 'dm') {
      const name = thread.members[0]; const scope=this.socialScopeFor(thread); if (this.socialBlocked(name, scope) || this.socialWaiting(name, scope)) return [];
    }
    // Like real group chats: blocked people may speak in shared groups, but cannot whisper/call privately.
    return items.filter(i => thread.type !== 'group' || !['dm', 'call'].includes(i.kind) || (!this.socialBlocked(i.from,this.socialScopeFor(thread)) && !this.socialWaiting(i.from,this.socialScopeFor(thread))));
  }
};
export function socialApi(b) { return {socialGroupMembers:(id,o)=>b.socialGroupMembers(id,o), socialSnapshot: () => b.socialSnapshot(), socialBlock:async n=>{const result=b.socialBlock(n);if(b.blockContact&&b.contacts().some(c=>c.name===n))await b.blockContact(n);return result;}, socialUnblock:async n=>{const result=b.socialUnblock(n);for(const t of await b.threads())if(t.type==='dm'&&t.members[0]===n&&t.blocked)await b.chats.update(t.id,{blocked:null});b.emit('chat',{social:true,friend:true});return result;}, socialOptions: p => b.socialOptions(p), socialAllowAlt:(n,on)=>{if(!b.socialBlocked(n))throw Error('此人不在黑名单');return b.socialSet(n,{allowAlt:on===true});}, socialCardKey:()=>b.cardKey(), socialSaveKey:()=>b.saveKey(), socialDecide: (n,a) => b.socialDecide(n,a), socialApply: (p,s) => b.socialApply(p,s)}; }
