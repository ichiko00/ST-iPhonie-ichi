export const CALL_HINT=/电话|来电|通话|接听|接起|听筒|手机.{0,6}响|铃声/;
export function parseStoryCalls(raw,{text='',user='我',current='',known=[],active=null}={}){
 let data;try{data=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw Error('正文电话识别没有返回有效JSON');}
 if(!Array.isArray(data?.calls))throw Error('正文电话识别缺少calls数组');
 const compact=s=>String(s).replace(/[\s“”‘’「」『』]/g,''),source=compact(text),out=[]; const diagnostics=[]; Object.defineProperty(out,'diagnostics',{value:diagnostics});
 for(const e of data.calls.slice(0,4)){
  const name=String(e?.name||'').trim().slice(0,40),evidence=String(e?.stateEvidence||e?.evidence||'').trim().slice(0,3000);let state=e?.state;
  if(!name||['me',user].includes(name)||!['ringing','talking','ended'].includes(state)||!evidence||!source.includes(compact(evidence))){diagnostics.push(name+'：状态或原文证据不匹配');continue;}
  const identity=String(e?.identityEvidence||e?.evidence||'');
  if(!known.includes(name)&&name!==current&&(!identity.includes(name)||!source.includes(compact(identity)))){diagnostics.push(name+'：缺少角色身份原文证据');continue;}
  if(/(?:回想|回忆|梦见).{0,12}(?:电话|通话)|(?:假如|如果|打算|准备|想|可能).{0,8}(?:打电话|打.{0,4}电话|拨打|接听)|昨天的电话|曾经的电话/.test(evidence)){diagnostics.push(name+'：证据是回忆或计划');continue;}
  if(!CALL_HINT.test(evidence)&&active?.name!==name){diagnostics.push(name+'：状态证据没有电话线索');continue;}
  if(state==='talking'&&/未接通|没有接通|尚未接|还没接|等待接听/.test(evidence))state='ringing';
  if(state==='talking'&&!/接通|接起|接听|电话那头|电话另一端|听筒|通话中|通话里|电话里/.test(evidence)&&!(active?.name===name&&active.state==='talking')){diagnostics.push(name+'：缺少已经接通的原文证据');continue;}
  if(state==='ended'&&!/挂断|结束.{0,5}通话|通话.{0,5}结束|忙音|拒接|无人接听|未接来电|放下.{0,4}听筒/.test(evidence)){diagnostics.push(name+'：缺少已经结束的原文证据');continue;}
  const lines=[];
  for(const l of(Array.isArray(e.lines)?e.lines:[]).slice(0,80)){
   const from=[user,'我','你','me','user'].includes(l?.from)?'me':String(l?.from||'').trim();const words=String(l?.text||'').trim().slice(0,1000);
   if((from!==name&&from!=='me')||!words||!source.includes(compact(words)))continue;
   lines.push({from,text:words,translation:words,emotion:'calm'});
  }
  out.push({name,state,dir:e.dir==='out'?'out':'in',lines,evidence,persona:String(e.persona||'').slice(0,2000),reason:String(e.reason||'正文中的电话').slice(0,300),result:['answered','missed','declined','cancelled'].includes(e.result)?e.result:lines.length||active?.state==='talking'||(state==='ended'&&!/拒接|无人接听|未接来电/.test(evidence))?'answered':'missed'});
 }
 return out;
}
