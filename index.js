import {replacePhoneBlocks} from './core/phone-blocks.js';
import {withReadTranslations} from './core/translation-reading.js';
import {sameSpokenLines,playbackKey,readingProgress} from './core/playback-progress.js';
let readingKey=null;
import {createStoryFinalizer} from './core/story-finalizer.js';
let storyFinalizer=null;
import {resolveStoryClock} from './core/story-clock.js';
const freshCallSources=new Set();
import {unheardQueue} from './core/voice-display.js';
import {installDiagnostics} from './core/runtime-diagnostics.js';
import {probeStorage} from './core/idb.js';
import {createStoryTools} from './host-tools.js';
import {saveFile} from './download.js';
import './core/compat.js';
import {withRoles} from './core/routes.js';
import {readingPlan,browserSpeech,NARRATOR} from './core/narration.js';
import {createNoteIsland,watchMoments} from './note-island.js';
import { TTSBackend } from './core/backend.js';
import { modelRules, NAMESPACE } from './core/state.js';
import { DEFAULT_FORMAT, parseDialogue, renderDialogue, plainDialogue, promptPlan, isPlaceholderRole, knownFormats, dialogueProblems, escapeHTML, unwaveFramed, markDialogue, waveMarks, unmark, KEEP_REPLY } from './core/protocol.js';
import { FloatingPlayer } from './core/floating.js';
import { renderPictures, drawPromptPlan, tavernPicture } from './core/draw.js';
import { outgoingChat, storyReply } from './core/outgoing.js';
import { createPictureHost } from './host-pictures.js';
import {publicApi, registerDrawCommand} from './host-public.js';
import {createStoryCalls} from './host-story-calls.js';
let storyCalls=null;
import {createStorySync} from './host-story-sync.js';
let storySync=null;
import {createGroupHost} from './host-groups.js';
let groupHost=null;
import {createSocialHost} from './host-social.js';
let socialHost=null;
import { createChatHost } from './host-chat.js';
import { createMomentsHost } from './host-moments.js'; import { createWardrobeHost } from './host-wardrobe.js'; import { withoutOutfits } from './core/wardrobe.js'; import { createGeneratorHost } from './host-generator.js';
import { loreBooks } from './host-lore.js';
import { createAppsHost } from './host-apps.js';
import { readAssistantFiles } from './assistant-files.js';
import { createAssistantHost } from './host-assistant.js';
import { createCallHost } from './host-call.js';
import { createMemoryHost } from './host-memory.js';
import { createVoiceHost } from './host-voices.js';
import { createSoundHost } from './host-sounds.js';
import { renderSounds } from './core/sounds.js';
import { withMarks, lineEffect } from './core/voice-fx.js';
import { createCallIsland } from './call-island.js';
import { createMessageIsland } from './msg-island.js';
import { createMusicHost } from './host-music.js';
import { createMusicIsland } from './music-island.js';
import { createVoiceIsland } from './voice-island.js';
import { renderBgm } from './core/music.js';
import { TIER_NAMES } from './core/novelai.js';
import { createVnHost } from './host-vn.js';
import { createBookHost } from './host-book.js';
import { createSongHost } from './host-song.js';
const base=new URL('.',import.meta.url),marker=globalThis.crypto?.randomUUID?.()||'unavailable';
let stopDiagnostics=null;
let active=false,hooked=false,settings,player,panel,frame,observer,renderTimer,floating,lineRaf,lineMedia,playbackMessage,selectedMessage,backend,enabling;
let songHost=null,musicHost=null,musicIsland=null,voiceIsland=null,pendingApp=null,renderEpoch=0,pictures=null,chats=null,momentsHost=null,wardrobeHost=null,generatorHost=null,appsHost=null,assistantHost=null,callHost=null,callIsland=null,msgIsland=null,pendingThread=null,memoryHost=null,voiceHost=null,soundHost=null,pendingDraw=null,legacy=false;
let voiceWindowMessage=null,voiceWindowTail=null;
let dialogueMessage=null,dialogueRevision=0,speech=null,noteIsland=null,momentsWatch=null,vnHost=null,bookHost=null,storyTools=null;
const listeners=[],prompts=new Set();
// Every copy of the plugin that loads adds its folder here, so the self-check can tell when it is installed twice.
(globalThis.__myPhoneAppCopies??=new Set()).add(decodeURIComponent(base.pathname.replace(/\/$/,'').split('/').pop()));
// The latest notices and errors, for the self-check.
const recent=[];function remember(message,kind='notice'){recent.push({at:Date.now(),kind,message:String(message||'').slice(0,300)});if(recent.length>12)recent.shift();}
const context=()=>globalThis.SillyTavern?.getContext();
// The settings as the open card sees them (core/backend.js seen): whoever finds a role by its name reads these.
const seen=()=>backend?.seen||settings;
// Generation interceptor (manifest generate_interceptor): picture blocks and voice tags stay in the chat but are left
// out of the messages sent to the model, so they cost no tokens and users need no regex. The newest voiced reply keeps
// its tags while voice is on, as an example of the format. Replaced, never mutated.
globalThis.myPhoneAppInterceptor=function(chat){if(!active)return;let list=[];try{list=formats();}catch{}outgoingChat(chat,{pictures:settings?.draw?.strip!==false,voice:settings?.general?.stripVoice!==false,keepLatest:voiceOn()&&settings?.general?.voiceExample===true,formats:list});};
// A call while the phone is closed: a note that stays until answered, and a tap on it opens the phone on the call.
function ringing(name){if(voiceOnly()||panel?.open)return;remember(name+' 来电');const open=()=>openPanel();if(globalThis.toastr)globalThis.toastr.info('点这里打开小手机接听',`📞 ${name} 来电`,{timeOut:settings?.calls?.ring*1000||30000,extendedTimeOut:0,tapToDismiss:true,onclick:open});else console.info('[MyPhone]',name+' 来电');}
// The tavern's own avatars, for the phone: each character card's picture by name, and the current persona's.
let personas=null;import(new URL('../../../personas.js',import.meta.url).href).then(m=>{personas=m;}).catch(()=>{});
/** 分区: the character card (or group) open in the tavern, {key, name, members}; key '' when none is open. */
/** 分区 按聊天: this tavern chat's own mark, kept in the chat itself so that renaming it changes nothing and a new chat has none. */
function chatSave(){const ctx=context(),meta=ctx?.chatMetadata;if(!meta||!ctx.getCurrentChatId?.())return '';if(!meta.myPhoneAppSave){meta.myPhoneAppSave=Date.now().toString(36)+Math.random().toString(36).slice(2,10);ctx.saveMetadataDebounced?.();}return String(meta.myPhoneAppSave);}
function voiceOnly(){
 const ctx=context();
 return !!(ctx?.getCurrentChatId?.() && ctx.chatMetadata?.myPhoneVoiceOnly===true);
}
function paintVoiceOnly(){
 const toggle=document.querySelector('#myphone-voice-only');
 if(toggle){toggle.checked=voiceOnly();toggle.disabled=!context()?.getCurrentChatId?.();}
 const button=document.querySelector('#myphone-open');
 if(button)button.textContent=voiceOnly()?'打开配音设置':'打开小手机';
}
function setVoiceOnly(on){
 const ctx=context();
 if(!ctx?.getCurrentChatId?.()||!ctx.chatMetadata)return;
 if(on)ctx.chatMetadata.myPhoneVoiceOnly=true;
 else delete ctx.chatMetadata.myPhoneVoiceOnly;
 ctx.saveMetadataDebounced?.();
 if(on)stopPhoneWork();
 paintVoiceOnly();
 backend.emit('voice-only',{on});
 syncFloating();
 inject();
}
function stopPhoneWork(){
 storyFinalizer?.cancel();
 socialHost?.cancel();
 chats?.cancelAll();
 momentsHost?.cancel();
 callHost?.dispose();
 callIsland?.refresh();
 msgIsland?.dismiss();
 noteIsland?.dismiss();
 pendingThread=null;
 pendingApp=null;
}
function openSpace(){const card=openCard(),save=card.key?chatSave():'';return save?{...card,save}:null;}
function openCard(){const ctx=context();if(ctx?.groupId!==undefined&&ctx?.groupId!==null&&ctx.groupId!==''){const g=ctx.groups?.find(x=>String(x?.id)===String(ctx.groupId));const members=(g?.members||[]).map(a=>ctx.characters?.find(c=>c?.avatar===a)?.name).filter(Boolean);return {key:'group:'+ctx.groupId,name:g?.name||'群聊',members};}
 const c=ctx?.characters?.[ctx?.characterId];return c?.avatar?{key:'card:'+c.avatar,name:c.name||'',members:[c.name].filter(Boolean)}:{key:'',name:'',members:[]};}
/** The roles speaking in these story messages belong to the open card's contacts. */
// Characters met in a new reply without a voice get one picked ahead of playing (自动挑音色 on, voice on).
function voiceAhead(messages){if(!active||!voiceHost||settings.general.autoVoice!==true||!voiceOn())return Promise.resolve();const names=new Set();for(const m of messages){if(!m||m.is_user||m.is_system)continue;for(const line of parsed(String(m.mes||''))?.lines||[])if(line.role&&!isPlaceholderRole(line.role)&&!seen().routes.find(r=>r.name===line.role)?.voice)names.add(line.role);}return Promise.allSettled([...names].map(name=>voiceHost.pick(name).then(r=>notice(`给「${name}」挑好了音色：${r.autoName||r.voice}（自动挑的，在角色 App 里可以换）`))));}
// 提前生成: a new reply's lines are made one after another in the background and kept in the cache; nothing plays
// until a wave is tapped (then it is ready). picks: voices still being picked for its new characters, waited for.
let preparing=null;
async function prepareReply(id,picks=Promise.resolve()){if(!active||settings.general.pregenerate!==true||!voiceOn()||!settings.general.cacheEnabled)return;preparing?.abort();const control=new AbortController();preparing=control;
 try{await picks;}catch{}if(control.signal.aborted)return;const snap=currentMessage(Number(id));const lines=snap?messageLines(snap):[];if(!lines.length){if(preparing===control)preparing=null;return;}
 try{await player.prepare(lines,{signal:control.signal,valid:()=>active&&preparing===control&&unchanged(snap),each:()=>queueRender([snap.id])});}
 catch(error){if(!control.signal.aborted&&error?.name!=='AbortError')notice('提前生成语音没做完：'+error.message);}finally{if(preparing===control)preparing=null;}}
/** What a character said in the story lately (their lines' translations), for picking their voice. */
function saidBy(name){const out=[];for(const m of (context()?.chat||[]).slice(-40)){if(!m||m.is_user||m.is_system)continue;for(const line of parsed(String(m.mes||''))?.lines||[])if(line.role===name)out.push(line.translation||line.text);}return out.slice(-8);}
// Without voice tags a role is still met when the story names it (names of 2+ characters), also one met in other cards.
function tagSpeakers(messages){if(!active)return;const open=openSpace();if(!open)return;const key=`${open.key}#${open.save}`,names=new Set();if(!key)return;const unmet=(seen().routes||[]).filter(r=>!(Array.isArray(r.cards)&&r.cards.includes(key))&&r.name?.length>=2&&!isPlaceholderRole(r.name)).map(r=>r.name);for(const m of messages){if(!m||m.is_user||m.is_system)continue;const text=String(m.mes||'');for(const line of parsed(text)?.lines||[])if(line.role)names.add(line.role);for(const name of unmet)if(text.includes(name))names.add(name);}try{backend.tagRoles([...names],key);}catch{}}
/** A chat was opened: the phone follows the card, and the card's story speakers become its contacts. */
function spaceChanged(){if(!active||!backend)return;memoryHost?.refreshStory();try{backend.setSpace(openSpace());tagSpeakers((context()?.chat||[]).slice(-200));}catch{}}
function tavernAvatars(){const ctx=context(),thumb=(type,file)=>typeof ctx?.getThumbnailUrl==='function'?ctx.getThumbnailUrl(type,file):`/thumbnail?type=${type}&file=${encodeURIComponent(file)}`,characters={};
 for(const c of ctx?.characters||[])if(c?.name&&c.avatar&&c.avatar!=='none'&&!characters[c.name])characters[c.name]=thumb('avatar',c.avatar);
 const open=ctx?.characters?.[ctx?.characterId];if(open?.name&&open.avatar&&open.avatar!=='none')characters[open.name]=thumb('avatar',open.avatar);
 const persona=personas?.user_avatar;return {me:persona?thumb('persona',persona):'',characters};}
/** What a ComfyUI workflow written for the tavern's image generation may use: this chat's avatars, its own placeholders. */
function comfyPictures(){const ctx=context(),file=ctx?.characters?.[ctx?.characterId]?.avatar,persona=personas?.user_avatar;
 return {character:file&&file!=='none'?'/characters/'+encodeURIComponent(file):'',user:persona?'/User Avatars/'+encodeURIComponent(persona):'',placeholders:(ctx?.extensionSettings?.sd?.comfy_placeholders||[]).map(p=>({find:p?.find,replace:ctx.substituteParams?.(String(p?.replace??''))??p?.replace}))};}
