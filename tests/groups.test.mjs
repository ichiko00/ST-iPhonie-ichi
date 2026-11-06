import test from 'node:test';import assert from 'node:assert/strict';
import {parseGroupEvents,memberChange,MEMBERSHIP_HINT} from '../core/group-social.js';
import {attachSocialNote,recoverSocialNote,SOCIAL_NOTE_ID} from '../core/social-transfer.js';
import {writeBackup,readBackup} from '../core/backup.js';
import {normalizeSocial} from '../core/social.js';
import {createGroupHost} from '../host-groups.js';
import {pathToFileURL} from 'node:url';
const groups=[{id:'g1',name:'同学群',members:['小林','小陈']}];
const event=(quote,action='join',member='小满')=>JSON.stringify({events:[{group:'同学群',member,action,evidence:quote}]});
test('member additions are deduplicated and removals preserve other members',()=>assert.deepEqual(memberChange(['A','B'],{add:['C','C'],remove:['A']}),{members:['B','C'],added:['C'],removed:['A']}));
test('a no-op has no added/removed members and needs no notice',()=>assert.deepEqual(memberChange(['A','B'],{add:['A'],remove:['C']}),{members:['A','B'],added:[],removed:[]}));
test('group cannot exceed 20 characters or lose its last member',()=>{assert.throws(()=>memberChange(['A'],{remove:['A']}),/至少保留/);assert.throws(()=>memberChange(Array.from({length:20},(_,i)=>'N'+i),{add:['extra']}),/20/)});
test('one character remaining stays representable by upstream backup format',()=>assert.deepEqual(memberChange(['A','B'],{remove:['A']}).members,['B']));
test('only completed source-backed joins are accepted',()=>{const text='系统提示：小满已加入了同学群。';assert.equal(parseGroupEvents(event(text),{groups,text}).length,1);assert.equal(parseGroupEvents(event(text),{groups,text:'无关正文'}).length,0)});
test('future plans and declined or pending invitations cannot change membership',()=>{for(const text of ['小满想加入同学群','小满明天加入同学群','小满即将加入同学群','小满申请加入同学群','小满没有加入同学群'])assert.equal(parseGroupEvents(event(text),{groups,text}).length,0)});
test('an actual exit is recognized without deleting history',()=>{const text='小陈退出了同学群。';assert.equal(parseGroupEvents(event(text,'leave','小陈'),{groups,text})[0].action,'leave')});
test('ambiguous duplicate group names or nonexistent groups are rejected',()=>{const text='小满加入了同学群';assert.equal(parseGroupEvents(event(text),{groups:[...groups,{...groups[0],id:'g2'}],text}).length,0);assert.equal(parseGroupEvents(event(text),{groups:[],text}).length,0)});
test('user is not treated as a removable character',()=>{const text='User加入了同学群';assert.equal(parseGroupEvents(event(text,'join','User'),{groups,text,user:'User'}).length,0)});
test('hint detection works with system joins and long group names',()=>{assert.ok(MEMBERSHIP_HINT.test('同学群\n系统：小满加入了聊天'));assert.ok(MEMBERSHIP_HINT.test('小满退出了今天一起去野餐的所有同学临时讨论群'))});
test('social note survives old-style normal note fields',()=>{const library=attachSocialNote({}, {entries:[{name:'A',scope:'card:A',state:'blocked'}],autoGroups:false});const notes=library.notes.map(({id,title,text,createdAt,updatedAt})=>({id,title,text,createdAt,updatedAt}));const s=recoverSocialNote({chat:{}},{notes});assert.equal(s.chat.social.entries[0].state,'blocked');assert.equal(s.chat.social.autoGroups,false)});
test('sidecar does not override newer native social settings',()=>{const library=attachSocialNote({}, {entries:[{name:'A',state:'blocked'}]});const settings={chat:{social:normalizeSocial()}};assert.equal(recoverSocialNote(settings,library),settings)});
test('sidecar export updates one note rather than duplicating it',()=>{const library=attachSocialNote({},{});attachSocialNote(library,{});assert.equal(library.notes.filter(n=>n.id===SOCIAL_NOTE_ID).length,1)});
test('MyPhone backup round-trips through actual installed original iPhonie reader and writer',async()=>{
 const base=(process.env.IPHONIE_UPSTREAM_DIR || (process.env.APPDATA+'/com.tauritavern.client/data/extensions/third-party/ST-iPhonie'))+'/';
 const original=await import(pathToFileURL(base+'core/backup.js').href),chat=await import(pathToFileURL(base+'core/chat.js').href);
 const library=attachSocialNote({}, {entries:[{name:'小林',scope:'card:A',state:'blocked'}],autoGroups:false});
 const groups=[{id:'G',type:'group',name:'同学群',members:['小陈'],messages:[{id:'M',from:'me',kind:'system',text:'「小林」退出了群聊',at:10}],createdAt:1,updatedAt:10}];
 const first=await writeBackup({settings:{chat:{social:normalizeSocial({entries:[{name:'小林',scope:'card:A',state:'blocked'}]})}},library,chats:groups});
 const imported=await original.readBackup(first);assert.equal(imported.chats[0].members[0],'小陈');assert.match(imported.chats[0].messages[0].text,/退出/);
 imported.settings.chat=chat.normalizeChat(imported.settings.chat);assert.equal(imported.settings.chat.social,undefined);
 const next=await original.writeBackup({settings:imported.settings,library:imported.library,chats:imported.chats});
 const returned=await readBackup(next);assert.equal(returned.settings.chat.social.entries[0].state,'blocked');assert.equal(returned.settings.chat.social.autoGroups,false);assert.deepEqual(returned.chats,groups);
});
function mockHost(text){let s={autoGroups:true,groupEvents:[]},calls=0,changes=0;const ctx={name1:'User',chat:[{mes:text}],getCurrentChatId:()=> 'chat1'};
 const b={socialData:()=>s,socialScope:()=> 'card:A',cardKey:()=> 'card:A',saveKey:()=>'',threads:async()=>groups.map(g=>({...g,type:'group'})),contacts:()=>[{name:'小满'}],generateText:async()=>{calls++;return event(text)},socialGroupMembers:async()=>{changes++;return{added:['小满'],removed:[]}},socialWrite:f=>f(s)};
 return{ctx,b,host:createGroupHost({context:()=>ctx,backend:b}),calls:()=>calls,changes:()=>changes};}
