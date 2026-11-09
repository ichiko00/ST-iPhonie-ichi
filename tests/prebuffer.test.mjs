import test from 'node:test';
import assert from 'node:assert/strict';
import {DialoguePlayer} from '../core/player.js';
import {freshState} from '../core/state.js';
function fixture(){
 const settings=freshState();settings.routes=[{name:'A',voice:'v',engine:'fish'}];
 const events=[];
 const player=new DialoguePlayer({settings:()=>settings,providers:{},cache:{},sink:{unlock:async()=>{},stop(){},pause:async()=>{},resume:async()=>{},play:async b=>events.push('play:'+await b.text())},speech:{prime(){},stop(){},speak:async t=>events.push('speech:'+t)}});
 player.make=async(line,route)=>{events.push('make:'+line.text);return {key:line.text,blob:new Blob([line.text]),effective:route,request:{},fromCache:false};};
 return {player,events,settings};
}
const lines=[{role:'A',text:'one'},{role:'A',text:'two'},{role:'A',text:'three'}];

const tick=()=>new Promise(r=>setTimeout(r,0));
const output=f=>f.events.filter(e=>!e.startsWith('make:'));
test('first segment plays while later synthesis is still pending, with bounded concurrency and window',async()=>{
 const f=fixture(),make=f.player.make,resolvers=new Map();let active=0,max=0,releasePlay;
 f.settings.general.cacheEnabled=false;
 f.player.make=async(line,...args)=>{active++;max=Math.max(max,active);await new Promise(r=>resolvers.set(line.text,r));active--;return make(line,...args);};
 f.player.sink.play=async b=>{f.events.push('play:'+await b.text());await new Promise(r=>releasePlay=r);};
 const queue=Array.from({length:8},(_,i)=>({role:'A',text:String(i)}));
 const job=f.player.start(queue,()=>true,null,{prebuffer:true,ahead:true});
 await tick();assert.deepEqual([...resolvers.keys()],['0','1']);resolvers.get('0')();await tick();
 assert.deepEqual(output(f),['play:0']);assert.ok(resolvers.has('2'));
 resolvers.get('1')();resolvers.get('2')();await tick();resolvers.get('3')();await tick();
 assert.equal(resolvers.size,4);assert.equal(max,2);
 f.player.stop();releasePlay();await job;assert.equal(f.player.buffered.size,0);
});
test('all segments play in order and are synthesized once without persistent cache',async()=>{
 const f=fixture();f.settings.general.cacheEnabled=false;
 await f.player.start(lines,()=>true,null,{prebuffer:true,ahead:true});
 assert.deepEqual(output(f),['play:one','play:two','play:three']);
 for(const line of lines)assert.equal(f.events.filter(e=>e==='make:'+line.text).length,1);
 assert.equal(f.player.buffered.size,0);
});
test('system translation stays in order without being synthesized',async()=>{
 const f=fixture();await f.player.start([lines[0],{role:'narrator',text:'translation',narration:true,translationRead:true},lines[1]],()=>true,null,{prebuffer:true});
 assert.deepEqual(output(f),['play:one','speech:translation','play:two']);
 assert.ok(!f.events.includes('make:translation'));
});
test('engine narration and translations are included in rolling prebuffer',async()=>{
 const f=fixture();f.settings.narration.voice='role';f.settings.routes.push({name:'narrator',voice:'v',engine:'fish'});
 await f.player.start([lines[0],{role:'narrator',text:'translation',narration:true,translationRead:true}],()=>true,null,{prebuffer:true});
 assert.deepEqual(output(f),['play:one','play:translation']);assert.equal(f.events.filter(e=>e==='make:translation').length,1);
});
test('stop during preparation prevents playback and new requests',async()=>{
 const f=fixture(),make=f.player.make,releases=[];
 f.player.make=async(...args)=>{await new Promise(r=>releases.push(r));return make(...args);};
 const job=f.player.start(lines,()=>true,null,{prebuffer:true});await tick();
 assert.equal(releases.length,2);f.player.stop();releases.forEach(r=>r());await job;await tick();
 assert.deepEqual(output(f),[]);assert.equal(releases.length,2);assert.equal(f.player.buffered.size,0);
});
test('later generation failure does not block the first segment and reports at its playback position',async()=>{
 const f=fixture(),make=f.player.make;f.player.make=(line,...args)=>{if(line.text==='two')throw Error('offline');return make(line,...args);};
 await f.player.start(lines,()=>true,null,{prebuffer:true});assert.equal(f.player.phase,'error');assert.equal(f.player.message,'offline');assert.deepEqual(output(f),['play:one']);assert.equal(f.player.buffered.size,0);assert.ok(f.player.controller.signal.aborted);
});
test('disabled prebuffer retains immediate sequential playback',async()=>{
 const f=fixture();await f.player.start(lines);assert.deepEqual(f.events,['make:one','play:one','make:two','play:two','make:three','play:three']);
});
test('system narration can start immediately while character audio is pending',async()=>{
 const f=fixture(),make=f.player.make;let release;
 f.player.make=async(...args)=>{await new Promise(r=>release=r);return make(...args);};
 const job=f.player.start([{role:'narrator',narration:true,text:'intro'},lines[0]],()=>true,null,{prebuffer:true});await tick();
 assert.deepEqual(output(f),['speech:intro']);release();await job;assert.deepEqual(output(f),['speech:intro','play:one']);
});
