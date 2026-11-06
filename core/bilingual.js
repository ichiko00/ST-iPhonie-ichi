// Display-only detection: never translate or rewrite stored user/model content.
const han=s=>(s.match(/\p{Script=Han}/gu)||[]).length;
const foreign=s=>/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(s)||((s.match(/\p{Script=Latin}/gu)||[]).length>1&&han(s)===0);
const unwrap=s=>String(s||'').trim().replace(/^(?:中文(?:翻译|译文)?|中译|翻译|译文)\s*[:：]\s*/,'');
const chinese=s=>han(s)>0&&!/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s)&&! /^(?:微笑|笑|轻笑|苦笑|叹气|停顿|沉默|点头|摇头|小声|低声|轻声|大笑|眨眼|脸红|笑着|哭|哭泣|语气.*)$/.test(s);
export function splitBilingual(value,translation=''){
 const raw=String(value||'').trim(),explicit=unwrap(translation);
 if(explicit&&explicit!==raw&&foreign(raw)&&chinese(explicit))return{original:raw,translation:explicit};
 const lines=raw.split(/\r?\n/).filter(s=>s.trim());
 if(lines.length>1){const parts=lines.map(s=>splitBilingual(s));if(parts.every(p=>p.translation))return{original:parts.map(p=>p.original).join('\n'),translation:parts.map(p=>p.translation).join('\n')};}
 const clean=raw.replace(/[。.!！?？…]+$/u,'').trimEnd(),close=clean.at(-1),open=close===')'?'(':close==='）'?'（':null;
 if(!open)return{original:raw,translation:''};
 let depth=0,start=-1;for(let i=clean.length-1;i>=0;i--){if(clean[i]===close)depth++;if(clean[i]===open&&--depth===0){start=i;break;}}
 if(start<1)return{original:raw,translation:''};const original=clean.slice(0,start).trim(),translated=unwrap(clean.slice(start+1,-1));
 return foreign(original)&&chinese(translated)?{original,translation:translated}:{original:raw,translation:''};
}
