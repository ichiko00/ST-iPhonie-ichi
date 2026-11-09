import test from 'node:test';
import assert from 'node:assert/strict';
import {DialoguePlayer} from '../core/player.js';
import {freshState} from '../core/state.js';
function fixture(){
 const settings=freshState();settings.routes=[{name:'A',voice:'v',engine:'fish'}];
 const events=[];
 const player=new DialoguePlayer({settings:()=>settings,providers:{},cache:{},sink:{unlock:async()=>{},stop(){},pause:async()=>{},resume:async()=>{},play:async b=>events.push('play:'+await b.text())},speech:{prime(){},stop(){},pause(){},resume(){},speak:async t=>events.push('speech:'+t)}});
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

test('15 second seek crosses measured segments and stops at unknown boundaries',()=>{
 const f=fixture();f.player.history=lines;f.player.queue=lines;f.player.index=1;f.player.phase='playing';f.player.sink.position=()=>4;
 for(const l of lines)f.player.durations.set(f.player.lineId(l),10);
 let target;f.player.jump=(...args)=>target=args;
 assert.equal(f.player.seekBy(-15),true);assert.deepEqual(target,[0,0]);
 f.player.seekBy(15);assert.deepEqual(target,[2,9]);
 f.player.durations.delete(f.player.lineId(lines[2]));f.player.seekBy(15);assert.deepEqual(target,[1,9.95]);
});
test('system narration does not pretend to support exact second seeking',()=>{
 const f=fixture();f.player.history=[{narration:true,text:'intro'}];f.player.queue=f.player.history;assert.equal(f.player.seekBy(15),false);
});
test('jump reuses session audio without calling synthesis again',async()=>{
 const f=fixture();await f.player.start(lines,()=>true,null,{prebuffer:true});
 const before=f.events.filter(x=>x.startsWith('make:')).length;
 await f.player.jump(0,3);
 assert.equal(f.events.filter(x=>x.startsWith('make:')).length,before);
});
test('startup buffer can be bypassed when the first audio is ready',async()=>{
 const f=fixture(),make=f.player.make;let release;
 f.player.sink.duration=async()=>5;
 f.player.make=async(line,...args)=>{if(line.text!=='one')await new Promise(r=>release=r);return make(line,...args);};
 const job=f.player.start(lines.slice(0,2),()=>true,null,{prebuffer:true});await tick();await tick();
 assert.equal(f.player.buffering,true);assert.deepEqual(output(f),[]);
 f.player.playNow=true;await new Promise(r=>setTimeout(r,100));assert.deepEqual(output(f),['play:one']);release();await job;
});

test('seeking while paused stays paused and does not play until resumed',async()=>{
 const f=fixture();await f.player.start(lines);f.player.phase='paused';
 const before=output(f).length,job=f.player.jump(1,2);await tick();
 assert.equal(f.player.phase,'paused');assert.equal(output(f).length,before);
 await f.player.toggle();await job;assert.deepEqual(output(f).slice(before),['play:two','play:three']);
});
test('full timeline seeking maps measured seconds to the correct segment',()=>{
 const f=fixture();f.player.history=lines;f.player.queue=lines;f.player.index=0;
 for(const l of lines)f.player.durations.set(f.player.lineId(l),10);
 let target;f.player.jump=(...args)=>target=args;
 assert.equal(f.player.transport().totalSeconds,30);f.player.seekTo(24);assert.deepEqual(target,[2,4]);
});

test('switching stepwise to full releases sentence boundary and continues including narration',async()=>{
 const f=fixture();const job=f.player.start([lines[0],{role:'narrator',narration:true,text:'scene'},lines[1]],()=>true,null,{stepwise:true});
 await tick();assert.equal(f.player.phase,'paused');assert.equal(f.player.boundary,true);assert.deepEqual(output(f),['play:one']);
 await f.player.setStepwise(false);await job;
 assert.deepEqual(output(f),['play:one','speech:scene','play:two']);assert.equal(f.player.phase,'idle');
});
test('changing reading mode preserves an explicit manual pause',async()=>{
 const f=fixture();f.player.phase='paused';f.player.boundary=false;f.player.stepwise=true;
 await f.player.setStepwise(false);assert.equal(f.player.phase,'paused');assert.equal(f.player.stepwise,false);assert.deepEqual(output(f),[]);
});
