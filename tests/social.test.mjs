import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSocial,parseSocialPlan} from '../core/social.js';
import {socialMethods} from '../core/social-backend.js';
import {defaultChat, normalizeChat} from '../core/chat.js';
import {createSocialHost} from '../host-social.js';
import {TTSBackend} from '../core/backend.js';
import {socialPanel} from '../ui/chat-social.js';
function fixture(){
 let key='card:A', serial=0; const threads=[];
 const b={settings:{chat:{social:normalizeSocial(),contacts:[],partition:'card'}},assertOpen(){},getState(){return structuredClone(this.settings)},save(s){this.settings={...s,chat:normalizeChat(s.chat)};return this.settings},emit(){},here(){return{key}},cardKey(){return key},saveKey(){return''},spaceTag(){return{space:key}},threads:async()=>threads,
 contacts(){return this.settings.chat.contacts.filter(c=>!c.space||c.space===key)},saveContact(c){this.settings.chat.contacts.push({...c,space:key});return c},dmThread:async(name)=>{let t=threads.find(t=>t.type==='dm'&&t.members[0]===name&&t.space===key);if(!t){t={id:'t'+(++serial),type:'dm',members:[name],messages:[],space:key};threads.push(t)}return t}};
 b.chats={create:async(t)=>{const r={...t,id:'t'+(++serial),messages:[]};threads.push(r);return r},get:async(id)=>threads.find(t=>t.id===id),update:async(id,p)=>Object.assign(threads.find(t=>t.id===id),p),append:async(id,msg)=>{const t=threads.find(t=>t.id===id);t.messages.push(...msg);return t}};
 Object.assign(b,socialMethods);return{b,threads,switchTo(k){key=k}};
}
test('social data survives existing chat normalization',()=>{const c=normalizeChat({social:{autoRequests:true,entries:[{name:'小林',scope:'card:A',state:'blocked'}]}});assert.equal(c.social.entries[0].state,'blocked');assert.equal(c.social.autoRequests,true)});
test('old settings remain valid and do not enable extra AI calls',()=>{assert.equal(normalizeChat({}).social.autoRequests,false)});
test('model JSON accepts code fences, deduplicates and excludes user',()=>{const p=parseSocialPlan('```json\n'+JSON.stringify({contacts:[{name:'我'},{name:'A'},{name:'A'}],groups:[{name:'G',members:['我','A','B','B']}]})+'\n```',{user:'我'});assert.deepEqual(p.contacts.map(x=>x.name),['A']);assert.deepEqual(p.groups[0].members,['A','B'])});
test('malformed model result fails without silent import',()=>assert.throws(()=>parseSocialPlan('这里是名单：A、B'),/JSON/));
test('normalizer handles nulls and restricts unsupported states',()=>assert.equal(normalizeSocial({entries:[null,{name:'A',state:'evil'}]}).entries.length,0));
test('blacklist is partitioned by card',()=>{const {b,switchTo}=fixture();b.socialBlock('A');assert.throws(()=>b.socialAssert('A'),/黑名单/);switchTo('card:B');assert.doesNotThrow(()=>b.socialAssert('A'));switchTo('card:A');assert.equal(b.socialBlocked('A'),true)});
test('blacklist covers all private windows and rejects late generated reply',async()=>{const {b}=fixture();const t1=await b.dmThread('A'),t2=await b.chats.create({type:'dm',members:['A'],space:'card:A'});b.socialBlock('A');for(const t of[t1,t2])assert.deepEqual(await b.socialFilter(t,[{from:'A',kind:'text',text:'late'}]),[])});
test('late reply checks original partition after navigation',async()=>{const {b,switchTo}=fixture();b.socialBlock('A');const t=await b.dmThread('A');switchTo('card:B');assert.deepEqual(await b.socialFilter(t,[{from:'A',kind:'text'}]),[])});
test('shared group speech stays visible but private whispers and calls are stopped',async()=>{const {b}=fixture();b.socialBlock('A');const got=await b.socialFilter({type:'group',space:'card:A'},[{from:'A',kind:'text'},{from:'A',kind:'dm'},{from:'A',kind:'call'}]);assert.deepEqual(got.map(i=>i.kind),['text'])});
test('a new request does not add contact or create a chat until accepted',async()=>{const{b,threads}=fixture();assert.equal(await b.socialRequest({name:'B',message:'你好'}),true);assert.equal(b.contacts().length,0);assert.equal(threads.length,0);assert.throws(()=>b.socialAssert('B'),/好友申请/);await b.socialDecide('B','accept');assert.equal(b.contacts()[0].name,'B');assert.equal(threads.length,1)});
test('rejection persists and same account cannot repeatedly apply',async()=>{const{b}=fixture();await b.socialRequest({name:'B'});await b.socialDecide('B','reject');assert.equal(await b.socialRequest({name:'B'}),false);assert.equal(b.contacts().length,0)});
test('only a blocked character may own an alternate request',async()=>{const{b}=fixture();assert.equal(await b.socialRequest({name:'B小号',owner:'B'}),false)});
test('accepting an alternate never automatically unblocks original',async()=>{const{b}=fixture();b.socialBlock('A');await b.socialRequest({name:'星星',owner:'A',persona:'本来的人设'});await b.socialDecide('星星','accept');assert.equal(b.socialBlocked('A'),true);assert.doesNotThrow(()=>b.socialAssert('星星'));assert.match(b.contacts()[0].persona,/真实身份：A/)});
test('release option explicitly unblocks original without adding alternate',async()=>{const{b}=fixture();b.socialBlock('A');await b.socialRequest({name:'星星',owner:'A'});await b.socialDecide('星星','release');assert.equal(b.socialBlocked('A'),false);assert.equal(b.contacts().some(c=>c.name==='星星'),false)});
test('alternate requests are bounded and only one may wait per owner',async()=>{const{b}=fixture();b.socialBlock('A');assert.equal(await b.socialRequest({name:'小号1',owner:'A'}),true);assert.equal(await b.socialRequest({name:'小号2',owner:'A'}),false);await b.socialDecide('小号1','reject');assert.equal(await b.socialRequest({name:'小号2',owner:'A'}),true);await b.socialDecide('小号2','reject');assert.equal(await b.socialRequest({name:'小号3',owner:'A'}),false)});
test('user can completely disable alternate requests',async()=>{const{b}=fixture();b.socialBlock('A');b.socialOptions({allowAlts:false});assert.equal(await b.socialRequest({name:'小号',owner:'A'}),false)});
test('bootstrap merges contacts and groups without overwriting existing data',async()=>{const{b,threads}=fixture();b.saveContact({name:'A',persona:'keep'});const plan={scope:'card:A',contacts:[{name:'A',persona:'overwrite'},{name:'B'}],groups:[{name:'同学群',members:['A','B']}]};const sel={contacts:['A','B'],groups:['同学群']};assert.deepEqual(await b.socialApply(plan,sel),{contacts:1,groups:1,skipped:0,requests:0,details:[{name:"A",reason:"已在当前联系人中，无需重复添加"}]});assert.equal(b.contacts()[0].persona,'keep');await b.socialApply(plan,sel);assert.equal(threads.length,1)});
test('bootstrap respects blacklist, deselection and invalid group membership',async()=>{const{b,threads}=fixture();b.socialBlock('A');const p={scope:'card:A',contacts:[{name:'A'},{name:'B'},{name:'C'}],groups:[{name:'群',members:['A','B','C']}]};await b.socialApply(p,{contacts:['A','B'],groups:['群']});assert.deepEqual(b.contacts().map(c=>c.name),['B']);assert.equal(threads.length,0)});
test('stale previews cannot import to another card',async()=>{const{b,switchTo}=fixture();switchTo('card:B');await assert.rejects(b.socialApply({scope:'card:A',contacts:[],groups:[]},{}),/切换/)});
test('outgoing text and money are blocked before append or debit',async()=>{const{b}=fixture();const t=await b.dmThread('A');b.socialBlock('A');let spent=0;b.walletMove=()=>spent++;await assert.rejects(TTSBackend.prototype.appendChat.call(b,t.id,[{from:'me',kind:'text',text:'x'}]),/黑名单/);await assert.rejects(TTSBackend.prototype.sendPaid.call(b,t.id,{kind:'transfer',amount:'10'}),/黑名单/);assert.equal(t.messages.length,0);assert.equal(spent,0)});
function hostFixture(){const f=fixture();let ctx={name1:'User',name2:'A',characterId:0,characters:[{name:'A',description:'A是User同学',personality:'温和'}],chat:[{is_user:true,mes:'我和B是同事'},{name:'A',mes:'我们认识C'}],getWorldInfoPrompt:async()=>({worldInfoBefore:'C是班长'})};const requests=[];f.b.getState=()=>({chat:normalizeChat(f.b.settings.chat),promptRules:{}});f.b.generateText=async(c,r)=>{requests.push(r);return JSON.stringify({contacts:[{name:'B',persona:'同事',reason:'正文'}],groups:[]})};return{...f,ctx,requests,host:createSocialHost({context:()=>ctx,settings:()=>f.b.getState(),backend:f.b})}}
test('AI planning reads body, card, user and activated world info without mutating phone',async()=>{const{b,host,requests}=hostFixture();const p=await host.generate({history:20,extra:'同事'});assert.equal(p.sources.world,true);assert.equal(p.sources.history,2);assert.equal(b.contacts().length,0);const payload=JSON.parse(requests[0].prompt[1].content);assert.match(payload.character,/同学/);assert.match(payload.world,/班长/);assert.match(payload.story.join(''),/同事/)});
test('automatic requests are off by default and bounded when enabled',async()=>{const{b,host,requests}=hostFixture();for(let i=0;i<8;i++)await host.tick(i);assert.equal(requests.length,0);b.socialOptions({autoRequests:true});for(let i=8;i<12;i++)await host.tick(i);assert.equal(requests.length,1);assert.equal(b.socialSnapshot().entries[0].state,'pending')});
test('generation cancelled or navigated away cannot persist requests',async()=>{const{b,host,switchTo}=hostFixture();let resolve; b.generateText=()=>new Promise(r=>resolve=r);const job=host.generate({mode:'requests'});await new Promise(r=>setTimeout(r,0));switchTo('card:B');resolve('{"contacts":[{"name":"B"}]}');await assert.rejects(job,/切换/);assert.equal(b.socialData().entries.length,0)});
test('social dialog escapes model text and opens all controls',()=>{const{b}=fixture();b.socialSet('B',{state:'pending',message:'<img onerror=bad>'});let html='';const ctx={api:{socialSnapshot:()=>b.socialSnapshot()},dialog:(title,body)=>{html=body;return{body:{addEventListener(){}},close(){}}}};socialPanel(ctx,()=>{}).open();assert.match(html,/AI 整理人脉/);assert.match(html,/黑名单/);assert.doesNotMatch(html,/<img onerror/);assert.match(html,/通过/);assert.match(html,/拒绝/)});
import {collectSocialHistory,completeSocialPlan,socialStoryText} from '../core/social.js';
test('roster history keeps group chat inside code fences and folded HTML',()=>{const text='```html\n<details><summary>同学群</summary><div>小林：晚上一起吃饭</div></details>\n```';assert.match(socialStoryText(text),/同学群/);assert.match(socialStoryText(text),/晚上一起吃饭/)});
test('roster reads group text beyond previous 6000 character cutoff',()=>{const r=collectSocialHistory([{mes:'前文'.repeat(4000)+'\n同学群\n小林：你好\n小陈：来了'}]);assert.match(r.story[0],/小陈：来了/);assert.equal(r.truncated,0)});
test('long message truncation is explicit and retains recent tail',()=>{const r=collectSocialHistory([{mes:'x'.repeat(30000)+'群聊：下班群'}]);assert.equal(r.truncated,1);assert.match(r.story[0],/下班群/)});
test('members from group-only output become concrete contact candidates',()=>{const p=completeSocialPlan(parseSocialPlan('{"contacts":[],"groups":[{"name":"同学群","members":["小林","小陈"]}]}'),{known:[{name:'小林'}]});assert.deepEqual(p.contacts.map(c=>c.name),['小陈']);assert.match(p.contacts[0].reason,/同学群/)});
test('missing output schema is an error rather than no friends',()=>assert.throws(()=>parseSocialPlan('{"result":"不需要"}'),/缺少/));
test('filtered groups report why rather than silently disappearing',()=>{const p=parseSocialPlan('{"contacts":[],"groups":[{"name":"同学群","members":["User","小林"]}]}',{user:'User'});assert.equal(p.groups.length,0);assert.match(p.diagnostics[0],/只识别到 1/)});
test('explicit group evidence triggers one recheck and completes group contacts',async()=>{const f=hostFixture();f.ctx.chat=[{name:'A',mes:'<phone group="同学群">小林：你好\n小陈：来了</phone>'}];let n=0;f.b.generateText=async()=>++n===1?'{"contacts":[],"groups":[]}':'{"contacts":[],"groups":[{"name":"同学群","members":["小林","小陈"],"reason":"正文明确正在群聊"}]}';const p=await f.host.generate();assert.equal(n,2);assert.equal(p.rechecked,true);assert.equal(p.groups[0].name,'同学群');assert.deepEqual(p.contacts.map(c=>c.name),['小林','小陈']);assert.equal(f.b.contacts().length,0)});