test('story scanner updates once and idempotently records processed text',async()=>{const f=mockHost('小满加入了同学群');await f.host.scan(0);await f.host.scan(0);assert.equal(f.calls(),1);assert.equal(f.changes(),1)});
test('ordinary group conversation does not make an extra membership request',async()=>{const f=mockHost('同学群 小林：今天吃什么？');await f.host.scan(0);assert.equal(f.calls(),0)});
test('turning group sync off prevents automatic model requests',async()=>{const f=mockHost('小满加入了同学群');f.b.socialData().autoGroups=false;await f.host.scan(0);assert.equal(f.calls(),0)});
test('disposed group scanner cannot apply late generated membership',async()=>{const f=mockHost('小满加入了同学群');let resolve;f.b.generateText=()=>new Promise(r=>resolve=r);const job=f.host.scan(0);await new Promise(r=>setTimeout(r,0));f.host.dispose();resolve(event('小满加入了同学群'));await job;assert.equal(f.changes(),0)});

import {groupMembersPanel} from '../ui/chat-group-members.js';
test('member info renders compact grid, user and separate management controls',async()=>{
 let html='';const body={set innerHTML(v){html=v},addEventListener(){}};const ctx={api:{getThread:async()=>({id:'G',type:'group',name:'同学群',members:['小林','小陈']}),chatContacts:()=>[{name:'小林'},{name:'小陈'},{name:'小满'}],socialSnapshot:()=>({entries:[]}),socialGroupScan:()=>{},userName:()=> 'User'},dialog:()=>({body,close(){}})};
 await groupMembersPanel(ctx,'G',()=>{});assert.match(html,/User（你）/);assert.match(html,/mp-member-grid/);assert.match(html,/data-person="小林"/);assert.match(html,/data-gm="add"/);assert.match(html,/data-gm="remove"/);assert.doesNotMatch(html,/list-row/);assert.match(html,/根据最新正文同步/);
});
