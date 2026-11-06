// Display-only cleanup; keep the original text intact for the speech provider.
export const voiceDisplay = value => String(value || '').replace(/\[(?:[a-z][a-z0-9 _'’:,=.\/-]*|停顿|轻声|笑|叹气)\]/gi, '').replace(/<\/?(?:break|prosody|emotion|speak|voice|express-as)\b[^>]*>/gi, '').replace(/ {2,}/g, ' ').trim();
export async function unheardQueue(lines,index,state){
 if(!lines[index])return [];
 if(await state(lines[index])==='played')return [lines[index]];
 const queue=[];
 for(let i=index;i<lines.length;i++){if(await state(lines[i])==='played')break;queue.push(lines[i]);}
 return queue;
}