// 保存到酒馆: the tavern user's own files (data/<user>/user/files), through the tavern's file API with its request headers.
function tavernFiles(){const headers=()=>({'Content-Type':'application/json',...(context()?.getRequestHeaders?.()||{})});
 const base64=async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(text);};
 return {async read(name,{blob=false}={}){const r=await fetch('/user/files/'+encodeURIComponent(name),{cache:'no-store'});if(r.status===404)return null;if(!r.ok)throw Error(`读不到酒馆里的 ${name}（${r.status}）`);return blob?r.blob():r.text();},
  async write(name,data){const r=await fetch('/api/files/upload',{method:'POST',headers:headers(),body:JSON.stringify({name,data:await base64(data instanceof Blob?data:new Blob([data]))})});if(!r.ok)throw Error(`酒馆没有存上 ${name}（${r.status}${r.status===413?'，文件太大':''}）`);},
  async remove(name){const r=await fetch('/api/files/delete',{method:'POST',headers:headers(),body:JSON.stringify({path:'user/files/'+name})});if(!r.ok&&r.status!==404)throw Error(`删不掉酒馆里的 ${name}（${r.status}）`);},
  // 视觉小说的立绘 (user/images) and 模型 (user/files) by their path, for backups. writePath puts a file back where it was
  // when the tavern lets it, and returns where it landed.
  async readPath(path){const r=await fetch('/'+String(path).replace(/^\//,''),{cache:'no-store'});if(r.status===404)return null;if(!r.ok)throw Error(`读不到酒馆里的 ${path}（${r.status}）`);return r.blob();},
  async hasPath(path){const url='/'+String(path).replace(/^\//,'');let r=await fetch(url,{method:'HEAD',cache:'no-store'});if(r.status===405)r=await fetch(url,{cache:'no-store'});return r.ok;},
  async removePath(path){const r=await fetch('/api/images/delete',{method:'POST',headers:headers(),body:JSON.stringify({path})});if(!r.ok&&r.status!==404)throw Error(`删不掉酒馆里的 ${path}（${r.status}）`);},
  async writePath(path,blob){const p=String(path).replace(/^\//,''),parts=p.split('/'),file=parts.pop();
   if(/^user\/files\//.test(p)){await this.write(file,blob);return p;}
   const ext=(file.match(/\.(\w+)$/)||[])[1]?.toLowerCase()||'png',folder=parts.slice(2).join('/');
   const r=await fetch('/api/images/upload',{method:'POST',headers:headers(),body:JSON.stringify({image:await base64(blob),format:ext==='jpeg'?'jpg':ext,filename:file.replace(/\.\w+$/,''),...(folder?{ch_name:folder}:{})})});
   if(!r.ok)throw Error(`立绘没能存回酒馆（${r.status}${r.status===413?'，文件太大':''}）`);return tavernPicture((await r.json()).path);}};}
const deviceName=()=>(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent||'')?'手机':'电脑')+' · '+browserName();
// Leaving the page (or switching away on a phone) saves what is waiting, so the other device sees it.
function flushSync(){if(document.visibilityState!=='hidden'||!backend)return;backend.ledger?.flush().catch(()=>{});if(backend.syncState?.pending)backend.syncNow().catch(()=>{});}
function notice(message){remember(message);if(globalThis.toastr)globalThis.toastr.info(message,'MyPhone');else console.info('[MyPhone]',message);}
function formats(){return knownFormats(settings);}
// 回复后单独配音 (core/voice-plan.js, run by the picture host with 回复后单独配图): the story request carries no voice rule;
// the lines are voiced after the reply, with the voice preset's prompt for the speakers of this chat.
const storyFormat=()=>settings.presets.find(p=>p.id===settings.activePreset)?.format||DEFAULT_FORMAT;
const voicePlan={wanted:()=>voiceOn()&&settings.general.voiceMode==='separate',has:text=>parsed(text).lines.length>0,format:storyFormat,
 rules:()=>{const only=speakers();return promptPlan(seen(),modelRules(seen(),only),only).map(p=>p.text).join('\n\n');},
 strip:text=>{const {lines}=parsed(text);let out='',at=0;for(const l of lines){out+=text.slice(at,l.start)+(l.tagOnly?'':'“'+l.translation+'”');at=l.end;}return out+text.slice(at);}};
// What a reply shows: picture tags become placeholders, sound tags small chips (left out while 音效 is off), voice lines
// become waves (or plain lines when voice is off).
const soundsOn=()=>settings?.sounds?.enabled===true;
// marks: the lines become marks now and waves after the card's regex and Markdown (waveMarks); lastRoles: their speakers.
let lastRoles=[],lastInner=[];const phoneNote=text=>replacePhoneBlocks(text,(m,attrs,inside)=>{const group=attrs.match(/group\s*=\s*["'“”「『]?([^"'“”」』>]+)/)?.[1]?.trim();const who=[...new Set(inside.split(/\n/).map(l=>l.match(/^\s*\**\s*[[【]?([^\]】:：\n]{1,40}?)[\]】]?\s*[:：]/)?.[1]?.trim()).filter(Boolean))];return !who.length?'':group?`<span class="myphone-phone-note">📱 群「${escapeHTML(group)}」里 ${escapeHTML(who.join('、'))} 说了话</span>`:`<span class="myphone-phone-note">📱 ${escapeHTML(who.join('、'))} 给你发了消息</span>`;});function transform(text,marks=false,id){const hidden=settings?.general?.hideStoryWaves===true;const out=renderBgm(renderSounds(renderPictures(phoneNote(withoutOutfits(text)),marker,{passive:hidden,pictures:context()?.chat?.[id]?.extra?.myphone_pics||{}}),marker,!hidden&&soundsOn()),marker,!hidden&&settings?.music?.bgm&&settings.music.bgm!=='off');const p=parsed(out);lastRoles=p.lines.map(l=>l.role);
 // 心声 (its emotion says so, or the preset's marks wrap it) is shown in the story's italics, not as a quoted line.
 lastInner=withMarks(out,p.lines,settings.presets.find(x=>x.id===settings.activePreset)?.marks).map(l=>lineEffect(l)==='inner');
 return p.lines.length?(storyWavesOn()?(marks?markDialogue(out,p.format,lastInner):renderDialogue(out,p.format,marker,lastInner)):plainDialogue(out,p.format)):out;}
// Remembered by text: every redraw of the chat reads each reply again, and long replies (HTML 小剧场) are slow to read.
const readings=new Map();function remembered(key,kind,fn){const list=formats().join('|'),hit=readings.get(key);if(hit&&hit.list===list&&kind in hit){readings.delete(key);readings.set(key,hit);return hit[kind];}const entry=hit&&hit.list===list?hit:{list};entry[kind]=fn();readings.delete(key);readings.set(key,entry);if(readings.size>60)readings.delete(readings.keys().next().value);return entry[kind];}
// 别名: a line's speaker is the role it means (夏尔·凡多姆海恩 is 夏尔's), so one role has one voice. The roles' names are part of the key.
const roleKey=()=>(seen()?.routes||[]).map(r=>r.name+'='+(r.aliases||[]).join(',')).join('|');
function parsed(message){return remembered(String(message)+'\u0001'+roleKey(),'parsed',()=>{for(const format of formats()){try{const lines=withRoles(seen()?.routes,parseDialogue(message,format));if(lines.length)return {format,lines};}catch{}}return {format:formats()[0],lines:[]};});}
function clearPrompts(){const ctx=context();if(!ctx)return;for(const key of Object.keys(ctx.extensionPrompts||{})){if(key.startsWith('myphone.entry.'))ctx.setExtensionPrompt(key,'',-1,0);}prompts.clear();}
// Who may speak in this reply: the chat's character (all members in a group), anyone who spoke with a voice tag in the
// last 8 messages, and anyone named in the last 3. Reading rules and the language line are written only for them.
function speakers(){const ctx=context(),names=new Set(),add=n=>{if(n&&String(n).trim())names.add(String(n).trim());};if(!ctx)return [];add(ctx.name2);
 if(ctx.groupId){const group=ctx.groups?.find(g=>g.id===ctx.groupId);for(const member of group?.members||[])add(ctx.characters?.find(c=>c.avatar===member)?.name);}
 const recent=(ctx.chat||[]).filter(m=>m&&!m.is_system).slice(-8);for(const m of recent){if(!m.is_user)add(m.name);for(const line of parsed(m.mes||'').lines)add(line.role);}
 const text=recent.slice(-3).map(m=>m.mes||'').join('\n');for(const r of seen().routes)if(r.name&&text.includes(r.name))add(r.name);return [...names];}
function inject(type,options,dryRun){
 clearPrompts();
 if(!active)return;
 const only=speakers(), speech=voiceOn()&&settings.general.voiceMode!=='separate'?promptPlan(seen(),modelRules(seen(),only),only):[];
 const social=voiceOnly()?[]:[...(chats?.bringPlan(typeof type==='string'?type:'',dryRun===true)||[]),...(chats?.storyPlan()||[])];
 const extras=[...drawPromptPlan(seen(),undefined,backend.drawCast(only)),...social,...(wardrobeHost?.storyPlan(typeof type==='string'?type:'',dryRun===true)||[]),...(generatorHost?.storyPlan(typeof type==='string'?type:'',dryRun===true)||[]),...(voiceOnly()?[]:memoryHost?.storyPlan()||[]),...(soundHost?.promptPlan()||[]),...(musicHost?.promptPlan()||[])];
 for(const p of [...speech,...extras]){context().setExtensionPrompt(p.key,p.text,p.position,p.depth,false,p.role);prompts.add(p.key);}
 // Last of all: the rules add to the reply and never cut it down (a card's thinking, 状态栏 and 选项 stay).
 if(prompts.size){context().setExtensionPrompt(KEEP_KEY,KEEP_REPLY,1,0,false,0);prompts.add(KEEP_KEY);}}
const KEEP_KEY='myphone.entry.zz-keep';
function persist(next){return backend.save(next);}
const voiceOn=()=>settings?.general?.voiceEnabled!==false;
const storyWavesOn=()=>voiceOn()&&settings?.general?.hideStoryWaves!==true;
function storeSettings(next){const voiced=voiceOn(),waves=storyWavesOn(),sounded=soundsOn(),oldFormats=formats().join('\n'),reading=settings?.narration?.enabled===true;settings=next;if(reading&&next.narration?.enabled!==true)player?.dropNarration();context().extensionSettings[NAMESPACE]=structuredClone(next);context().saveSettingsDebounced();if(active){memoryHost?.refreshStory();inject();syncFloating();vnHost?.refresh();if(voiced!==voiceOn()){player.stop();rerender();}else if(waves!==storyWavesOn()||sounded!==soundsOn()||oldFormats!==formats().join('\n'))rerender();else scheduleRender();}}
// Hidden floors (/hide) are still the story: their waves play, and they can be voiced again.
function currentMessage(id){const ctx=context(),message=ctx.chat[id];if(!storyReply(message))return null;return {message,chat:ctx.getCurrentChatId?.()??ctx.chatId,id,raw:message.mes,swipe:message.swipe_id};}
function unchanged(snap){const now=currentMessage(snap.id);return active&&now?.message===snap.message&&now.chat===snap.chat&&now.raw===snap.raw&&now.swipe===snap.swipe;}
// Image/prompt patches may rewrite mes without changing anything that is being spoken.
function voiceUnchanged(snap){const now=currentMessage(snap.id);if(!active||!now||now.chat!==snap.chat||now.swipe!==snap.swipe)return false;if(now.message!==snap.message){const a=snap.message.myPhoneFloorId||snap.message.extra?.myPhoneFloorId||snap.message.send_date,b=now.message.myPhoneFloorId||now.message.extra?.myPhoneFloorId||now.message.send_date;if(!a||a!==b)return false;}return sameSpokenLines(messageLines(snap),messageLines(now));}
/** 台词小窗: the latest reply (of the last few) that has voiced lines, as {id, name, lines}. */
function latestLines(){const chat=context()?.chat||[];for(let i=chat.length-1,seen=0;i>=0&&seen<6;i--){const snap=currentMessage(i);if(!snap)continue;seen++;const lines=messageLines(snap);if(lines.length)return {id:i,name:snap.message.name||'',lines:lines.map(l=>({role:l.role||'',text:l.text||'',translation:l.translation||''}))};}return null;}
function originalVoiceWindowLines(){if(voiceWindowMessage){if(!voiceUnchanged(voiceWindowMessage)||context()?.chat?.at(-1)!==voiceWindowTail)voiceWindowMessage=null;else return {id:voiceWindowMessage.id,name:voiceWindowMessage.message.name||'',lines:messageLines(voiceWindowMessage)};}return latestLines();}
function voiceWindowLines(){
 if(playbackMessage&&voiceUnchanged(playbackMessage)&&player.history?.length&&['playing','paused','generating'].includes(player.phase))return {id:playbackMessage.id,name:playbackMessage.message.name||'',lines:player.history};
 const r=originalVoiceWindowLines();if(!r)return null;const snap=currentMessage(r.id);return snap?{...r,lines:windowQueue(snap)}:r;
}
function windowQueue(snap){const lines=messageLines(snap).map((l,uiIndex)=>({...l,uiIndex}));return spokenQueue(settings.narration?.enabled?readingPlan(snap.raw,lines,settings.narration.skip,settings.narration.body).map(x=>x.narration!==undefined?{role:NARRATOR,narration:true,emotion:'calm',text:x.narration,translation:x.narration}:lines[x.line]):lines);}
function playWindowLine(id,index){if(playbackMessage?.id===id&&voiceUnchanged(playbackMessage)&&player.history?.length&&['playing','paused','generating'].includes(player.phase))return player.jump(index);const snap=currentMessage(id);if(!snap)return;playbackMessage=selectedMessage=snap;const queue=windowQueue(snap);readingKey=playbackKey(snap,queue);primeSpokenQueue(queue);return player.start(queue,()=>voiceUnchanged(snap),null,{ahead:true,prebuffer:settings.general.wholePrebuffer!==false,startIndex:index});}
function openVoiceWindow(id){if(!voiceOn())throw Error('请先打开正文语音');const snap=currentMessage(id);if(!snap||!messageLines(snap).length)throw Error('这层楼还没有配音台词');voiceWindowMessage=snap;voiceWindowTail=context()?.chat?.at(-1);if(!settings.general.voiceIsland)backend.updateGeneral({voiceIsland:true});voiceIsland?.open();}

function messageLines(snap){return withMarks(snap.raw,parsed(snap.raw).lines,settings.presets.find(p=>p.id===settings.activePreset)?.marks);}
function latestMessage(){const chat=context().chat;for(let id=chat.length-1;id>=0;id--){const snap=currentMessage(id);if(snap&&parsed(snap.raw).lines.length)return snap;}return null;}
function selectedDialogue(){if(selectedMessage&&!unchanged(selectedMessage))selectedMessage=null;return selectedMessage||latestMessage();}
// A revision also distinguishes identical lines in different chats or swipes. The panel can reject a stale action.
function currentDialogue(){const snap=selectedDialogue();if(snap?(!dialogueMessage||!unchanged(dialogueMessage)||dialogueMessage.id!==snap.id):!!dialogueMessage){dialogueMessage=snap;dialogueRevision++;}return {id:snap?.id??-1,lines:snap?messageLines(snap):[],revision:dialogueRevision};}
// Menu entries retain the exact message/chat/swipe seen when the picker opened.
const dialogueChoices=new Map();
function listDialogueReplies(){dialogueChoices.clear();const rows=[];for(let id=context().chat.length-1;id>=0;id--){const snap=currentMessage(id);if(!snap)continue;const lines=parsed(snap.raw).lines;if(!lines.length)continue;const token=crypto.randomUUID();dialogueChoices.set(token,snap);rows.push({id,token,name:String(snap.message.name||lines[0].role||''),count:lines.length,preview:lines[0].translation.slice(0,80)});}return rows;}
function selectDialogue(id,token){const snap=dialogueChoices.get(token);if(!snap||snap.id!==id||!unchanged(snap)||!parsed(snap.raw).lines.length){dialogueChoices.clear();throw Error('楼层内容已变化，请重新展开选择');}const previous=selectedDialogue();selectedMessage=snap;dialogueChoices.clear();if(!previous||previous.id!==snap.id||!unchanged(previous)){playbackMessage=null;player.stop('等待播放');}return currentDialogue();}
function spokenQueue(lines){return withReadTranslations(lines,{enabled:settings.narration?.readTranslations!==false}).map((line,readingIndex)=>({...line,readingIndex}));}
function primeSpokenQueue(queue){if(queue.some(l=>l.narration&&(settings.narration?.voice!=='role'||l.translationRead&&!lineVoiced(l))))speech?.prime();}
async function playMessage(id,index){const snap=currentMessage(id);if(!snap)return;const current=player.queue[player.index];if(index!==undefined&&!player.boundary&&playbackMessage&&voiceUnchanged(playbackMessage)&&playbackMessage.id===id&&current?.uiIndex===index&&['playing','generating','paused'].includes(player.phase)){selectedMessage=snap;player.toggle();return;}const lines=messageLines(snap).map((line,uiIndex)=>({...line,uiIndex}));if(index!==undefined&&!lines[index]){healed.delete(id);redrawMessage(id,snap.message);scheduleRender();notice('这句台词和消息内容对不上了，已经重新画好，请再点一次');return;}selectedMessage=snap;playbackMessage=snap;
 // 整篇朗读: the whole reply, the story between the lines read by the 旁白 (core/narration.js); one line is still just that line.
 if(index===undefined&&settings.narration?.enabled){const fullQueue=spokenQueue(readingPlan(snap.raw,lines,settings.narration.skip,settings.narration.body).map(x=>x.narration!==undefined?{role:NARRATOR,narration:true,emotion:'calm',text:x.narration,translation:x.narration}:lines[x.line]));readingKey=playbackKey(snap,fullQueue);const resume=Math.min(readingProgress(readingKey),Math.max(0,fullQueue.length-1));primeSpokenQueue(fullQueue);player.start(fullQueue,()=>voiceUnchanged(snap),null,{ahead:true,prebuffer:settings.general.wholePrebuffer!==false,startIndex:resume});return;}
 const full=spokenQueue(lines);readingKey=index===undefined?playbackKey(snap,full):null;const resume=readingKey?Math.min(readingProgress(readingKey),Math.max(0,full.length-1)):0;const queue=index===undefined?full:spokenQueue(await unheardQueue(lines,index,line=>player.lineState(line)));if(!voiceUnchanged(snap))return;primeSpokenQueue(queue);player.start(queue,()=>voiceUnchanged(snap),null,{ahead:queue.length>1,prebuffer:index===undefined&&settings.general.wholePrebuffer!==false,startIndex:index===undefined?resume:0});}
function playStepMessage(id){const snap=currentMessage(id);if(!snap)return;const same=playbackMessage&&voiceUnchanged(playbackMessage)&&playbackMessage.id===id;if(same&&player.stepwise&&['playing','generating','paused'].includes(player.phase))return player.toggle();const current=same?player.queue[player.index]?.readingIndex:undefined,lines=spokenQueue(messageLines(snap).map((line,uiIndex)=>({...line,uiIndex})));selectedMessage=playbackMessage=snap;readingKey=playbackKey(snap,lines);const resume=Number.isInteger(current)?current:Math.min(readingProgress(readingKey),Math.max(0,lines.length-1));const queue=lines.slice(resume);primeSpokenQueue(queue);return player.start(queue,()=>voiceUnchanged(snap),null,{ahead:true,stepwise:true});}

// 视觉小说: one line of a message, only when it has a voice (the stage never stops to ask for one).
const lineVoiced=line=>{if(!line)return false;const r=seen().routes.find(x=>x.name===line.role),c=settings.connections;return !!(r&&(r.voice?.trim()||(r.engine==='fish'&&c.fish?.params?.references?.length)||(r.engine==='mini'&&c.mini?.params?.timbre_weights?.length)));};
// playbackMessage stays empty: the stage plays the story's sounds itself (the voice would play them again).
function playLine(id,index){const snap=currentMessage(id);if(!snap)return;const lines=messageLines(snap).map((line,uiIndex)=>({...line,uiIndex}));if(!lineVoiced(lines[index]))return;selectedMessage=snap;playbackMessage=null;const queue=spokenQueue([lines[index]]);primeSpokenQueue(queue);player.start(queue,()=>voiceUnchanged(snap));}
// 旁白 on the stage: 整篇朗读's voice (the system's, or the 旁白 role when it has one).
function narrateLine(text){if(settings.narration?.voice==='role'?!lineVoiced({role:NARRATOR}):!speech)return;if(settings.narration?.voice!=='role')speech.prime();playbackMessage=null;player.start([{role:NARRATOR,narration:true,emotion:'calm',text,translation:text}],()=>active);}
function playSelected(){const snap=selectedDialogue();if(snap)return playMessage(snap.id);notice('当前聊天还没有可朗读的台词');}
function status(value){if(readingKey&&playbackMessage){const line=player?.queue[player.index];if(['playing','paused','generating','waiting'].includes(value.phase)&&Number.isInteger(line?.readingIndex??line?.uiIndex))readingProgress(readingKey,line.readingIndex??line.uiIndex);if(value.phase==='idle'&&/^播放完成/.test(value.message||'')){readingProgress(readingKey,null);readingKey=null;}}vnHost?.status(value.phase);try{soundHost?.voice(value,playbackMessage,playbackMessage?parsed(playbackMessage.raw).lines:[]);}catch{}try{musicHost?.voice(value.phase);}catch{}floating?.update(value);const label=document.querySelector('#myphone-extension-entry .myphone-status');if(label)label.textContent=value.message;const toggle=document.querySelector('#myphone-toggle');if(toggle){toggle.textContent=value.phase==='paused'?'继续':'暂停';toggle.disabled=!['playing','generating','paused'].includes(value.phase);}const stop=document.querySelector('#myphone-stop');if(stop)stop.disabled=['idle','error'].includes(value.phase);frame?.contentWindow?.myPhoneUpdate?.(value);if(value.phase==='error'&&!panel?.open)notice(value.message);scheduleRender();}
// A reply whose voice lines were not turned into waves when it was first drawn (seen once after a generation) is redrawn once.
const healed=new Map(),framed=new Set(),markRoles=new Map(),streaming=()=>{const p=context()?.streamingProcessor;return !!p&&!p.isFinished;};
// Throttled, not debounced: other extensions that keep changing #chat cannot postpone the waves forever.
// 酒馆助手 and the like turn code blocks into live frontends after a message is drawn (wrapping its <pre>) and do not watch later redraws.
// Our redraws never change code blocks, so the wrappers go back onto the same blocks; if they cannot be matched, that one message is announced as updated.
function keepFrontends(id,redraw){const box=()=>document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`),before=box();
 const wraps=before?[...before.querySelectorAll('pre')].map(pre=>{const w=pre.parentElement;return w&&w!==before&&w.parentElement===before&&!w.querySelector('[data-myphone-line]')?w:null;}):[],had=before?before.querySelectorAll('iframe').length:0;
 redraw();const after=box();if(!after||!had)return;const pres=[...after.querySelectorAll('pre')];
 if(pres.length===wraps.length)wraps.forEach((w,i)=>{if(w&&pres[i].parentElement===after)pres[i].replaceWith(w);});
 if(after.querySelectorAll('iframe').length<had){const ctx=context();ctx.eventSource?.emit(ctx.eventTypes.MESSAGE_UPDATED,id);}}
function redrawMessage(id,message){if(editing(document.querySelector(`#chat .mes[mesid="${id}"]`)))return;keepFrontends(id,()=>context().updateMessageBlock(id,message));}
// Changes inside one reply (a streamed chunk, a frontend drawn by 酒馆助手) redraw only that reply; anything else redraws
// all of them. While a long reply streams in, going through every earlier reply each time made phones freeze.
let renderAll=false;const renderIds=new Set();
function scheduleRender(){queueRender(null);}
function queueRender(ids){if(ids)for(const id of ids)renderIds.add(id);else renderAll=true;if(renderTimer)return;renderTimer=setTimeout(()=>{renderTimer=0;const only=renderAll?null:new Set(renderIds);renderAll=false;renderIds.clear();decorate(only);voiceIsland?.refresh();},40);}
/** Only changes that bring in (or take away) messages or our own marks are worth a redraw. */
const ours=node=>node.nodeType===1&&(node.matches?.('.mes,[data-myphone-token]')||!!node.querySelector?.('[data-myphone-token],.mes'));
// While a reply streams in, the tavern draws the whole message again for every new chunk, so the waves and pictures in
// it are brand new each time: blank until decorate() fills them 40 ms later, which made them flash on every chunk. The
// observer runs before the browser paints, so there the new ones take over what the old ones showed (a finished picture
// is moved over as it is, and its image never reloads).
const drawnIn=r=>r.target.closest?.('.mes[mesid]')?.getAttribute('mesid');
const ownedIn=n=>n.nodeType!==1?[]:[n,...n.querySelectorAll('[data-myphone-pic],[data-myphone-line]')].filter(el=>el.dataset?.myphoneToken===marker);
const waveKey=(id,el)=>id+':'+el.dataset.myphoneLine+':'+el.textContent;
function carryOver(records){const pics=new Map(),waves=new Map();
 for(const r of records){const id=drawnIn(r);if(id==null)continue;for(const n of r.removedNodes)for(const el of ownedIn(n)){if(el.hasAttribute('data-myphone-pic')){if(el.dataset.myphoneRendered)pics.set(id+':'+el.dataset.myphoneHash,el);}else{const b=el.querySelector('[data-myphone-action="line"]');if(b)waves.set(waveKey(id,el),b);}}}
 if(!pics.size&&!waves.size)return;
 for(const r of records){const id=drawnIn(r);if(id==null)continue;for(const n of r.addedNodes){if(!n.isConnected)continue;for(const el of ownedIn(n)){if(el.hasAttribute('data-myphone-pic')){const key=id+':'+el.dataset.myphoneHash,old=pics.get(key);if(old&&!el.dataset.myphoneRendered){pics.delete(key);el.replaceWith(old);}}else{const old=waves.get(waveKey(id,el)),b=el.querySelector('[data-myphone-action="line"]');if(old&&b)for(const k of ['data-myphone-state','title','aria-label','aria-busy'])old.hasAttribute(k)?b.setAttribute(k,old.getAttribute(k)):b.removeAttribute(k);}}}}}
function chatChanged(records){try{carryOver(records);}catch{}const changed=records.filter(r=>[...r.addedNodes,...r.removedNodes].some(ours)||legacy&&redrawn(r.target));if(!changed.length)return;const ids=new Set();for(const r of changed){const id=drawnIn(r);if(id==null)return queueRender(null);ids.add(Number(id));}queueRender(ids);}
// SillyTavern before 1.19 has no message formatter hook. There a reply is drawn again after the tavern draws it: the
// transformed text goes through the tavern's own formatting (the steps the hook runs in), and the first node drawn is
// remembered, so a later redraw by the tavern (edit, swipe, other extensions) is noticed and drawn again.
const liveId=()=>streaming()?context().chat.length-1:-1;
const redrawn=t=>t.nodeType===1&&t.classList.contains('mes_text')&&Number(t.closest('.mes')?.getAttribute('mesid'))!==liveId();
function legacyFormat(){if(!legacy)return;const ctx=context(),live=liveId();for(const element of document.querySelectorAll('#chat .mes[mesid]')){const id=Number(element.getAttribute('mesid')),message=ctx.chat[id],box=element.querySelector('.mes_text');if(!box||!message||message.is_user||message.is_system||id===live||box.querySelector('textarea'))continue;const raw=message.extra?.display_text||message.mes||'',drawn=box.myphoneDrawn;if(drawn&&drawn.raw===raw&&drawn.voice===storyWavesOn()&&drawn.node?.parentNode===box)continue;let out;try{out=transform(raw,false,id);}catch{continue;}if(out===raw)continue;keepFrontends(id,()=>{box.innerHTML=ctx.messageFormatting(out,message.name,message.is_system,message.is_user,id,message.extra?.uses_system_ui?{MESSAGE_ALLOW_SYSTEM_UI:true}:{},false);});box.myphoneDrawn={raw,voice:storyWavesOn(),node:box.firstChild};}}
function animateLines(){cancelAnimationFrame(lineRaf);document.querySelectorAll('[data-myphone-bar]').forEach(el=>el.style.removeProperty('transform'));if(!active||player.phase!=='playing'||!settings.general.waveformEnabled||lineMedia?.matches||document.hidden)return;// The playing line's bars are looked up a few times a second, not every frame: the lookup goes through the whole
// tavern page, which a long chat makes big. Bars no longer playing when they are looked up again go back to rest.
let previous=0,looked=-1e9,bars=[];const draw=now=>{if(now-previous>=32){if(now-looked>400){const playing=[...document.querySelectorAll('[data-myphone-state="playing"] [data-myphone-bar]')];for(const bar of bars)if(!playing.includes(bar))bar.style.removeProperty('transform');bars=playing;looked=now;}const levels=player.sink.levels();bars.forEach((bar,i)=>bar.style.transform='scaleY('+(.2+.8*(levels[i%5]||0))+')');previous=now;}lineRaf=requestAnimationFrame(draw);};lineRaf=requestAnimationFrame(draw);}
// A reply drawn without its waves (another extension or a card's script drew it again on its own) is drawn again, a few
// times at most per text: a tag the tavern meets unread shows its original text, so the line would appear twice.
function healable(id,raw){const h=healed.get(id);if(h?.raw===raw&&(h.n>=3||Date.now()-h.at<1500))return false;healed.set(id,{raw,n:h?.raw===raw?h.n+1:1,at:Date.now()});return true;}
// A reply open in the tavern's editor: its editing box sits inside .mes_text, so drawing the reply again (or adding a
// note there) would throw the box away mid-edit (the pencil seemed to open and close at once). Left alone until saved.
const editing=element=>!!element?.querySelector?.('.edit_textarea,#curEditTextarea');
async function decorate(only=null){if(!active)return;legacyFormat();pictures?.decorate(currentMessage);storyTools?.buttons();const epoch=++renderEpoch,livePlayer=player;document.querySelectorAll('#chat [data-myphone-owned="toolbar"]').forEach(el=>el.remove());const jobs=[];for(const element of document.querySelectorAll('#chat .mes[mesid]')){const id=Number(element.getAttribute('mesid'));if(only&&!only.has(id))continue;if(editing(element))continue;const snap=currentMessage(id);if(!snap)continue;const lines=parsed(snap.raw).lines;lint(element,snap.raw,lines);if(!legacy&&storyWavesOn()&&lines.length&&!element.querySelector(`[data-myphone-line][data-myphone-token="${marker}"]`)&&!streaming()&&!framed.has(id)&&healable(id,snap.raw)){redrawMessage(id,snap.message);continue;}for(const button of element.querySelectorAll('[data-myphone-action="line"]')){const owner=button.closest('[data-myphone-token]'),index=Number(owner?.dataset.myphoneLine),line=lines[index];if(owner?.dataset.myphoneToken!==marker||!line)continue;const ticket=button.myphoneTicket=(button.myphoneTicket||0)+1;jobs.push((async()=>{let state=await livePlayer.lineState(line);const route=seen().routes.find(r=>r.name===line.role);if(state==='ungenerated'&&!route?.voice)state='unbound';if(button.myphoneTicket!==ticket||!active||livePlayer!==player||!unchanged(snap)||!button.isConnected)return;const current=player.queue[player.index];if(playbackMessage&&voiceUnchanged(playbackMessage)&&playbackMessage.id===id&&current?.uiIndex===index&&['playing','generating','paused','waiting'].includes(player.phase))state=player.phase;button.dataset.myphoneState=state;const labels={unbound:'还没有配音，点击选择音色',ungenerated:'未生成，点击生成并播放',ready:'可以播放',played:'已播放，点击再次朗读',generating:'正在生成，点击暂停',playing:'正在播放，点击暂停',paused:'已暂停，点击继续',waiting:'等待选择音色'};button.title=labels[state];button.setAttribute('aria-label',line.role+'：'+labels[state]);button.setAttribute('aria-busy',String(state==='generating'));})());}}
await Promise.all(jobs);if(epoch===renderEpoch&&active){animateLines();lookForCover();}}
// A reply whose voice tags could not all be read gets a small note under it: which ones and why. Drawn again only when
// the problems change, so it never keeps the chat redrawing.
function lint(element,raw,lines){const box=element.querySelector('.mes_text');if(!box)return;const old=box.querySelector(':scope>[data-myphone-owned="lint"]');const problems=storyWavesOn()&&Number(element.getAttribute('mesid'))!==liveId()&&!box.querySelector('textarea')?remembered(String(raw),'problems',()=>dialogueProblems(raw,lines)):[];const key=problems.length?JSON.stringify(problems.map(p=>[p.at,p.reason])):'';if((old?.dataset.key||'')===key)return;old?.remove();if(!key)return;const note=document.createElement('details');note.className='myphone-lint';note.dataset.myphoneOwned='lint';note.dataset.key=key;note.innerHTML=`<summary>有 ${problems.length} 句台词格式不对，没有声波</summary><ul>${problems.map(p=>`<li><b>${escapeHTML(p.role||'未写角色')}</b>：${escapeHTML(p.reason)}<code>${escapeHTML(p.snippet)}</code></li>`).join('')}</ul><p>可以重新生成这条回复，或者编辑成 “译文”&lt;tts&gt;角色|情绪|原文&lt;/tts&gt;。</p>`;box.append(note);}
/** How much of localStorage (≈5 MB per address, shared by the tavern and every extension) is used; null when it cannot be read. */
function localStorageSize(){try{let bytes=0;for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);bytes+=(k.length+(localStorage.getItem(k)||'').length)*2;}return {bytes,items:localStorage.length};}catch{return null;}}
/** Facts for the self-check (core/diagnostics.js makes the report). Keys are only asked whether they work, never read. */
async function diagnose(){const ctx=context(),s=settings,json=url=>fetch(url,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
 const [manifest,version,storage]=await Promise.all([json(new URL('manifest.json',base)),json('/version'),navigator.storage?.estimate?.().catch(()=>null)]);
 const preset=s.presets.find(p=>p.id===s.activePreset),voiced=r=>!!(r.voice?.trim()||(r.engine==='fish'&&s.connections.fish?.params?.references?.length)||(r.engine==='mini'&&s.connections.mini?.params?.timbre_weights?.length));
 const keys={};for(const engine of ['fish','mini','eleven','mimo','doubao','nai','gpt']){const image=engine==='nai'||engine==='gpt',users=image?[]:s.routes.filter(r=>r.engine===engine).map(r=>r.name),k={set:!!backend.keyStatus(engine),needed:image?(s.draw?.enabled&&s.draw.engine===engine?'正文出图开着，绘图用的是它':''):users.length?'有角色在用：'+users.join('、'):''};
  if(k.set&&engine!=='mini'&&engine!=='gpt'&&engine!=='doubao'){try{if(engine==='nai'){const sub=await backend.naiSubscription();k.detail=sub?`${TIER_NAMES[sub.tier]||'订阅'}${sub.active?'':'（未激活）'}${sub.anlas!==undefined?' · Anlas '+sub.anlas:''}`:'';}else{const b=await backend.voiceBalance(engine);k.detail=b?.kind==='characters'?`剩余 ${b.left} / ${b.limit} 字符`:b?.kind==='credit'?`余额 ${b.credit}`:'';}k.check='ok';}catch(e){k.check='error';k.detail=e.message;}}
  if(k.set||k.needed)keys[engine]=k;}
 let reply=null;for(let i=ctx.chat.length-1;i>=0&&!reply;i--){const m=ctx.chat[i];if(!m||m.is_user||m.is_system)continue;const raw=m.mes||'',lines=parsed(raw).lines,element=document.querySelector(`#chat .mes[mesid="${i}"]`),ours=element?element.querySelectorAll(`[data-myphone-line][data-myphone-token="${marker}"]`).length:0,all=element?element.querySelectorAll('[data-myphone-line]').length:0;
  reply={id:i,name:m.name||'',lines:lines.length,tags:/<tts\b/i.test(raw),problems:dialogueProblems(raw,lines),inChat:!!element,waves:ours,stale:all-ours,iframes:element?element.querySelectorAll('iframe').length:0,covered:coverSeen?.id===i?coverSeen.what:'',streaming:i===liveId()};}
 const where={in_chat:'聊天中',in_prompt:'系统提示后',before_prompt:'系统提示前'};
 return {at:Date.now(),plugin:{version:manifest?.version||'',copies:[...globalThis.__myPhoneAppCopies],oldCopy:!!globalThis.__myPhonePanelBridge},tavern:{version:version?.pkgVersion||'',mode:legacy?'legacy':'hook'},
  browser:{secure:globalThis.isSecureContext!==false,audio:!!globalThis.AudioContext,indexedDB:!!globalThis.indexedDB,probe:await probeStorage().catch(()=>null),storage:storage?.quota?{usage:storage.usage,quota:storage.quota}:null,localStorage:localStorageSize(),keys:backend?.keyStore?.fallback?'localStorage':'indexedDB',agent:browserName()},extensions:thirdParty(),
  voice:{enabled:voiceOn(),wavesHidden:settings.general.hideStoryWaves===true,preset:preset?.name||'',format:preset?.format||'',injection:preset?.injection?`${where[preset.injection.position]||preset.injection.position}${preset.injection.position==='in_chat'?' · 深度 '+preset.injection.depth:''}`:'',roles:s.routes.map(r=>({name:r.name,voice:voiced(r)}))},
  keys,draw:{engine:s.draw?.engine||'nai',enabled:!!s.draw?.enabled,comfy:s.draw?.engine==='comfy'?{url:s.draw.comfy.url,model:s.draw.comfy.model,workflow:!!s.draw.comfy.workflow}:null},reply,errors:recent.slice()};}
// What sits on top of a currently visible wave, when something other than the wave would take the click. Looked at
// while the chat is drawn, the phone is closed and no reply is streaming in (it makes the browser lay the page out).
// Waves clipped above/below #chat are skipped so the tavern's normal top bar/background is not mistaken for an overlay.
// Every pass with the phone closed clears the previous result, so old hits cannot linger; with it open the last result
// is kept for the self-check.
let coverSeen=null;
function lookForCover(){if(panel?.open||streaming())return;coverSeen=null;const chat=context()?.chat||[];for(let i=chat.length-1;i>=0;i--){const m=chat[i];if(!m||m.is_user||m.is_system)continue;const element=document.querySelector(`#chat .mes[mesid="${i}"]`),what=covering(element);if(what===null)continue;coverSeen={id:i,what};return;}}
function covering(element){if(!element||!document.elementsFromPoint)return null;const chat=document.querySelector('#chat'),clip=chat?.getBoundingClientRect?.(),buttons=[...element.querySelectorAll(`[data-myphone-token="${marker}"] [data-myphone-action="line"]`)];for(const button of buttons){const r=button.getBoundingClientRect();if(!r.width||!r.height)continue;const left=Math.max(r.left,clip?.left??0,0),right=Math.min(r.right,clip?.right??innerWidth,innerWidth),top=Math.max(r.top,clip?.top??0,0),bottom=Math.min(r.bottom,clip?.bottom??innerHeight,innerHeight);if(right-left<2||bottom-top<2)continue;const x=(left+right)/2,y=(top+bottom)/2,hit=document.elementsFromPoint(x,y).find(el=>!el.closest('#myphone-panel,#myphone-floating')&&el!==document.documentElement&&el!==document.body);if(!hit)continue;if(hit===button||button.contains(hit)||hit.closest?.('[data-myphone-action="line"]')===button)return '';return hit.tagName.toLowerCase()+(hit.id?'#'+hit.id:'')+[...hit.classList].slice(0,3).map(c=>'.'+c).join('');}return null;}
function thirdParty(){const names=new Set();for(const el of document.querySelectorAll('script[src*="/extensions/third-party/"],link[href*="/extensions/third-party/"]')){const m=/\/extensions\/third-party\/([^/]+)\//.exec(el.src||el.href);if(m)names.add(decodeURIComponent(m[1]));}return [...names];}
function browserName(){const ua=navigator.userAgent||'',b=(/(Edg|OPR|Firefox|Chrome)\/(\d+)/.exec(ua)||[]).slice(1).join(' ')||(/Version\/(\d+).*Safari/.test(ua)?'Safari '+/Version\/(\d+)/.exec(ua)[1]:''),os=/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':/Windows/.test(ua)?'Windows':/Mac OS/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'';return [b.replace('Edg','Edge').replace('OPR','Opera'),os].filter(Boolean).join(' · ');}
function rerender(){const ctx=context();document.querySelectorAll('#chat .mes[mesid]').forEach(el=>{const id=Number(el.getAttribute('mesid'));if(ctx.chat[id])redrawMessage(id,ctx.chat[id]);});scheduleRender();}
function unknown(name){if(isPlaceholderRole(name)){player.stop('请在台词中填写实际角色名');return;}
 // 自动挑音色: the text model picks one (候选池 first), then the reading goes on; if it cannot, the 角色 App opens as before.
 if(settings.general.autoVoice===true&&voiceHost&&!seen().routes.find(r=>r.name===name)?.voice){notice(`正在给「${name}」挑音色……`);voiceHost.pick(name).then(r=>{notice(`给「${name}」挑好了音色：${r.autoName||r.voice}（自动挑的，在角色 App 里可以换）`);player.continuePending();}).catch(e=>{notice(e.message);const route=seen().routes.find(r=>r.name===name);if(route){settings.selected=route.id;persist(settings);}openPanel(route?.id);});return;}let route=seen().routes.find(r=>r.name===name);if(!route){route={id:crypto.randomUUID(),name,engine:'fish',voice:'',language:''};settings.routes.push(route);}settings.selected=route.id;persist(settings);openPanel(route.id);}
// On a computer the phone floats beside the story: no backdrop, the story stays readable and clickable, the phone is
// dragged by its top bar, comes in three sizes, and stays where it was left. On a phone it is full screen as before.
// Sizes: a share of the window's height, at most this tall, so 小/中/大 differ on any screen.
const PANEL_KEY='myphone-app-panel',PANEL_SIZES={s:[600,.7],m:[740,.85],l:[880,1]},PANEL_NAMES={s:'小',m:'中',l:'大'};
const fullScreen=()=>matchMedia('(pointer: coarse) and (max-width: 540px), (max-width: 360px)').matches;
let place=(()=>{try{return JSON.parse(localStorage.getItem(PANEL_KEY)||'null')||{};}catch{return {};}})(),drag=null;
const keepPlace=()=>{try{localStorage.setItem(PANEL_KEY,JSON.stringify(place));}catch{}};
// The phone inside is always laid out at one design size and scaled to the chosen size, so a small phone is the same
// phone, smaller, instead of a squeezed one.
const DESIGN_H=760,DESIGN_W=Math.round((DESIGN_H-54)*390/844+18);
// Visual viewport changes (keyboard, browser UI, foreground restoration) do not always resize the layout viewport.
// Leave pinch zoom to the browser instead of shrinking the phone to cancel the user's zoom.
function panelBounds(){const v=globalThis.window?.visualViewport,use=v&&Math.abs((v.scale||1)-1)<.01&&v.width>0&&v.height>0;
 return use?{left:Math.max(0,v.offsetLeft||0),top:Math.max(0,v.offsetTop||0),width:v.width,height:v.height}:{left:0,top:0,width:innerWidth,height:innerHeight};}
// 画画 全屏: the floating phone opens up to the whole window (the phone inside drops its frame), until asked back.
let panelExpanded=false;
function panelFull(on){panelExpanded=!!on&&!!panel?.classList.contains('floating');placePanel();return panelExpanded;}
function placePanel(){if(!panel)return;const float=!fullScreen();panel.classList.toggle('floating',float);if(!float)panelExpanded=false;panel.classList.toggle('expanded',panelExpanded);if(!float||panelExpanded){const b=panelBounds();for(const k of ['left','top','width','height'])panel.style[k]=b[k]+'px';if(frame)for(const k of ['width','height','transform'])frame.style.removeProperty(k);return;}
 const [most,share]=PANEL_SIZES[place.size]||PANEL_SIZES.m,h=Math.round(Math.min(most,(innerHeight-16)*share)),scale=h/DESIGN_H,w=Math.round(DESIGN_W*scale);
 if(frame)Object.assign(frame.style,{width:DESIGN_W+'px',height:DESIGN_H+'px',transform:`scale(${scale})`});
 const x=Math.min(Math.max(8,place.x??innerWidth-w-24),Math.max(8,innerWidth-w-8)),y=Math.min(Math.max(8,place.y??(innerHeight-h)/2),Math.max(8,innerHeight-h-8));
 Object.assign(panel.style,{width:w+'px',height:h+'px',left:Math.round(x)+'px',top:Math.round(y)+'px'});}
/** Dragging from the phone's top bar (inside the frame), in screen coordinates so the moving frame does not matter. */
function panelDrag(phase,sx,sy){if(!panel?.classList.contains('floating')||panelExpanded)return false;const r=panel.getBoundingClientRect();
 if(phase==='start')drag={sx,sy,x:r.left,y:r.top};
 else if(phase==='move'&&drag){place.x=drag.x+sx-drag.sx;place.y=drag.y+sy-drag.sy;placePanel();}
 else if(phase==='end'){drag=null;place.x=r.left;place.y=r.top;keepPlace();}
 else if(phase==='reset'){delete place.x;delete place.y;keepPlace();placePanel();}
 return true;}
function panelSize(){const order=['s','m','l'],next=order[(order.indexOf(place.size||'m')+1)%3],r=panel?.getBoundingClientRect();
 // Grows and shrinks around the top-right corner, so the phone does not jump away from where it was put.
 if(r){const before=r.right;place.size=next;placePanel();const after=panel.getBoundingClientRect();place.x=after.left-(after.right-before);place.y=r.top;}else place.size=next;
 placePanel();keepPlace();return PANEL_NAMES[next];}
function panelResized(){if(!panel?.open)return;const float=!fullScreen();if(float!==panel.classList.contains('floating')){panel.close();openPanel(undefined,true);}else placePanel();}
let panelLayoutRaf=0,panelLayoutTimers=[],panelViewport=null;
function queuePanelLayout(){if(!panel?.open||document.hidden||panelLayoutRaf)return;panelLayoutRaf=requestAnimationFrame(()=>{panelLayoutRaf=0;panelResized();});}
function restorePanelLayout(){for(const id of panelLayoutTimers)clearTimeout(id);panelLayoutTimers=[];if(document.hidden||!panel?.open)return;queuePanelLayout();
 // Some mobile WebViews report the old viewport until the system transition finishes. Bounded retries, no polling.
 panelLayoutTimers=[180,500].map(ms=>setTimeout(queuePanelLayout,ms));}
// Right after the phone opens, the late checks for WebViews that report the old viewport wait for an idle moment:
// the page is laid out by then, so reading its size costs nothing. Read during the opening, each made the browser lay
// out the whole tavern page first (20–47 ms, three times). The phone was already placed before it was shown.
function settlePanelLayout(){for(const id of panelLayoutTimers)clearTimeout(id);const idle=globalThis.requestIdleCallback,check=()=>{if(!document.hidden&&panel?.open)panelResized();};
 panelLayoutTimers=[180,500].map(ms=>setTimeout(()=>idle?idle(check,{timeout:400}):check(),ms));}
function watchPanelLayout(on){const w=globalThis.window,method=on?'addEventListener':'removeEventListener';if(on)panelViewport=w?.visualViewport;
 w?.[method]?.('resize',queuePanelLayout);for(const type of ['orientationchange','pageshow','focus'])w?.[method]?.(type,restorePanelLayout);
 document[method]('visibilitychange',restorePanelLayout);for(const type of ['resize','scroll'])panelViewport?.[method]?.(type,queuePanelLayout);
 if(!on){cancelAnimationFrame(panelLayoutRaf);panelLayoutRaf=0;for(const id of panelLayoutTimers)clearTimeout(id);panelLayoutTimers=[];panelViewport=null;}}
// The phone's dialog and frame: made on the first opening, or a moment before it when the entry is brought out.
function createPanel(){panel=document.createElement('dialog');panel.id='myphone-panel';panel.setAttribute('aria-label','MyPhone');frame=document.createElement('iframe');frame.title='MyPhone';frame.src=new URL('ui/index.html',base).href;
 // Made ahead and still closed: the phone is told it is not on screen yet, so opening it comes in the usual way.
 frame.addEventListener('load',()=>{try{listenTouches(frame.contentWindow);}catch{}if(!panel?.open)try{frame.contentWindow?.myPhonePanelVisibility?.(false);}catch{}});
 panel.append(frame);panel.addEventListener('close',()=>{setTimeout(syncBack,0);floating?.cover(false);frame?.contentWindow?.myPhonePanelVisibility?.(false);if(panelExpanded){panelExpanded=false;placePanel();}callIsland?.refresh();musicIsland?.refresh();voiceIsland?.refresh();});panel.addEventListener('cancel',()=>{if(['playing','generating'].includes(player.phase))player.toggle();});document.body.append(panel);}
// The entry was brought out (its first tap): the phone is likely next, so its page loads now, once the entry has
// moved and the page is idle, and the tap that opens it finds it ready (loading it then held the phone back ~0.5 s).
function preparePanel(){if(panel||!active)return;const make=()=>{if(!panel&&active)createPanel();},idle=globalThis.requestIdleCallback;setTimeout(()=>idle?idle(make,{timeout:1500}):make(),450);}
// Opening, the phone is shown as a plain dialog, also full screen: a modal one makes the whole tavern page inert, and
// working out the styles of all its elements again took 30–80 ms each time (style.css puts it above everything).
// Saving to the tavern waits until the phone is up: done while it opened, it held up the first frames.
// Older ST-TTS copies publish __myPhonePanelBridge (this one no longer does): both running doubles the waves and prompts.
let oldCopyNoted=false;
function openPanel(roleId,preserveView=false){setTimeout(()=>{callIsland?.refresh();msgIsland?.refresh();noteIsland?.refresh();musicIsland?.refresh();voiceIsland?.refresh();},0);floating?.setMode('docked');if(globalThis.__myPhonePanelBridge&&!oldCopyNoted){oldCopyNoted=true;notice('这个酒馆里还装着旧版「ST-TTS · 角色对白」，会和 MyPhone 互相干扰：请在扩展管理里删除它，然后刷新页面');}if(settings?.sync?.enabled&&!panel?.open)setTimeout(()=>{const run=()=>backend?.syncNow().catch(()=>{}),idle=globalThis.requestIdleCallback;idle?idle(run,{timeout:1500}):run();},900);if(!panel)createPanel();if(!panel.open){placePanel();panel.show();if(!panel.classList.contains('floating')){floating?.cover(true);requestAnimationFrame(()=>{if(panel?.open)try{frame.focus({preventScroll:true});}catch{}});}frame.contentWindow?.myPhonePanelVisibility?.(true,{preserveView});settlePanelLayout();}armBack();if(roleId)frame.contentWindow?.myPhoneOpenRole?.(roleId);}
// 手机上从屏幕边缘滑（浏览器的返回）: while something of ours is open over the tavern (the phone, the 视觉小说 stage,
// a 大游戏, a picture or the 改提示词 box on the tavern page) a few history entries of ours lie on top, so the browser's
// back (the edge swipe, Android's back) steps back inside it — the way Esc does, one layer at a time — and the tavern
// is left only once all of ours is closed. Touch screens only.
// They are laid only while the user touches the page: Chrome skips, on back, an entry a page added without the user's
// touch. Each back uses one; every touch (and going one level deeper always takes one) lays them full again; when all
// of ours is closed the rest are taken away. Entries left from before a reload are skipped on their own.
const BACK_SPARE=6,OVER='.myphone-vn,.myphone-viewer,.myphone-ask,[data-myphone-owned=game]';
let guards=0,unwinding=false;
// A touch screen. Some Android browsers and app web views do not say (pointer: coarse): any touch point counts too.
const touchBack=()=>!!(globalThis.matchMedia?.('(pointer: coarse)').matches||globalThis.matchMedia?.('(any-pointer: coarse)').matches||globalThis.navigator?.maxTouchPoints>0||'ontouchstart' in globalThis);
const oursOpen=()=>!!panel?.open||!!document.querySelector(OVER);
function armBack(force=false){if(unwinding||!(force||oursOpen())||!touchBack())return;try{while(guards<BACK_SPARE){history.pushState({...(history.state&&typeof history.state==='object'?history.state:{}),myphonePhone:marker},'');guards++;}}catch{}}
function unarmBack(){const n=guards;guards=0;if(n&&history.state?.myphonePhone===marker){unwinding=true;try{history.go(-n);}catch{unwinding=false;}}}
// Something of ours opened or closed: lay the entries (an opening comes from a touch), or take them away when all is closed.
function syncBack(){if(oursOpen())armBack();else unarmBack();}
/** One step back in what is on top: the stage, a picture or the box on the tavern page, a game, else the phone. */
function stepBack(){
 const over=[...document.querySelectorAll(OVER)].at(-1);
 if(over?.matches('[data-myphone-owned=game]')){try{const d=over.querySelector('iframe')?.contentDocument;d?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));}catch{}return;}
 if(over){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return;}
 if(!panel?.open)return;
 let inside=false;try{inside=!!frame?.contentWindow?.myPhoneBack?.();}catch{}
 if(!inside)panel.close();
}
globalThis.addEventListener?.('popstate',()=>{
 if(unwinding){unwinding=false;syncBack();return;}
 // An entry of ours from before a reload: nothing to step back in, go on back.
 if(!guards){if(history.state?.myphonePhone&&history.state.myphonePhone!==marker)history.back();return;}
 guards--;
 stepBack();
 setTimeout(()=>{if(!oursOpen())unarmBack();},0);
});
// A touch anywhere (the tavern page, or inside the phone's frame: see openPanel) lays the used entries again.
// Laid while the touch is still being handled: Safari only keeps an entry added during the user's own touch, not one a
// moment later. A touch opening something (a double tap opening a picture, a tap on 改提示词再画) has opened it by the
// time the event reaches the window, so the window hears it last (and once more right after, for what opens late).
// What opens something of ours on the tavern page (a picture, the tools of a reply, a wave, the phone): touched, the
// entries are laid before it opens (a handler may keep the event from the window); nothing opened, they go again.
const OPENERS='.myphone-pic,.myphone-pic-zoom,[data-myphone-pic-action],[data-myphone-action],[data-myphone-tools],.myphone-context-menu,#myphone-open,#myphone-wand-entry,#myphone-floating,[data-myphone-owned]';
let preArmed=0;
const touched=e=>{
 if(e?.type==='pointerdown'&&!oursOpen()&&e.target?.closest?.(OPENERS)&&!guards){armBack(true);clearTimeout(preArmed);preArmed=setTimeout(()=>{if(!oursOpen())unarmBack();},1500);return;}
 if(guards<BACK_SPARE){armBack();setTimeout(armBack,0);}
};
// touchend too: on a touch screen it is the lifting of the finger that counts as the user's own touch for the browser.
function listenTouches(win){for(const type of ['pointerdown','pointerup','touchend','click','dblclick','keydown'])win.addEventListener?.(type,touched,false);}
listenTouches(globalThis);
// The stage, the pictures, the box and the game come and go as children of the page.
if(globalThis.MutationObserver&&document.body)new MutationObserver(list=>{if(list.some(m=>[...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===1&&n.matches(OVER))))syncBack();}).observe(document.body,{childList:true});
// 大游戏 over the whole tavern page: the game in a frame of its own (ui/indie/<name>/play.html), the phone closed meanwhile.
// The game asks to leave with a message {type:'myphone-app-game:close'}. 南极结界 keeps its save in the browser and hands it
// to the phone as well ({type:'myphone-app-game:save', id, data, savedAt}, answered 'saved'), and on starting asks for the
// phone's copy ('load' → 'loaded' {save}), which 保存到酒馆 and backups carry between devices.
let gameOverlay=null;
const GAMES=new Set(['antarctic','blocks']);
function closeGame(){if(!gameOverlay)return;gameOverlay.stop();gameOverlay.el.remove();gameOverlay=null;}
// the phone's copy of a game's save: with 保存到酒馆 on, what the other devices saved is fetched first (a few seconds at most)
async function gameSaveOf(name){if(!backend)return null;if(backend.settings?.sync?.enabled)await Promise.race([backend.syncNow().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,6000))]);return backend.gameSave?.(name).catch(()=>null)??null;}
function openGame(name){
 if(!GAMES.has(name))throw Error('没有这个游戏');
 closeGame();if(panel?.open)panel.close();
 const el=document.createElement('div');el.dataset.myphoneOwned='game';el.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;z-index:32010;overflow:hidden;background:#0c0b12;';
 const f=document.createElement('iframe');f.src=new URL(`ui/indie/${name}/play.html`,base).href;f.allow='fullscreen; gamepad';f.allowFullscreen=true;f.style.cssText='border:0;width:100%;height:100%;display:block;';
 const answer=reply=>f.contentWindow?.postMessage(reply,location.origin);
 const message=e=>{if(e.source!==f.contentWindow)return;const d=e.data;
  if(d?.type==='myphone-app-game:close')closeGame();
  else if(d?.type==='myphone-app-game:load')gameSaveOf(name).then(save=>answer({type:'myphone-app-game:loaded',id:d.id,save}));
  else if(d?.type==='myphone-app-game:save')Promise.resolve(backend?.putGameSave(name,d.data,d.savedAt)).catch(()=>false).then(()=>answer({type:'myphone-app-game:saved',id:d.id}));};
 window.addEventListener('message',message);f.addEventListener('load',()=>f.contentWindow?.focus());
 el.append(f);document.body.append(el);
 gameOverlay={el,stop:()=>window.removeEventListener('message',message)};return true;}
function connect(source){
 if(!active||source!==frame?.contentWindow)throw Error('设置页面未连接');
 const owner=backend,api=owner.api();
 const check=()=>{if(!active||backend!==owner||owner.closed||source!==frame?.contentWindow)throw Error('设置页面已失效，请重新打开');};
 return Object.freeze({...api,
  voiceOnly,
  save:(next,revision)=>{check();return api.save({...next,floating:settings.floating},revision);},
  close:()=>{check();panel?.close();},
  latest:()=>{check();const snap=latestMessage();return {id:snap?.id??-1,lines:snap?parsed(snap.raw).lines:[]};},
  currentDialogue:()=>{check();return currentDialogue();},
  listDialogueReplies:()=>{check();return listDialogueReplies();},
  selectDialogue:(id,token)=>{check();return selectDialogue(id,token);},
  assistantPresets:()=>{check();return assistantHost.presets();},
  assistantReasoningFormat:()=>{check();return assistantHost.reasoningFormat();},
  assistantDisplay:(text,role,depth)=>{check();return assistantHost.display(text,role,depth);},
  assistantContext:()=>{check();return assistantHost.context();},
  assistantMemoryTidy:id=>{check();return assistantHost.memoryTidy(id,{force:true});},
  assistantMemoryStatus:id=>{check();return assistantHost.memoryStatus(id);},
  assistantMemoryEdit:(id,node,text)=>{check();assistantHost.memoryCancel(id);return api.assistantMemoryEdit(id,node,text);},
  assistantMemoryRemove:(id,node)=>{check();assistantHost.memoryCancel(id);return api.assistantMemoryRemove(id,node);},
  assistantMemoryForget:id=>{check();assistantHost.memoryCancel(id);return api.assistantMemoryForget(id);},
  assistantReply:(id,text,options)=>{check();return assistantHost.reply(id,text,options);},
  assistantReroll:(id,mid,options)=>{check();return assistantHost.reroll(id,mid,options);},
  assistantRedraw:(id,mid,options)=>{check();return assistantHost.redraw(id,mid,options);},
  assistantReadFiles:files=>{check();return readAssistantFiles(files);},
  editAssistantMessage:(id,mid,text,expectedText)=>{check();assistantHost.cancel(id);return api.editAssistantMessage(id,mid,text,expectedText);},
  deleteAssistantMessage:(id,mid)=>{check();assistantHost.cancel(id);return api.deleteAssistantMessage(id,mid);},
  selectAssistantVariant:(id,mid,selected)=>{check();assistantHost.cancel(id);return api.selectAssistantVariant(id,mid,selected);},
  assistantProgress:id=>{check();return assistantHost.progress(id);},
  assistantBusy:id=>{check();return assistantHost.busy(id);},
  assistantCancel:id=>{check();assistantHost.cancel(id);},
  assistantDrawBlock:(id,block,options)=>{check();return assistantHost.drawBlock(id,block,options);},
  deleteAssistantThread:id=>{check();assistantHost.cancel(id);return api.deleteAssistantThread(id);},
  clearAssistantThread:id=>{check();assistantHost.cancel(id);return api.clearAssistantThread(id);},
  speak:lines=>{check();playbackMessage=null;return api.speak(lines);},
  songWrite:form=>{check();return songHost.write(form);},
  songRewrite:(id,wish)=>{check();return songHost.rewrite(id,wish);},
  songWriteFor:(id,form)=>{check();return songHost.writeFor(id,form);},
  songBusy:()=>!!songHost?.busy(),
  musicStatus:()=>{check();return musicHost.status();},
  musicPlayList:(list,at,which)=>{check();return musicHost.playList(list,at,which);},
  musicPlayFrom:which=>{check();return musicHost.playFrom(which);},
  musicMode:mode=>{check();musicHost.setMode(mode);},
  musicPlay:track=>{check();return musicHost.play(track);},
  musicToggle:()=>{check();return musicHost.toggle();},
  musicNext:()=>{check();return musicHost.next();},
  musicPrev:()=>{check();return musicHost.prev();},
  musicStop:()=>{check();musicHost.stop();},
  musicSeek:seconds=>{check();musicHost.seek(Number(seconds));},
  play:(id,line)=>{check();playMessage(id,line);},
  audition:route=>{check();playbackMessage=null;api.audition(route);},
  tavernCards:()=>{check();const ctx=context();return [...(ctx?.characters||[]).filter(c=>c?.avatar).map(c=>({key:'card:'+c.avatar,name:c.name||''})),...(ctx?.groups||[]).filter(g=>g?.id).map(g=>({key:'group:'+g.id,name:g.name||''}))];},
  recentMessages:limit=>{check();return pictures.recentMessages(Math.min(60,Math.max(1,Number(limit)||8)));},
  insertImage:(id,photoId)=>{check();return pictures.insertImage(id,photoId);},
  suggestPrompt:()=>{check();return pictures.suggestPrompt();},
  writePrompt:(idea,cast)=>{check();return pictures.writePrompt(idea,cast);},
  autoPickVoice:name=>{check();return voiceHost.pick(String(name||''),{force:true});},
  soundState:()=>{check();return soundHost.state();},
  soundListen:id=>{check();return soundHost.listen(String(id||''));},
  soundStopAmbience:()=>{check();soundHost.stopAmbience();},
  chatPictureStats:()=>{check();return pictures.pictureStats();},
  planLatestPictures:()=>{check();return pictures.planLatest();},planLatestVoice:()=>{check();return pictures.voiceLatest();},
  clearChatPictures:()=>{check();return pictures.clearPictures();},
  takeDraw:()=>{check();const value=pendingDraw;pendingDraw=null;return value;},
  socialGroupScan:()=>{check();return groupHost.scan(undefined,{force:true});},
  socialGenerate:options=>{check();return socialHost.generate(options);}, socialCancel:()=>{check();socialHost.cancel();},
  chatReply:threadId=>{check();return chats.reply(threadId);},chatReroll:threadId=>{check();return chats.reroll(threadId);},chatCancel:threadId=>{check();chats.cancel(threadId);},
  chatDrawPhoto:(threadId,messageId,allowPaid)=>{check();return chats.drawPhoto(threadId,messageId,{allowPaid:allowPaid===true});},
  chatBring:(threadId,ids)=>{check();return chats.bring(threadId,ids);},
  chatPendingBring:()=>{check();return chats.pendingBring();},
  chatCancelBring:()=>{check();return chats.cancelBring();},
  chatTyping:threadId=>{check();return chats.typing(threadId);},
  chatAskFriend:(threadId,text)=>{check();return chats.askFriend(threadId,text);},
  chatSeesPictures:()=>{check();return chats.seesPictures();},
  momentsRefresh:()=>{check();return momentsHost.refresh();},wardrobeRecognize:id=>{check();return wardrobeHost.recognize(id);},wardrobeSuggest:options=>{check();return wardrobeHost.suggest(options||{});},wardrobeTryOn:options=>{check();return wardrobeHost.tryOn(options||{});},generatorCard:()=>{check();return generatorHost.cardInfo();},generatorBusy:()=>{check();return generatorHost.busy();},generatorOpening:form=>{check();return generatorHost.opening(form||{});},generatorWriteOpening:(text,options)=>{check();return generatorHost.writeOpening(text,options||{});},generatorPersona:form=>{check();return generatorHost.persona(form||{});},generatorSavePersona:value=>{check();return generatorHost.savePersona(value||{});},generatorUsePersona:id=>{check();return generatorHost.usePersona(id);},generatorDirections:form=>{check();return generatorHost.directions(form||{});},generatorSteer:direction=>{check();return generatorHost.steer(direction||null);},generatorSteering:()=>{check();return generatorHost.steering();},generatorTheater:form=>{check();return generatorHost.theater(form||{});},generatorPlay:id=>{check();return generatorHost.playTheater(id);},
  momentsReact:id=>{check();return momentsHost.react(id);},
  momentsReply:(id,commentId)=>{check();return momentsHost.reply(id,commentId);},
  momentsDrawImage:(id,allowPaid,tags)=>{check();return momentsHost.drawImage(id,{allowPaid,tags:typeof tags==='string'?tags:''});},
  momentsBusy:()=>{check();return momentsHost.busy();},
  forumRefresh:()=>{check();return appsHost.forumRefresh();},
  forumReact:id=>{check();return appsHost.forumReact(id);},
  forumReply:(id,replyId)=>{check();return appsHost.forumReply(id,replyId);},
  forumBusy:()=>{check();return appsHost.busy('forum');},
  peekLook:(name,keep)=>{check();return appsHost.peekLook(name,{keep:keep===true});},
  memoryTidy:threadId=>{check();return memoryHost.tidy(threadId,{force:true});},
  memoryStatus:threadId=>{check();return memoryHost.status(threadId);},
  storySources:()=>{check();return memoryHost.storySources();},
  peekBusy:()=>{check();return appsHost.busy('peek');},
  peekDraw:(name,index,allowPaid)=>{check();return appsHost.peekDraw(name,index,{allowPaid});},
  callStatus:()=>{check();return callHost.status();},
  callStoryScan:async()=>{check();await storySync.sync();await storyCalls.scanLatest({force:true});return storyCalls.status();},
  callDial:name=>{check();return callHost.dial(name);},
  callAnswer:()=>{check();return callHost.answer();},
  callDecline:()=>{check();return callHost.decline();},
  callHangup:()=>{check();return callHost.hangup();},
  callSay:text=>{check();return callHost.say(text);},
  callReply:()=>{check();return callHost.reply();},
  callRetry:()=>{check();return callHost.retry();},
  callReplay:index=>{check();return callHost.replay(index);},
  takeThread:()=>{check();const id=pendingThread;pendingThread=null;return id;},
  takeApp:()=>{check();const name=pendingApp;pendingApp=null;return name;},
   playFavorite:id=>{check();playbackMessage=null;return api.playFavorite(id);},
  diagnose:()=>{check();return diagnose();},
  tavernAvatars:()=>{check();return tavernAvatars();},
  loreBooks:async()=>{check();return loreBooks(context);},
  panelFloating:()=>{check();return !!panel?.classList.contains('floating');},
  panelDrag:(phase,sx,sy)=>{check();return panelDrag(phase,sx,sy);},
  panelSize:()=>{check();return panelSize();},
  panelFull:on=>{check();return panelFull(on);},
  panelSizeName:()=>{check();return PANEL_NAMES[place.size||'m'];},
  userName:()=>{check();return context()?.name1||'';},
  exportBackup:async(parts,options)=>{check();const manifest=await fetch(new URL('manifest.json',base)).then(r=>r.ok?r.json():null).catch(()=>null);return api.exportBackup(parts,manifest?.version||'',options);},
  vnStart:from=>{check();return vnHost.open(from);},
  // 绘本 (host-book.js): the open chat, its story, the text model, reading a page, a page's sound for an export.
  bookInfo:()=>{check();return bookHost.info();},bookSource:(from,to)=>{check();return bookHost.source(Number(from)||0,to==null?Infinity:Number(to));},bookWrite:(system,user,options)=>{check();return bookHost.write(system,user,options||{});},
  bookRead:(lines,onLine)=>{check();playbackMessage=null;return bookHost.read(Array.isArray(lines)?structuredClone(lines):[],{onLine:typeof onLine==='function'?onLine:null});},bookSound:(kind,name)=>{check();return bookHost.sound(String(kind||''),String(name||''));},bookSounds:()=>{check();return bookHost.soundList();},bookAudio:lines=>{check();return bookHost.audio(Array.isArray(lines)?structuredClone(lines):[]);},bookNarration:()=>{check();return bookHost.narration();},bookStage:(id,at)=>{check();return bookHost.open(String(id||''),Number(at)||0);},
  gameStart:name=>{check();return openGame(String(name));},
  vnSprite:(name,blob,options)=>{check();const o=options||{};return vnHost.setSprite(name,blob,{look:String(o.look||''),outfit:String(o.outfit||''),seed:Number(o.seed),add:o.add===true,use:String(o.use||''),drop:typeof o.drop==='string'?o.drop:'',mix:typeof o.mix==='boolean'?o.mix:undefined,dropOutfit:o.dropOutfit===true});},
  vnWear:()=>{check();return vnHost.wear();},
  vnSetWear:(name,id)=>{check();return vnHost.setWear(name,id);},vnMoveFile:(blob,options)=>{check();const o=options||{};return vnHost.setMoveFile(blob||null,{id:String(o.id||''),...(o.label!=null?{label:String(o.label)}:{}),...(o.words!=null?{words:Array.isArray(o.words)?o.words.map(String):String(o.words)}:{}),remove:o.remove===true});},vnModel:(name,blob,options)=>{check();const o=options||{};return vnHost.setModel(name,blob||null,{id:String(o.id||''),...(o.use!==undefined?{use:String(o.use||'')}:{}),remove:o.remove===true,...(o.frame!=null?{frame:String(o.frame)}:{}),...(o.zoom!=null?{zoom:Number(o.zoom)}:{}),...(o.lift!=null?{lift:Number(o.lift)}:{}),...(o.map&&typeof o.map==='object'?{map:structuredClone(o.map)}:{}),...(Array.isArray(o.keep)?{keep:o.keep.map(String)}:{}),...(o.acts&&typeof o.acts==='object'?{acts:structuredClone(o.acts)}:{})});},
  vnLastPick:name=>{check();return vnHost.lastPick(String(name||''));},
  tagText:(text,mode,wish)=>{check();if(!['translate','revise'].includes(mode))throw Error('不认识的改法');return pictures.tagText(String(text||''),mode,String(wish||''));},
  noteError:text=>{check();remember(text,'error');}
 });
}
// Listened to in the capture phase, so a theme or extension that stops clicks inside messages cannot swallow it.
// A click on a wave that cannot be played always says why instead of doing nothing.
function click(event){if(!active)return;soundHost?.unlock();if(pictures?.click(event))return;const button=event.target.closest?.('[data-myphone-action]');if(!button)return;const owner=button.closest('[data-myphone-token]'),mes=button.closest('.mes[mesid]'),id=Number(mes?.getAttribute('mesid')),action=button.dataset.myphoneAction;
 if(owner?.dataset.myphoneToken!==marker){if(action!=='line'||!owner)return;event.preventDefault();
  // Drawn before this page load (kept by another extension), or moved out of the chat by a theme or extension.
  if(mes&&currentMessage(id)){healed.delete(id);redrawMessage(id,context().chat[id]);scheduleRender();notice('这段声波是刷新前画的，已经重新画好，请再点一次');}
  else notice('这段声波不在酒馆的消息里（可能被美化主题或别的插件搬动过），没法播放。可以关掉它们再刷新试试');return;}
 event.preventDefault();if(action==='settings')openPanel();else if(action==='stop')player.stop();else if(action==='toggle')player.toggle();
 else if(!mes||!currentMessage(id))notice('找不到这段声波所在的消息（可能被美化主题或别的插件改动过），请刷新页面再试');
 else if(action==='all')playMessage(id);else if(action==='line')playMessage(id,Number(owner.dataset.myphoneLine));else if(action==='sound')soundHost?.tap(id,Number(owner.dataset.myphoneSound)).catch(e=>notice(e.message));else if(action==='bgm')musicHost?.tap(id,Number(owner.dataset.myphoneBgm)).catch(e=>notice('背景音乐：'+e.message));}
const keyUnlock=()=>{if(active)soundHost?.unlock();};
function mountEntry(){const mount=document.querySelector('#extensions_settings');if(!mount)return;const entry=document.createElement('div');entry.id='myphone-extension-entry';entry.innerHTML='<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header" id="myphone-entry-header" tabindex="0"><b>MyPhone</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><div class="myphone-entry-controls"><button type="button" id="myphone-all" class="menu_button">整条播放</button><button type="button" id="myphone-toggle" class="menu_button" disabled>暂停</button><button type="button" id="myphone-stop" class="menu_button" disabled>停止</button></div><span class="myphone-status" role="status">等待播放</span><label class="checkbox_label"><input type="checkbox" id="myphone-voice-only">仅语音模式（当前聊天）</label><button type="button" id="myphone-open" class="menu_button">打开小手机</button></div></div>';entry.querySelector('#myphone-all').addEventListener('click',playSelected);entry.querySelector('#myphone-toggle').addEventListener('click',()=>player.toggle());entry.querySelector('#myphone-stop').addEventListener('click',()=>player.stop());entry.querySelector('#myphone-open').addEventListener('click',()=>openPanel());entry.querySelector('#myphone-entry-header').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.currentTarget.click();}});entry.querySelector('#myphone-voice-only').addEventListener('change',e=>setVoiceOnly(e.currentTarget.checked));mount.append(entry);paintVoiceOnly();}
// The tavern's 魔法棒 menu (left of the input) gets a 小手机 item too: a way in without the floating ball or the extensions panel.
// The menu is made when the tavern starts; an extension enabled before that waits for it a little.
function mountWand(tries=0){if(!active||document.querySelector('#myphone-wand-entry'))return;const menu=document.querySelector('#extensionsMenu');if(!menu){if(tries<40)setTimeout(()=>mountWand(tries+1),500);return;}const item=document.createElement('div');item.id='myphone-wand-entry';item.className='list-group-item flex-container flexGap5';item.title='打开 MyPhone 小手机';item.innerHTML='<div class="fa-solid fa-mobile-screen-button extensionsMenuExtensionButton"></div><span>MyPhone</span>';item.addEventListener('click',()=>openPanel());menu.append(item);}
function syncFloating(){if(!active)return;if(!settings.general.floatingEnabled){floating?.destroy();floating=null;return;}if(floating){floating.applyTheme();floating.animate();return;}floating=new FloatingPlayer({openSettings:()=>openPanel(),prepare:()=>preparePanel(),position:settings.floating,savePosition:p=>{settings.floating=p;persist(settings);},levels:()=>player.sink.levels(),loudness:()=>player.sink.loudness?.()??0,theme:()=>settings.theme,motion:()=>settings.general.waveformEnabled});floating.update({phase:player.phase,message:player.message,engine:player.engine,speaker:player.speaker});}
async function enableInternal(){if(active)return;const ctx=context();// generateRaw joined the context in 1.13.2, which also ignores minimum_client_version: this keeps older taverns out.
 if(!ctx?.setExtensionPrompt||!ctx.generateRaw||!(ctx.messageFormatter?.addHook||ctx.messageFormatting)||!ctx.updateMessageBlock||!ctx.eventSource?.on||!ctx.eventSource?.removeListener||!ctx.eventTypes||!ctx.extensionSettings||!ctx.saveSettingsDebounced){notice('MyPhone 需要 SillyTavern 1.13.2 或更新版本');return;}if(!globalThis.crypto?.getRandomValues||!globalThis.crypto?.randomUUID){notice('当前浏览器缺少随机数功能，请更新浏览器');return;}if(!globalThis.AudioContext){notice('当前浏览器没有网页音频（Web Audio）功能，不能播放语音；iPhone 需要 iOS 14.5 或更新');return;}speech=browserSpeech(window);backend=new TTSBackend({settings:ctx.extensionSettings[NAMESPACE],soundPack:new URL('sounds/',base).href,persist:storeSettings,notify:notice,change:status,unknown,speech,comfyPictures});stopDiagnostics?.();stopDiagnostics=installDiagnostics(window,(...args)=>backend?.reportDiagnostic(...args),{source:'小手机主页面',owned:text=>text.includes(base.href)});settings=backend.settings;player=backend.player;pictures=createPictureHost({context,redrawMessage,settings:seen,backend,marker,scheduleRender,notice,voice:voicePlan,speakers,voiced:id=>prepareReply(id,voiceAhead([context()?.chat?.[id]])),phone:{wanted:()=>!voiceOnly()&&!!chats?.phoneAfter(),rule:()=>chats.phoneAfterPlan(),deliver:id=>voiceOnly()?0:chats.deliver(id)},openDraw:payload=>{pendingDraw=payload;openPanel();frame?.contentWindow?.myPhoneOpenDraw?.();}});globalThis.myPhoneApp=publicApi({pictures,backend});registerDrawCommand(ctx,()=>globalThis.myPhoneApp||null,notice);memoryHost=createMemoryHost({context,settings:seen,backend,notice});voiceHost=createVoiceHost({context,settings:seen,backend,saidBy});soundHost=createSoundHost({context,settings:seen,backend,notice});callHost=createCallHost({context,settings:seen,backend,notice,ringing,memory:memoryHost,timeline:{current:ref=>storySync?.current(ref)??true}});callIsland=createCallIsland({status:()=>voiceOnly()?null:callHost.status(),phoneOpen:()=>!!panel?.open,open:()=>openPanel(),answer:()=>callHost.answer(),hangup:c=>c.state==='ringing'&&c.dir==='in'?callHost.decline():callHost.hangup(),say:text=>callHost.say(text),reply:()=>callHost.reply(),avatar:name=>{const ch=context()?.characters?.find(x=>x?.name===name);return ch?.avatar&&ch.avatar!=='none'?'/thumbnail?type=avatar&file='+encodeURIComponent(ch.avatar):'';}});backend.subscribe(e=>{if(e?.type==='call'&&!voiceOnly())callIsland?.refresh(e.call);});const tavernPic=name=>{const ch=context()?.characters?.find(x=>x?.name===name);return ch?.avatar&&ch.avatar!=='none'?'/thumbnail?type=avatar&file='+encodeURIComponent(ch.avatar):'';};msgIsland=createMessageIsland({load:id=>backend.chats.get(id),phoneOpen:()=>!!panel?.open,openChat:id=>{pendingThread=id;openPanel();frame?.contentWindow?.myPhoneOpenThread?.();},send:(id,text)=>backend.chatMutate(id,()=>backend.appendChat(id,[{from:'me',kind:'text',text}],{read:true})),ask:id=>chats.reply(id),read:id=>backend.chatMutate(id,()=>backend.chats.markRead(id)),avatar:tavernPic,label:name=>settings?.chat?.remarks?.[name]||name});// 动态小窗: what is new in 朋友圈 while the phone is away; a tap opens the phone on 动态.
 noteIsland=createNoteIsland({phoneOpen:()=>!!panel?.open,open:()=>{pendingApp='chat:moments';openPanel();frame?.contentWindow?.myPhoneOpenApp?.();},avatar:tavernPic,label:name=>settings?.chat?.remarks?.[name]||name});momentsWatch=watchMoments({backend,notify:notes=>{if(!voiceOnly())noteIsland?.show(notes);}});
 backend.subscribe(e=>{if(voiceOnly()||e?.type!=='chat'||!msgIsland)return;if(e.incoming)msgIsland.show(e.threadId);else if(e.typing!==undefined)msgIsland.typing(e.threadId,e.typing);else msgIsland.changed(e.threadId);});storySync=createStorySync({context,backend,busy:streaming,enabled:()=>!voiceOnly(),notice,deliver:(id,options)=>chats.deliver(id,options),persist:async()=>{const ctx=context();if(typeof ctx?.saveChat==='function'){await ctx.saveChat();return;}const script=await import('/script.js');const save=script.saveChatConditional||script.saveChat;if(typeof save==='function')await save();else ctx?.saveMetadataDebounced?.();}});backend.chats.setStoryClock((m,latest)=>resolveStoryClock(context(),m,latest));socialHost=createSocialHost({context,settings:seen,backend});storyCalls=createStoryCalls({context,settings:seen,backend,enabled:()=>!voiceOnly(),callHost,timeline:storySync,notice});groupHost=createGroupHost({context,backend,enabled:()=>!voiceOnly(),timeline:storySync,notice});chats=createChatHost({context,settings:seen,backend,enabled:()=>!voiceOnly(),timeline:storySync,notice,memory:memoryHost,onPosts:posts=>momentsHost?.drawNew(posts),onCall:(name,reason,ref)=>{if(ref&&(!freshCallSources.has(ref.story+'|'+ref.ver)||storyCalls?.handles(ref)))return;try{callHost.ring(name,{reason,source:ref});}catch{}}});momentsHost=createMomentsHost({context,settings:seen,backend,enabled:()=>!voiceOnly(),notice,memory:memoryHost});wardrobeHost=createWardrobeHost({context,settings:seen,backend,notice});generatorHost=createGeneratorHost({context,settings:seen,backend,notice,memory:memoryHost});appsHost=createAppsHost({context,settings:seen,backend,memory:memoryHost});musicHost=createMusicHost({context,settings:seen,backend,notice});songHost=createSongHost({context,settings:seen,backend,memory:memoryHost});musicIsland=createMusicIsland({status:()=>musicHost.status(),phoneOpen:()=>!!panel?.open,callShown:()=>!!callIsland?.shown,open:()=>{pendingApp='music';openPanel();frame?.contentWindow?.myPhoneOpenApp?.();},toggle:()=>musicHost.toggle(),next:()=>musicHost.next()});backend.subscribe(e=>{if(e?.type==='music'||e?.type==='call'){musicIsland?.refresh();voiceIsland?.refresh();}});voiceIsland=createVoiceIsland({enabled:()=>settings.general.voiceIsland===true&&voiceOn(),latest:voiceWindowLines,now:()=>({id:playbackMessage?.id,index:player.index,transport:player.transport(),line:player.queue[player.index],narration:player.queue[player.index]?.narration?player.queue[player.index].text:'',phase:player.phase,stepwise:!!player.stepwise,boundary:!!player.boundary}),playStep:playStepMessage,setMode:(id,stepwise)=>{if(playbackMessage?.id===id&&voiceUnchanged(playbackMessage)&&['playing','generating','paused'].includes(player.phase)){player.stepwise=stepwise;player.emit(player.phase,player.message);}},startNow:()=>{player.playNow=true;},seek:seconds=>{if(!player.seekBy(seconds))notice('系统朗读暂不支持精确跳秒，请点选下方段落');},seekTo:seconds=>player.seekTo(seconds),rate:value=>player.setRate(value),play:playWindowLine,playAll:id=>playMessage(id),toggle:()=>player.toggle(),phoneOpen:()=>!!panel?.open,callShown:()=>!!callIsland?.shown});vnHost=createVnHost({context,settings:seen,backend,linesOf:id=>{const snap=currentMessage(id);return snap?messageLines(snap):[];},voiced:lineVoiced,play:playLine,narrate:narrateLine,sound:(id,index,o)=>soundHost?.stage(id,index,o).catch(()=>{}),music:(id,index)=>musicHost?.stage(id,index),sounds:soundsOn,musicOn:()=>settings?.music?.bgm==='auto',stop:()=>{if(['playing','generating','paused','waiting'].includes(player.phase))player.stop();},voiceOn,avatars:tavernAvatars,notice,closePanel:()=>{if(panel?.open)panel.close();},mouth:()=>player.sink.mouth?.()||null});bookHost=createBookHost({context,settings:seen,backend,sprite:(name,emotion)=>vnHost.bookSprite(name,emotion),sounds:()=>soundHost,closePanel:()=>{if(panel?.open)panel.close();},steps:id=>vnHost.bookSteps(id),lines:id=>{const snap=currentMessage(id);return snap?messageLines(snap).map((line,uiIndex)=>({...line,uiIndex})):[];},voiced:lineVoiced,speech,active:()=>active});assistantHost=createAssistantHost({context,settings:seen,backend,regex:await import('/scripts/extensions/regex/engine.js').catch(()=>null)});await backend.initialize();memoryHost.refreshStory();if(!voiceOnly())chats.tidyNotes().catch(()=>{});backend.setSyncFiles(tavernFiles());backend.syncDeviceName=deviceName();if(backend.settings.sync.enabled)backend.syncNow().catch(()=>{});document.addEventListener('visibilitychange',flushSync);watchPanelLayout(true);ctx.extensionSettings[NAMESPACE]=structuredClone(settings);ctx.saveSettingsDebounced();active=true;lineMedia=matchMedia('(prefers-reduced-motion: reduce)');lineMedia.addEventListener('change',animateLines);document.addEventListener('visibilitychange',animateLines);globalThis.__myPhoneAppPanelBridge={connect};
 legacy=!ctx.messageFormatter?.addHook;
 if(!hooked&&!legacy){const late=!!ctx.messageFormatter.stage?.AFTER_MARKDOWN;ctx.messageFormatter.addHook((text,meta)=>{if(!active||meta.isUser||meta.isSystem||meta.isReasoning||meta.messageId<0)return text;try{const out=transform(text,late,Number(meta.messageId));if(late)markRoles.set(Number(meta.messageId),{roles:lastRoles,inner:lastInner});return out;}catch{return text;}},{stage:ctx.messageFormatter.stage.BEFORE_REGEX,order:100});
 // A 前端美化 card's regex wraps runs of text: before it the lines are only marks, after Markdown they become waves.
 if(late)ctx.messageFormatter.addHook((text,meta)=>{if(!active||meta.isUser||meta.isSystem||meta.isReasoning||meta.messageId<0)return text;try{if(!storyWavesOn())return unmark(text);const m=markRoles.get(Number(meta.messageId));return waveMarks(text,marker,m?.roles||[],m?.inner||[]);}catch{return unmark(text);}},{stage:ctx.messageFormatter.stage.AFTER_MARKDOWN,order:100});
 // After a 前端美化 card's regex: waves it put into a code block or a whole page (drawn in a frame of its own) come back out.
 if(ctx.messageFormatter.stage.AFTER_REGEX)ctx.messageFormatter.addHook((text,meta)=>{if(!active||meta.isUser||meta.isSystem||meta.isReasoning||meta.messageId<0)return text;try{const out=unwaveFramed(text);if(out!==text)framed.add(Number(meta.messageId));else framed.delete(Number(meta.messageId));return out;}catch{return text;}},{stage:ctx.messageFormatter.stage.AFTER_REGEX,order:100});
 hooked=true;}
 const subscribe=(name,fn)=>{if(!name)return;ctx.eventSource.on(name,fn);listeners.push([ctx.eventSource,name,fn]);};subscribe(ctx.eventTypes.GENERATION_AFTER_COMMANDS,async(type,options,dryRun)=>{try{if(!voiceOnly())await memoryHost?.storyReady();}catch{}inject(type,options,dryRun);});
 // Each new story reply counts toward automatic 朋友圈 posts (off unless the user turns it on).
 storyFinalizer=createStoryFinalizer({context,streaming,settled:async floor=>{if(!voiceOnly())await chats.storyReplied(floor);wardrobeHost?.storyReplied(floor).catch(e=>backend?.reportDiagnostic('衣柜正文同步',e,'warn'));if(voiceOnly())return;const ref=storySync?.source(floor);if(ref)freshCallSources.add(ref.story+'|'+ref.ver);await Promise.all([groupHost?.scan(floor),storyCalls?.scan(floor).then(handled=>{if(!handled&&!voiceOnly())callHost?.storyReplied();})]);if(!voiceOnly())socialHost?.tick(floor).catch(()=>{});},error:e=>backend?.reportDiagnostic('正文完成同步',e,'warn')});subscribe(ctx.eventTypes.MESSAGE_RECEIVED,id=>{const floor=id??(context()?.chat||[]).length-1;storyFinalizer?.schedule(floor);if(!vnHost?.showing)soundHost?.received(id??(context()?.chat||[]).length-1);tagSpeakers((context()?.chat||[]).slice(-1));prepareReply(id??(context()?.chat||[]).length-1,voiceAhead((context()?.chat||[]).slice(-1)));if(!voiceOnly())momentsHost?.storyReplied();});subscribe(ctx.eventTypes.CHAT_CHANGED,()=>{storyFinalizer?.cancel();freshCallSources.clear();spaceChanged();if(voiceOnly())stopPhoneWork();paintVoiceOnly();backend.emit('voice-only',{on:voiceOnly()});syncFloating();inject();});subscribe(ctx.eventTypes.CHAT_CHANGED,()=>{const owner=storySync;setTimeout(()=>{if(active&&!voiceOnly()&&storySync===owner)owner.sync().then(()=>storyCalls?.scanLatest()).catch(e=>backend?.reportDiagnostic('正文电话恢复',e,'warn'));},250);});subscribe(ctx.eventTypes.CHAT_CHANGED,()=>{if(!voiceOnly())callHost?.syncSources();});spaceChanged();if(!voiceOnly())storySync.sync().then(()=>storyCalls?.scanLatest()).catch(e=>backend?.reportDiagnostic('正文电话恢复',e,'warn'));for(const event of ['MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED','CHAT_CHANGED'])subscribe(ctx.eventTypes[event],()=>storySync?.schedule({allowEmpty:event==='MESSAGE_DELETED'}));for(const event of ['MESSAGE_SWIPED','MESSAGE_EDITED'])subscribe(ctx.eventTypes[event],id=>{if(!Number.isInteger(Number(id)))return;const owner=storySync;setTimeout(()=>{if(active&&!voiceOnly()&&storySync===owner)owner.sync().then(()=>Promise.all([groupHost?.scan(Number(id)),storyCalls?.scan(Number(id))])).catch(e=>backend?.reportDiagnostic('正文版本同步',e,'warn'));},170);});subscribe(ctx.eventTypes.CHAT_CHANGED,()=>soundHost?.chatChanged());soundHost.chatChanged();for(const event of ['MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED'])subscribe(ctx.eventTypes[event],id=>soundHost?.messageChanged(event==='MESSAGE_DELETED'?undefined:id));
 for(const event of ['CHAT_CHANGED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED'])subscribe(ctx.eventTypes[event],()=>{storyTools?.close();const keep=event==='MESSAGE_EDITED'&&playbackMessage&&voiceUnchanged(playbackMessage);if(!keep)player.stop('消息已变化');preparing?.abort();scheduleRender();});for(const event of ['CHARACTER_MESSAGE_RENDERED','MESSAGE_RECEIVED'])subscribe(ctx.eventTypes[event],scheduleRender);subscribe(ctx.eventTypes.CHAT_CHANGED,()=>vnHost?.close());for(const event of ['GENERATION_STOPPED','GENERATION_ENDED'])subscribe(ctx.eventTypes[event],()=>{vnHost?.ended();storyFinalizer?.schedule();});subscribe(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED,id=>{const chat=context()?.chat||[];let latest=chat.length-1;while(latest>=0&&(chat[latest].is_user||chat[latest].is_system))latest--;if(Number(id)===latest)storyFinalizer?.rendered(latest);const staged=!!vnHost?.showing;vnHost?.rendered(id);if(!staged){soundHost?.rendered(id);musicHost?.rendered(id);}pictures?.autoPictures(Number(id)).catch(e=>notice(e.message));});
 storyTools=createStoryTools({hidden:()=>settings.general.hideStoryWaves===true,entry:()=>settings.general.storyTools!==false,message:currentMessage,valid:unchanged,notice,
 wave:(button,snap)=>{const owner=button.closest('[data-myphone-token]');return owner?.dataset.myphoneToken===marker?messageLines(snap)[Number(owner.dataset.myphoneLine)]:null;},
 actions:{download:async line=>{const file=await backend.audioFile({line});await saveFile(document,file.blob,file.name);},favorite:async line=>{const key=await player.lineKey(line);if(!key)throw Error('这句还没有生成语音，先播放一次');await backend.favoriteAudio(key);notice('已收藏');},
 dialogue:openVoiceWindow,draw:id=>pictures.drawMessage(id),vn:id=>vnHost.open(id),playing:id=>playbackMessage?.id===id&&['playing','generating','paused','waiting'].includes(player.phase),stop:()=>player.stop(),play:id=>{if(!voiceOn())throw Error('请先打开正文语音');if(!messageLines(currentMessage(id)).length)throw Error('这层楼还没有配音台词');return playMessage(id);}}});
 document.addEventListener('click',click,true);document.addEventListener('keydown',keyUnlock,true);mountEntry();mountWand();syncFloating();observer=new MutationObserver(chatChanged);const chat=document.querySelector('#chat');if(chat)observer.observe(chat,{childList:true,subtree:true});inject();rerender();}
export function enable(){if(enabling)return enabling;enabling=enableInternal().finally(()=>{enabling=null;});return enabling;}
export async function disable(){storyFinalizer?.dispose();storyFinalizer=null;storyCalls?.dispose();storySync?.dispose();groupHost?.dispose();socialHost?.cancel();if(enabling)await enabling;stopDiagnostics?.();stopDiagnostics=null;if(!active)return;active=false;closeGame();renderEpoch++;cancelAnimationFrame(lineRaf);lineMedia?.removeEventListener('change',animateLines);document.removeEventListener('visibilitychange',animateLines);voiceWindowMessage=voiceWindowTail=null;playbackMessage=selectedMessage=dialogueMessage=null;dialogueRevision++;dialogueChoices.clear();healed.clear();player.stop();clearPrompts();for(const [source,event,fn] of listeners)source.removeListener(event,fn);listeners.length=0;observer?.disconnect();clearTimeout(renderTimer);renderTimer=0;document.removeEventListener('click',click,true);document.removeEventListener('keydown',keyUnlock,true);document.removeEventListener('visibilitychange',flushSync);watchPanelLayout(false);document.querySelector('#myphone-extension-entry')?.remove();document.querySelector('#myphone-wand-entry')?.remove();floating?.destroy();floating=null;document.querySelectorAll('[data-myphone-owned="toolbar"]').forEach(el=>el.remove());panel?.remove();panel=frame=null;delete globalThis.__myPhoneAppPanelBridge;storyTools?.dispose();storyTools=null;vnHost?.dispose();vnHost=null;pictures=null;delete globalThis.myPhoneApp;chats=null;momentsHost=null;wardrobeHost=null;generatorHost=null;appsHost=null;assistantHost?.close();assistantHost=null;songHost=null;musicHost?.close();musicHost=null;musicIsland?.dispose();musicIsland=null;voiceIsland?.dispose();voiceIsland=null;momentsWatch?.dispose();momentsWatch=null;noteIsland?.dispose();noteIsland=null;callHost?.dispose();callHost=null;memoryHost?.close();memoryHost=null;voiceHost=null;soundHost?.close();soundHost=null;pendingDraw=null;await backend.close();rerender();}
export const dispose=disable;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>enable().catch(e=>notice(e.message)),{once:true});else enable().catch(e=>notice(e.message));
