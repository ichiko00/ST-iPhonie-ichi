import {esc,btn,field,input,textArea} from './common.js';
export function socialPanel(ctx, refresh) {
 const api=ctx.api;
 const makeDialog=(title,html)=>ctx.dialog(title,`<div class="iphonie-social">${html}</div>`);
 const note=(e)=>ctx.notify(e.message||String(e),{error:true});
 function open(page='requests') {
  const s=api.socialSnapshot(), pending=s.entries.filter(e=>e.state==='pending'), blocked=s.entries.filter(e=>e.state==='blocked');
  const d=makeDialog('手机社交',`<div class="actions">${btn('social-plan','AI 整理人脉','primary')}${btn('social-requests',`好友申请 ${pending.length}`,'secondary')}${btn('social-blocked',`黑名单 ${blocked.length}`,'secondary')}</div>
   <div class="group pad"><label><input type="checkbox" data-social-option="autoGroups" ${s.autoGroups!==false?'checked':''}> 根据正文同步群成员进退</label><p class="hint">仅在新正文有进退群线索时调用文字模型；已发生的变化会在群里显示提示。</p><label><input type="checkbox" data-social-option="autoRequests" ${s.autoRequests?'checked':''}> 随剧情自动检查好友申请</label><p class="hint">每 4 次正文回复最多检查一次，使用当前文字模型，会产生额外请求。</p><label><input type="checkbox" data-social-option="allowAlts" ${s.allowAlts?'checked':''}> 允许被拉黑角色尝试小号申请</label><p class="hint">小号最多尝试两次，拒绝后不会用同一账号再申请；原账号不会自动解封。</p></div>
   ${page==='blocked'?`<p class="hint">拉黑后私聊、电话和所有聊天窗口都拒收。共同群聊中的消息仍可见。</p><div class="group">${blocked.map(e=>`<div class="list-row"><span><strong>${esc(e.name)}</strong><small>已拉黑 · ${e.allowAlt?'允许尝试小号':'不再接受小号'}</small></span><button data-alt="${esc(e.name)}">${e.allowAlt?'禁止小号':'允许小号'}</button><button data-unblock="${esc(e.name)}">移出</button></div>`).join('')||'<p class="hint">黑名单为空</p>'}</div>`:
   `<div class="actions">${btn('social-check','让角色考虑添加你','secondary')}</div><div class="group">${pending.map(e=>`<div class="pad"><strong>${esc(e.name)}</strong>${e.owner?`<small> · 小号真实身份：${esc(e.owner)}</small>`:''}<p>${esc(e.message||'请求添加你为好友')}</p><small>${esc(e.reason)}</small><div class="actions"><button data-decide="accept" data-name="${esc(e.name)}">通过${e.owner?'此小号':''}</button>${e.owner?`<button data-decide="release" data-name="${esc(e.name)}">解除原账号拉黑</button>`:''}<button data-decide="reject" data-name="${esc(e.name)}">拒绝</button></div></div>`).join('')||'<p class="hint">暂无待处理申请</p>'}</div>`}`);
  d.body.addEventListener('change',event=>{const el=event.target;if(el.dataset.socialOption)api.socialOptions({[el.dataset.socialOption]:el.checked});});
  d.body.addEventListener('click',async event=>{
   const el=event.target.closest('button');if(!el)return;const a=el.dataset.action;
   try {
    if(a==='social-plan'){d.close();planner();return;}
    if(a==='social-requests'||a==='social-blocked'){d.close();open(a==='social-blocked'?'blocked':'requests');return;}
    if(a==='social-check'){el.disabled=true;el.textContent='正在结合剧情判断…';await api.socialGenerate({mode:'requests',history:60});d.close();open();refresh();return;}
    if(el.dataset.decide){el.disabled=true;await api.socialDecide(el.dataset.name,el.dataset.decide);d.close();open();refresh();return;}
    if(el.dataset.unblock){await api.socialUnblock(el.dataset.unblock);d.close();open('blocked');refresh();}
    if(el.dataset.alt){const old=s.entries.find(e=>e.name===el.dataset.alt);await api.socialAllowAlt(el.dataset.alt,!old.allowAlt);d.close();open('blocked');}
   }catch(e){el.disabled=false;note(e);}
  });return d;
 }
 function planner(){
  const d=makeDialog('AI 整理好友和群聊',`<p class="hint">还原正文中已经存在的好友和群聊，不判断是否值得新增关系。读取角色卡、用户设定、正文（包含代码块及折叠区里的聊天展示）和已触发世界书，先预览确认。</p><div class="group pad">${field('正文历史条数',input('social-history',80,'number','min="10" max="300"'))}${field('补充要求',textArea('social-extra','','rows="3" placeholder="例如：补齐同事和家庭成员，建立工作群和家人群"'))}</div><div class="actions">${btn('social-generate','生成预览','primary')}${btn('social-stop','停止','secondary')}</div>`);
  d.body.addEventListener('click',async event=>{
   const el=event.target.closest('[data-action]');if(!el)return;
   if(el.dataset.action==='social-stop'){api.socialCancel();d.close();return;}
   if(el.dataset.action!=='social-generate')return;
   el.disabled=true;el.textContent='正在读取设定和整理…';
   try{const plan=await api.socialGenerate({history:d.body.querySelector('[data-field="social-history"]')?.value||80,extra:d.body.querySelector('[data-field="social-extra"]')?.value||''});d.close();preview(plan);}catch(e){el.disabled=false;el.textContent='重新生成';note(e);}
  });
 }
 function preview(plan){
  const d=makeDialog('确认人脉建议',`<p class="hint">已读取 ${plan.sources.history}/${plan.sources.available??plan.sources.history} 条正文 · ${plan.sources.chars??0} 字${plan.sources.truncated?` · ${plan.sources.truncated} 条存在截断`:""} · ${plan.sources.card?'含角色卡':'无角色卡'} · ${plan.sources.world?'含已触发世界书':'未取得世界书内容'}。勾选要同步的人物和群聊。${plan.rechecked?" 已对群聊进行二次复核。":""}</p>${plan.summary?`<p class="hint">提取说明：${esc(plan.summary)}</p>`:""}${(plan.diagnostics||[]).map(t=>`<p class="hint">${esc(t)}</p>`).join("")}<div class="group pad">${plan.contacts.map((c,i)=>`<label class="list-row"><input type="checkbox" data-person="${i}" checked><span><strong>${esc(c.name)}</strong><small>${c.relationship==='pending'?'新申请 · 等待验证':c.relationship==='unknown'?'关系待确认':'已有好友 · 直接还原'}</small><small>${esc(c.reason)}</small><small>${esc(c.evidence||'')}</small>${c.owner?`<small>账号身份：${esc(c.owner)} 的小号</small>`:""}<small>${esc(c.persona)}</small></span></label>`).join('')||'<p>本次未提取到人物，请查看上方提取说明。</p>'}</div><div class="group pad">${plan.groups.map((g,i)=>`<label class="list-row"><input type="checkbox" data-group="${i}" checked><span><strong>${esc(g.name)}</strong><small>${esc(g.members.join('、'))}</small><small>${esc(g.reason)}</small></span></label>`).join('')||'<p>本次未提取到可同步的群聊。</p>'}</div><div class="actions">${btn('social-apply','添加选中人脉','primary')}</div><p class="hint">已有好友直接还原到联系人，新申请放入“新的朋友”；关系不明确时不直接添加。群聊只加入已确认的好友；不足两名角色的群不创建。</p>`);
  d.body.addEventListener('click',async event=>{const el=event.target.closest('[data-action="social-apply"]');if(!el)return;el.disabled=true;
   try{if(plan.cardKey!==api.socialCardKey()||plan.saveKey!==api.socialSaveKey())throw Error('已切换正文聊天，请重新生成');const result=await api.socialApply(plan,{contacts:[...d.body.querySelectorAll('[data-person]:checked')].map(e=>plan.contacts[Number(e.dataset.person)].name),groups:[...d.body.querySelectorAll('[data-group]:checked')].map(e=>plan.groups[Number(e.dataset.group)].name)});d.close();refresh();ctx.notify(`新增 ${result.contacts} 位好友、${result.requests||0} 条申请、${result.groups} 个群聊；跳过 ${result.skipped} 项`);if(result.details?.length)makeDialog('人脉添加结果',`<p>新增 ${result.contacts} 位好友、${result.requests||0} 条申请、${result.groups} 个群聊</p>${result.details.map(item=>`<p><strong>${esc(item.name)}</strong>：${esc(item.reason)}</p>`).join('')}`);}catch(e){el.disabled=false;note(e);}});
 }
 return {open,planner};
}
