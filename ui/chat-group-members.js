import {esc,avatar} from './common.js';
export async function groupMembersPanel(ctx,id,refresh){
 const api=ctx.api;let thread=await api.getThread(id);if(!thread||thread.type!=='group')throw Error('这个群聊不存在');
 const away=new Set(api.socialSnapshot().entries.filter(e=>['blocked','pending','rejected'].includes(e.state)).map(e=>e.name));
 const contacts=api.chatContacts().filter(c=>!away.has(c.name)),user=api.userName?.()||'你';
 const shown=n=>api.readState?.().chat?.remarks?.[ctx.routeFor?.(n)?.ownKey||n]||n;
 let mode='main',picked=new Set(),query='',working=false,detail='';
 const d=ctx.dialog('聊天信息','');
 d.body.classList?.add('mp-group-body');d.body.closest?.('.sheet')?.classList.add('mp-group-sheet');
 const back=()=>`<button type="button" class="mp-back" data-gm="back"><span aria-hidden="true">‹</span> 返回群信息</button>`;
 const person=(name,{self=false,select=false}={})=>`<button type="button" class="mp-person${picked.has(name)?' is-picked':''}" ${select?`data-pick="${esc(name)}" aria-pressed="${picked.has(name)}"`:`data-person="${esc(self?'me':name)}"`} title="${esc(name)}"><span class="mp-person-image">${avatar(self?user:shown(name),'none',48,self?'me':name)}${select?`<i class="mp-check" aria-hidden="true">${picked.has(name)?'✓':''}</i>`:''}</span><span class="mp-person-name">${esc(self?user+'（你）':shown(name))}</span></button>`;
 const tool=(key,label,symbol)=>`<button type="button" class="mp-person mp-grid-tool" data-gm="${key}"><span class="mp-tool-square" aria-hidden="true">${symbol}</span><span class="mp-person-name">${label}</span></button>`;
 const pool=()=>mode==='add'?contacts.map(c=>c.name).filter(n=>!thread.members.includes(n)):thread.members;
 const candidates=()=>pool().filter(n=>[n,shown(n)].some(t=>t.toLowerCase().includes(query.toLowerCase())));
 function picker(){return candidates().map(n=>person(n,{select:true})).join('')||'<p class="mp-grid-empty">没有可选成员</p>';}
 function paint(){
  let html;
  if(mode==='main') html=`<section class="mp-members-section"><div class="mp-member-grid">${person(user,{self:true})}${thread.members.map(n=>person(n)).join('')}${tool('add','添加','＋')}${tool('remove','移除','−')}</div><p class="mp-count">共 ${thread.members.length+1} 位群成员</p></section>
   <section class="mp-info-section"><div class="mp-info-row"><span>群聊名称</span><span class="mp-row-value" title="${esc(thread.name)}">${esc(thread.name)}</span></div><button type="button" class="mp-info-row" data-gm="add"><span>添加群成员</span><span class="mp-chevron" aria-hidden="true">›</span></button><button type="button" class="mp-info-row" data-gm="remove"><span>移除群成员</span><span class="mp-chevron" aria-hidden="true">›</span></button></section>
   <section class="mp-info-section"><label class="mp-info-row"><span>同步正文进退群</span><span class="mp-switch"><input type="checkbox" data-gm-auto ${api.socialSnapshot().autoGroups!==false?'checked':''}><i></i></span></label>${api.socialGroupScan?'<button type="button" class="mp-info-row" data-gm="scan"><span>根据最新正文同步</span><span class="mp-chevron" aria-hidden="true">›</span></button>':''}</section><p class="mp-footnote">成员变更会在群里显示提示，并同步本群的其他窗口。正文同步使用文字模型，仅确认已发生的进退群。</p>`;
  else if(mode==='add'||mode==='remove') html=`${back()}<section class="mp-picker-section"><h3>${mode==='add'?'添加群成员':'移除群成员'}</h3><p class="mp-picker-note">${mode==='add'?'选择要邀请的联系人':'勾选要移出的成员，历史消息会保留'}</p><label class="mp-search"><span aria-hidden="true">⌕</span><input type="search" data-gm-search value="${esc(query)}" placeholder="搜索成员" aria-label="搜索成员"></label><div class="mp-member-grid mp-picker-list">${picker()}</div></section><footer class="mp-picker-footer"><span data-gm-count>已选 ${picked.size} 人</span><button type="button" class="mp-done${mode==='remove'?' danger':''}" data-gm="save" ${!picked.size||working?'disabled':''}>${mode==='add'?'添加':'移除'}</button></footer>`;
  else if(mode==='confirm')html=`${back()}<section class="mp-confirm"><h3>移出 ${picked.size} 位成员？</h3><p>${esc([...picked].map(shown).join('、'))}</p><p class="mp-picker-note">聊天记录保留，群里会出现移出提示。</p><button type="button" class="mp-done danger" data-gm="confirm" ${working?'disabled':''}>确认移出</button><button type="button" class="mp-cancel" data-gm="remove">重新选择</button></section>`;
  else {const self=detail==='me',name=self?user:detail,c=contacts.find(c=>c.name===detail);html=`${back()}<section class="mp-member-card">${avatar(self?user:shown(name),'none',64,self?'me':name)}<h3>${esc(self?user+'（你）':shown(name))}</h3><p class="mp-profile-copy">${esc(self?'你在这个群聊中':c?.persona||'群成员')}</p>${self?'':`<button type="button" class="mp-done danger" data-gm="remove-one">移出群聊</button>`}</section>`;}
  d.body.innerHTML=`<div class="mp-group-info">${html}</div>`;
 }
 paint();
 d.body.addEventListener('input',event=>{if(!event.target.matches?.('[data-gm-search]'))return;query=event.target.value;d.body.querySelector('.mp-picker-list').innerHTML=picker();});
 d.body.addEventListener('change',event=>{if(event.target.matches?.('[data-gm-auto]'))api.socialOptions({autoGroups:event.target.checked});});
 d.body.addEventListener('click',async event=>{
  const el=event.target.closest('button');if(!el||working)return;
  if(el.dataset.pick){const n=el.dataset.pick;picked.has(n)?picked.delete(n):picked.add(n);el.classList.toggle('is-picked',picked.has(n));el.setAttribute('aria-pressed',String(picked.has(n)));const check=el.querySelector('.mp-check');if(check)check.textContent=picked.has(n)?'✓':'';d.body.querySelector('[data-gm-count]').textContent=`已选 ${picked.size} 人`;d.body.querySelector('[data-gm="save"]').disabled=!picked.size;return;}
  if(el.dataset.person){detail=el.dataset.person;mode='detail';paint();return;}
  const action=el.dataset.gm;
  if(action==='back'){mode='main';picked.clear();query='';paint();return;}
  if(action==='add'||action==='remove'){mode=action;picked.clear();query='';paint();return;}
  if(action==='remove-one'){picked=new Set([detail]);mode='confirm';paint();return;}
  if(action==='save'&&mode==='remove'){mode='confirm';paint();return;}
  if(!['save','confirm','scan'].includes(action))return;
  working=true;el.disabled=true;const oldText=el.textContent;el.textContent=action==='scan'?'正在核对正文…':'正在保存…';
  try{
   if(action==='scan'){const r=await api.socialGroupScan();ctx.notify(r.changed?`已同步 ${r.changed} 项成员变化`:'最新正文没有可确认的进退群变化');}
   else await api.socialGroupMembers(id,action==='confirm'?{remove:[...picked]}:{add:[...picked]});
   thread=await api.getThread(id);refresh();working=false;mode='main';picked.clear();query='';paint();
  }catch(error){working=false;el.disabled=false;el.textContent=oldText;ctx.notify(error.message,{error:true});}
 });return d;
}
