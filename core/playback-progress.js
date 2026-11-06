import {storyHash} from './story-sync.js';
export const spokenSignature=lines=>JSON.stringify(lines.map(l=>[l.role||'',l.text||'',l.translation||'',l.emotion||'',l.effect||'']));
export function sameSpokenLines(a,b){return spokenSignature(a)===spokenSignature(b);}
export function playbackKey(snap,lines){return String(snap.chat)+'|'+String(snap.message.myPhoneFloorId||snap.message.extra?.myPhoneFloorId||snap.message.send_date||snap.id)+'|'+String(snap.swipe??0)+'|'+storyHash(spokenSignature(lines));}
const KEY='myphone-reading-progress-v1';
export function readingProgress(key,index){try{const data=JSON.parse(globalThis.localStorage?.getItem(KEY)||'{}');if(index===undefined)return Math.max(0,Math.floor(Number(data[key])||0));if(index===null)delete data[key];else data[key]=Math.max(0,Math.floor(index));const entries=Object.entries(data).slice(-200);globalThis.localStorage?.setItem(KEY,JSON.stringify(Object.fromEntries(entries)));}catch{}return 0;}
