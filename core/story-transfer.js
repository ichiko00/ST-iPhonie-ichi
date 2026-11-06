import {validateStoryArchives} from './story-sync.js';
const PREFIX='myphone-story-portable-v1-';
export function attachStoryNotes(library,archives){
 const data=JSON.stringify({format:1,archives:validateStoryArchives(archives)}),size=600000,total=Math.max(1,Math.ceil(data.length/size)),at=Date.now();
 library.notes=(library.notes||[]).filter(n=>!String(n.id).startsWith(PREFIX));
 for(let index=0;index<total;index++)library.notes.push({id:PREFIX+String(index).padStart(5,'0'),title:`MyPhone 楼层关联归档 ${index+1}/${total}（互导请保留）`,text:JSON.stringify({kind:'myphone-story',format:1,index,total,data:data.slice(index*size,(index+1)*size)}),createdAt:at,updatedAt:at});
 return library;
}
export function recoverStoryNotes(library){
 const notes=(library.notes||[]).filter(n=>String(n?.id).startsWith(PREFIX));if(!notes.length)return null;
 const chunks=notes.map(n=>{let v;try{v=JSON.parse(n.text);}catch{throw Error('楼层关联归档附页损坏');}if(v?.kind!=='myphone-story'||v.format!==1||typeof v.data!=='string'||!Number.isInteger(v.index)||!Number.isInteger(v.total)||v.total<1||v.total>1000)throw Error('楼层关联归档附页格式错误');return v;}).sort((a,b)=>a.index-b.index);
 if(chunks.length!==chunks[0].total||chunks.some((c,i)=>c.index!==i||c.total!==chunks.length))throw Error('楼层关联归档附页缺失，未自动回滚聊天；请使用完整备份');
 let value;try{value=JSON.parse(chunks.map(c=>c.data).join(''));}catch{throw Error('楼层关联归档内容损坏');}if(value?.format!==1)throw Error('楼层关联归档版本不支持');return validateStoryArchives(value.archives);
}