test('selected ordinary pending friend is accepted instead of silently skipped',async()=>{const{b,threads}=fixture();await b.socialRequest({name:'B',persona:'同事'});const result=await b.socialApply({scope:'card:A',contacts:[{name:'B'}],groups:[]},{contacts:['B']});assert.equal(result.contacts,1);assert.equal(result.skipped,0);assert.equal(b.socialWaiting('B'),false);assert.equal(threads.length,1)});
test('explicitly selected rejected ordinary account may be added again',async()=>{const{b}=fixture();await b.socialRequest({name:'B'});await b.socialDecide('B','reject');const result=await b.socialApply({scope:'card:A',contacts:[{name:'B'}],groups:[]},{contacts:['B']});assert.equal(result.contacts,1);assert.equal(b.socialEntry('B').state,'friend');assert.equal(b.contacts()[0].name,'B')});
test('blocked and alternate candidates give specific skip reasons and preserve blacklist',async()=>{const{b}=fixture();b.socialBlock('A');const result=await b.socialApply({scope:'card:A',contacts:[{name:'A'},{name:'小号',owner:'A',relationship:'unknown'}],groups:[]},{contacts:['A','小号']});assert.equal(result.skipped,2);assert.match(result.details[0].reason,/黑名单/);assert.match(result.details[1].reason,/依据/);assert.equal(b.socialBlocked('A'),true);assert.equal(b.contacts().length,0)});

