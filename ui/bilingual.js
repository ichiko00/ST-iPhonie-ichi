import {splitBilingual} from '../core/bilingual.js';
import {esc} from './common.js';
export function bilingualHTML(text,translation='',enabled=true){
 const pair=enabled?splitBilingual(text,translation):{original:String(text||''),translation:''};
 return pair.translation?`<span class="bilingual-original" dir="auto">${esc(pair.original)}</span><span class="bilingual-translation" dir="auto">${esc(pair.translation)}</span>`:esc(pair.original);
}
