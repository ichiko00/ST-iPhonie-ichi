import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function switchVoiceMode('),source.indexOf('function playWindowFull('));
const intro={role:'旁白',narration:true,text:'intro',readingIndex:0};
const a={role:'A',text:'one',uiIndex:0,readingIndex:1};
const middle={role:'旁白',narration:true,text:'middle',readingIndex:2};
const b={role:'B',text:'two',uiIndex:1,readingIndex:3};
const full=[intro,a,middle,b],step=[{...a,readingIndex:0},{...b,readingIndex:1}];
function setup(queue,index,{phase='playing',boundary=false}={}){
 const snap={id:1};let calls=[],refreshed=0;
 const player={queue,index,phase,boundary,sessionAudio:new Map(),durations:new Map(),lineId:JSON.stringify,transport:()=>({position:4}),start(lines,valid,settings,options){calls.push({lines,options});this.queue=lines;this.index=options.startIndex;this.phase='generating';this.stepwise=options.stepwise;},toggle(){this.phase='paused';},stop(){this.phase='idle';}};
 const deps={player,currentMessage:()=>snap,voiceUnchanged:()=>true,windowQueue:(snap,isStep)=>isStep?step:full,settings:{general:{wholePrebuffer:true}},playbackKey:()=>'',primeSpokenQueue:()=>{},voiceIsland:{refresh(){refreshed++;}},snap};
 const run=Function(...Object.keys(deps),'let voiceWindowStep=false,selectedMessage,playbackMessage=snap,readingKey;'+code+';return switchVoiceMode;')(...Object.values(deps));
 return {player,calls,run,refreshed:()=>refreshed};
}
test('full narration to step changes actual queue and immediately selects the next character',()=>{
 const f=setup(full,0);f.run(1,true);assert.deepEqual(f.calls[0].lines,step);assert.equal(f.calls[0].options.startIndex,0);assert.equal(f.calls[0].options.offset,0);assert.equal(f.calls[0].options.stepwise,true);assert.equal(f.player.queue[0].role,'A');assert.equal(f.refreshed(),1);
});
test('step to full restores narration and preserves current character audio offset',()=>{
 const f=setup(step,0);const key=JSON.stringify(step[0]);f.player.sessionAudio.set(key,{blob:'cached'});f.player.durations.set(key,10);f.run(1,false);
 const {lines,options}=f.calls[0];assert.deepEqual(lines,full);assert.equal(options.startIndex,1);assert.equal(options.offset,4);assert.equal(options.stepwise,false);assert.equal(options.session.audio.get(JSON.stringify(a)).blob,'cached');
});
test('step boundary to full starts with following narration instead of repeating the line',()=>{
 const f=setup(step,0,{phase:'paused',boundary:true});f.run(1,false);assert.equal(f.calls[0].options.startIndex,2);assert.equal(f.player.queue[2].text,'middle');assert.equal(f.player.phase,'generating');
});
test('manual pause remains paused across content-mode switch',()=>{
 const f=setup(full,1,{phase:'paused'});f.run(1,true);assert.equal(f.player.phase,'paused');assert.equal(f.calls[0].options.startIndex,0);
});
test('repeated switches keep changing queue and preserve the corresponding character',()=>{
 const f=setup(full,3);f.run(1,true);assert.deepEqual(f.player.queue,step);assert.equal(f.player.index,1);f.player.phase='playing';f.run(1,false);assert.deepEqual(f.player.queue,full);assert.equal(f.player.index,3);
});
