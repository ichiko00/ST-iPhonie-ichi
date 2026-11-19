import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatHost} from '../host-chat.js';
import {defaultChat} from '../core/chat.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({read,generate,friend}={}) {
 const thread={id:'one',type:'dm',members:['A'],messages:[],friend};
 const chat=defaultChat();chat.presets[0].lore=false;
 const settings={chat,routes:[],general:{},text:{source:'tavern'},promptRules:{'chat-forum':{enabled:false},'chat-groups':{enabled:false}}};
 const events=[],writes=[];let calls=0;
 const backend={chats:{get:read|| (async()=>structuredClone(thread)),append:async(id,items)=>{const added=items.map((item,i)=>({...item,id:'m'+(writes.length+i)}));writes.push(...added);thread.messages.push(...added);return structuredClone(thread);}},
  contacts:()=>[{name:'A'}],socialEntry:()=>null,socialAssert:()=>{},socialScopeFor:()=>'',voiceFormat:()=>'',here:()=>'',socialSnapshot:()=>({entries:[]}),
  generateText:async(...args)=>{calls++;return generate(...args)},emit:(type,event)=>events.push({type,...event}),chatMutate:async(id,fn)=>fn(),subscribe:()=>{},socialFilter:async(t,items)=>items};
 const host=createChatHost({context:()=>({name1:'U',chat:[],chatId:'story'}),settings:()=>settings,backend,notice:()=>{},storage:null});
 return {host,events,writes,calls:()=>calls};
}
test('stop releases a chat even if the model ignores AbortSignal; late response is discarded',async()=>{
 const pending=deferred();const f=fixture({generate:()=>pending.promise});
 const job=f.host.reply('one');const rejected=assert.rejects(job,{name:'AbortError'});await tick();assert.equal(f.calls(),1);
 f.host.cancel('one');await rejected;assert.equal(f.host.typing('one'),false);assert.equal(f.events.at(-1).typing,false);
 pending.resolve('A：迟到的消息');await tick();assert.equal(f.writes.length,0);
});
test('cancel during context loading never starts generation, and retry stays cancellable',async()=>{
 const reading=deferred(),answer=deferred();let reads=0;
 const f=fixture({read:()=>++reads===1?reading.promise:Promise.resolve({id:'one',type:'dm',members:['A'],messages:[]}),generate:()=>answer.promise});
 const old=f.host.reply('one');const oldRejected=assert.rejects(old,{name:'AbortError'});await tick();f.host.cancel('one');await oldRejected;
 const fresh=f.host.reply('one');const freshRejected=assert.rejects(fresh,{name:'AbortError'});await tick();assert.equal(f.calls(),1);
 reading.resolve({id:'one',type:'dm',members:['A'],messages:[]});await tick();assert.equal(f.calls(),1);assert.equal(f.host.typing('one'),true);
 f.host.cancel('one');await freshRejected;assert.equal(f.host.typing('one'),false);answer.reject(Error('late network failure'));await tick();
});
test('cancelAll releases all chat requests',async()=>{
 const f=fixture({generate:()=>new Promise(()=>{})});const a=f.host.reply('one'),b=f.host.reply('two');const checks=[assert.rejects(a,{name:'AbortError'}),assert.rejects(b,{name:'AbortError'})];await tick();f.host.cancelAll();await Promise.all(checks);assert.equal(f.host.typing('one'),false);assert.equal(f.host.typing('two'),false);
});
test('friend verification uses the same stop button and ignores late acceptance',async()=>{
 const pending=deferred(),f=fixture({friend:{by:'them'},generate:()=>pending.promise});const job=f.host.askFriend('one','hello');const rejected=assert.rejects(job,{name:'AbortError'});await tick();assert.equal(f.calls(),1);f.host.cancel('one');await rejected;assert.equal(f.host.typing('one'),false);const before=f.writes.length;pending.resolve('A：[通过好友申请]');await tick();assert.equal(f.writes.length,before);
});

test('a successful reply still saves and notifies exactly once',async()=>{
 const f=fixture({generate:async()=> 'A：你好'});const saved=await f.host.reply('one');assert.equal(saved.id,'one');assert.equal(f.writes.length,1);assert.equal(f.writes[0].text,'你好');assert.equal(f.events.filter(e=>e.incoming).length,1);assert.equal(f.host.typing('one'),false);
});
import {TTSBackend} from '../core/backend.js';
test('cancelled tavern generation cannot launch an empty-answer streaming retry',async()=>{
 const controller=new AbortController();let listener,retries=0;
 const fake={settings:{text:{source:'tavern'}},requestLog:{add:()=>0,finish:()=>{}},streamTavern:()=>{retries++;}};
 const ctx={eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'ready'},eventSource:{on:(event,fn)=>listener=fn,removeListener:()=>{}},generateRaw:async outgoing=>{listener({type:'quiet',messages:outgoing.prompt});controller.abort();return '';}};
 await assert.rejects(TTSBackend.prototype.generateTextRaw.call(fake,ctx,{prompt:[{role:'user',content:'hello'}]},controller.signal),{name:'AbortError'});assert.equal(retries,0);
});
test('streaming retry passes AbortSignal to fetch',async()=>{
 const controller=new AbortController();let received;
 const fake={textFetch:async(url,options)=>{received=options.signal;return {ok:true,body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));c.close();}})}}};
 const result=await TTSBackend.prototype.streamTavern.call(fake,{getRequestHeaders:()=>({})},{},controller.signal);assert.equal(received,controller.signal);assert.equal(result,'ok');
});