test('historically established alternate friend is restored directly without unblocking owner',async()=>{const{b,threads}=fixture();b.socialBlock('A');const result=await b.socialApply({scope:'card:A',contacts:[{name:'望盼',owner:'A',relationship:'friend',evidence:'早就互加好友'}],groups:[]},{contacts:['望盼']});assert.equal(result.contacts,1);assert.equal(result.skipped,0);assert.equal(b.socialEntry('望盼').state,'friend');assert.equal(threads[0].members[0],'望盼');assert.equal(b.socialBlocked('A'),true)});
test('new application enters new friends and does not silently become an accepted contact',async()=>{const{b}=fixture();const result=await b.socialApply({scope:'card:A',contacts:[{name:'B',relationship:'pending',message:'请通过'}],groups:[]},{contacts:['B']});assert.equal(result.requests,1);assert.equal(result.contacts,0);assert.equal(b.contacts().length,0);assert.equal(b.socialEntry('B').state,'pending');await b.socialDecide('B','accept');assert.equal(b.contacts()[0].name,'B')});
test('old application cannot demote an established friend and unknown relation stays unadded',async()=>{const{b}=fixture();b.saveContact({name:'B'});const result=await b.socialApply({scope:'card:A',contacts:[{name:'B',relationship:'pending'},{name:'C',relationship:'unknown'}],groups:[]},{contacts:['B','C']});assert.equal(result.requests,0);assert.equal(result.skipped,1);assert.equal(b.socialWaiting('B'),false);assert.equal(b.contacts().some(c=>c.name==='C'),false)});
test('AI relation fields survive parsing separately from alternate ownership',()=>{const p=parseSocialPlan(JSON.stringify({contacts:[{name:'望盼',owner:'A',relationship:'friend',evidence:'早就加过'},{name:'B',relationship:'pending',evidence:'申请好友'}]}));assert.equal(p.contacts[0].relationship,'friend');assert.equal(p.contacts[0].owner,'A');assert.equal(p.contacts[1].relationship,'pending');assert.equal(p.contacts[0].evidence,'早就加过')});
test('upstream block action also enforces MyPhone account blacklist',async()=>{const{b}=fixture();b.saveContact({name:'B'});await TTSBackend.prototype.blockContact.call(b,'B');assert.equal(b.socialBlocked('B'),true);assert.throws(()=>b.socialAssert('B'),/黑名单/);const thread=(await b.threads())[0];assert.ok(thread.blocked);await TTSBackend.prototype.unblockContact.call(b,thread.id);assert.equal(b.socialBlocked('B'),false);assert.equal((await b.chats.get(thread.id)).blocked,null)});
test('upstream accepted request clears MyPhone blacklist as an explicit user action',async()=>{const{b}=fixture();b.saveContact({name:'B'});await TTSBackend.prototype.blockContact.call(b,'B');const thread=(await b.threads())[0];thread.blocked.requests=[{text:'请加回',at:1}];await TTSBackend.prototype.answerFriendRequest.call(b,thread.id,true);assert.equal(b.socialBlocked('B'),false);assert.equal(thread.blocked,null);assert.equal(thread.messages.some(m=>m.from==='B'&&m.text==='请加回'),true)});

