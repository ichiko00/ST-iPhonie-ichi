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
test('whole reply is ready before first playback and each segment is made once even without persistent cache',async()=>{
 const f=fixture();f.settings.general.cacheEnabled=false;
 await f.player.start(lines,()=>true,null,{prebuffer:true,ahead:true});
 assert.deepEqual(f.events,['make:one','make:two','make:three','play:one','play:two','play:three']);assert.equal(f.player.buffered.size,0);
});
test('system translation stays in order without being synthesized',async()=>{
 const f=fixture();await f.player.start([lines[0],{role:'narrator',text:'translation',narration:true,translationRead:true},lines[1]],()=>true,null,{prebuffer:true});
 assert.deepEqual(f.events,['make:one','make:two','play:one','speech:translation','play:two']);
});
test('engine narration and translations are included in prebuffer',async()=>{
 const f=fixture();f.settings.narration.voice='role';f.settings.routes.push({name:'narrator',voice:'v',engine:'fish'});
 await f.player.start([lines[0],{role:'narrator',text:'translation',narration:true,translationRead:true}],()=>true,null,{prebuffer:true});
 assert.deepEqual(f.events,['make:one','make:translation','play:one','play:translation']);
});
test('stop during preparation prevents playback and later synthesis',async()=>{
 const f=fixture(),make=f.player.make;let release;
 f.player.make=async(...args)=>{await new Promise(r=>release=r);return make(...args);};
 const job=f.player.start(lines,()=>true,null,{prebuffer:true});
 while(!release)await new Promise(r=>setTimeout(r,0));f.player.stop();release();await job;
 assert.deepEqual(f.events,['make:one']);assert.equal(f.player.buffered.size,0);
});
test('generation failure reports error without partial playback',async()=>{
 const f=fixture(),make=f.player.make;f.player.make=(line,...args)=>{if(line.text==='two')throw Error('offline');return make(line,...args);};
 await f.player.start(lines,()=>true,null,{prebuffer:true});assert.equal(f.player.phase,'error');assert.equal(f.player.message,'offline');assert.deepEqual(f.events,['make:one']);assert.equal(f.player.buffered.size,0);
});
test('disabled prebuffer retains immediate sequential playback',async()=>{
 const f=fixture();await f.player.start(lines);assert.deepEqual(f.events,['make:one','play:one','make:two','play:two','make:three','play:three']);
});
