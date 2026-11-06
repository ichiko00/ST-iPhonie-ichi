import {normalizeSocial} from './social.js';
export const SOCIAL_NOTE_ID='myphone-social-portable-v1';
export function attachSocialNote(library,social,at=Date.now()){
 const text='MY_PHONE_SOCIAL_V1\n'+JSON.stringify({format:1,social:normalizeSocial(social)});
 if(text.length>1000000)throw Error('社交状态超过兼容备忘录大小上限，请先减少历史申请后导出');
 library.notes=[...(library.notes||[]).filter(n=>n.id!==SOCIAL_NOTE_ID),{id:SOCIAL_NOTE_ID,title:'MyPhone 社交状态（互导请保留）',text,createdAt:at,updatedAt:at}];return library;
}
export function recoverSocialNote(settings,library){
 if(!settings||settings.chat?.social)return settings;
 const note=library.notes?.find(n=>n.id===SOCIAL_NOTE_ID&&typeof n.text==='string'&&n.text.startsWith('MY_PHONE_SOCIAL_V1\n'));
 if(!note)return settings;
 let value;try{value=JSON.parse(note.text.slice('MY_PHONE_SOCIAL_V1\n'.length));}catch{throw Error('MyPhone 社交状态附页损坏，请保留原文件后检查');}
 if(value?.format!==1||!value.social)throw Error('MyPhone 社交状态附页格式不支持');
 return {...settings,chat:{...settings.chat,social:normalizeSocial(value.social)}};
}
