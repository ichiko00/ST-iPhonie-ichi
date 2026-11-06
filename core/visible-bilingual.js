import {splitBilingual} from './bilingual.js';import {voiceDisplay} from './voice-display.js';
const unquote=s=>String(s||'').trim().replace(/^[「『“"']([\s\S]*)[」』”"']$/u,'$1').trim();
const comparable=s=>voiceDisplay(s).normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'');
// Only repair a tag when its adjacent, visible bilingual quote proves which language belongs in each field.
export function alignVisibleBilingual(raw,lines){let previousEnd=0;return lines.map(line=>{const floor=previousEnd;previousEnd=line.end;const relative=String(raw).slice(line.start,line.end).search(/<tts\b/i),start=relative<0?-1:line.start+relative;if(start<line.start||start>=line.end)return line;const prefix=String(raw).slice(floor,start),match=prefix.match(/([「『“"])([^「」『』“”"\n]+)([」』”"])\s*([（(])([^\n]*?)([）)])(?:\s*([「『“"])([^「」『』“”"\n]+)([」』”"]))?\s*$/u);if(!match)return line;
 const original=unquote(match[2]),translation=unquote(match[5]),pair=splitBilingual(original+'（'+translation+'）');if(!pair.translation||(match[8]&&comparable(match[8])!==comparable(translation)))return line;
 const spoken=comparable(line.text),isOriginal=spoken===comparable(original),isChinese=spoken===comparable(translation);if(!isOriginal&&!isChinese)return line;
 const directives=isChinese?String(line.text).match(/^\s*(?:\[[^\]]+\]\s*)+/)?.[0]?.trim()||'':'';
 const display=match[8]?match[0].slice(0,match[0].lastIndexOf(match[7]+match[8]+match[9])).trimEnd():match[0].trim();
 return{...line,start,visibleText:display,displayStart:floor+match.index,tagOnly:true,translation,text:isOriginal?line.text:(directives?directives+' ':'')+original,visibleBilingual:true};});}