test('phone records follow a chat, and home cannot see or clear another chat', async () => {
 const backend = Object.create(TTSBackend.prototype);
 const card = 'card:example.png', a = card + '#chat-a', b = card + '#chat-b';
 const rows = [{id:'a', space:card, save:a}, {id:'b', space:card, save:b}, {id:'old-card', space:card}, {id:'old-shared'}];
 const store = {list:async () => rows, get:async id => rows.find(row => row.id === id)};
 backend.settings = {chat: normalizeChat({...defaultChat(), partition:'none', firstSaves:{[card]:'chat-a'}})};
 backend.space = {key:'', name:'', members:[]};
 backend.chats = store;
 backend.moments = store;
 backend.apps = store;
 backend.emit = () => {};
 backend.assertOpen = () => {};
 const api = backend.api();
 const ids = async list => (await list()).map(row => row.id);
 assert.equal(backend.settings.chat.partition, 'chat');
 assert.deepEqual(await ids(api.listThreads), []);
 assert.deepEqual(await ids(api.listMoments), []);
 assert.equal(await api.getThread('a'), null);
 assert.equal(await api.getMoment('a'), null);
 assert.throws(() => backend.spaceTag(), /先打开/);
 assert.equal(await backend.clearHere(store.list, () => assert.fail('home must not delete records')), 0);
 backend.setSpace({key:card, save:'chat-a'});
 assert.deepEqual(await ids(api.listThreads), ['a','old-card']);
 assert.deepEqual(await ids(api.listMoments), ['a','old-card']);
 assert.equal(await api.getThread('b'), null);
 backend.setSpace({key:card, save:'chat-b'});
 assert.deepEqual(await ids(api.listThreads), ['b']);
 assert.deepEqual(await ids(api.listMoments), ['b']);
 assert.equal(await api.getMoment('a'), null);
 assert.deepEqual(backend.spaceTag(), {space:card, save:b});
 backend.setSpace(null);
 assert.deepEqual(await ids(api.listThreads), []);
 assert.deepEqual(await ids(api.listMoments), []);
 backend.setSpace({key:card, save:'chat-a'});
 assert.deepEqual(await ids(api.listMoments), ['a','old-card']);
});
import { createMomentsHost } from '../host-moments.js';

test('voice-only mode skips automatic Moments requests and blocks manual refresh', async () => {
 let enabled = false;
 let requests = 0;
 let reads = 0;
 const backend = {
  saveKey: () => 'card:a#story',
  here: () => ({key:'card:a#story'}),
  moments: {autoToday: async () => { reads++; return 0; }},
  generateText: async () => { requests++; return ''; }
 };
 const host = createMomentsHost({
  context: () => ({chat: []}), settings: () => ({moments:{auto:true, every:1, dailyMax:10}}),
  backend, enabled: () => enabled
 });
 for (let i = 0; i < 5; i++) await host.storyReplied();
 await assert.rejects(host.refresh(), /仅语音/);
 assert.equal(reads, 0);
 assert.equal(requests, 0);
 enabled = true;
 await host.storyReplied();
 assert.equal(reads, 1);
});
