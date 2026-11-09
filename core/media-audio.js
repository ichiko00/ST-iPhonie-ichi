// iOS background audio must stay on a persistent media element, not an AudioBufferSourceNode.
export function prefersMediaAudio(nav=globalThis.navigator){return !!nav&&(/iPhone|iPad|iPod/i.test(nav.userAgent||'')||nav.platform==='MacIntel'&&nav.maxTouchPoints>1);}
const aborted=()=>new DOMException('已停止','AbortError');
function primeWave(){const b=new ArrayBuffer(364),v=new DataView(b);const text=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));text(0,'RIFF');v.setUint32(4,356,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,320,true);return new Blob([b],{type:'audio/wav'});}
export class MediaElementAudio{
 constructor({doc=globalThis.document,nav=globalThis.navigator,urls=globalThis.URL,create=()=>doc.createElement('audio')}={}){
  this.create=create;this.measured=new WeakMap();this.nav=nav;this.urls=urls;this.audio=create();this.audio.preload='auto';this.audio.setAttribute('playsinline','');this.audio.setAttribute('webkit-playsinline','');this.audio.setAttribute('aria-hidden','true');this.audio.style.cssText='position:fixed;width:1px;height:1px;left:-4px;bottom:0;opacity:0;pointer-events:none';(doc.body||doc.documentElement).append(this.audio);this.volume=1;this.finish=null;this.primeUrl=null;this.unlocked=false;this.epoch=0;this.sessionOwned=false;this.playRequest=0;
 }
 unlock(){
  try{if(this.nav.audioSession&&this.nav.audioSession.type!=='playback'){this.priorSession??=this.nav.audioSession.type;this.nav.audioSession.type='playback';}}catch{}
  if(this.unlocked||this.finish)return Promise.resolve();
  const epoch=this.epoch;this.primeUrl??=this.urls.createObjectURL(primeWave());this.audio.src=this.primeUrl;
  return Promise.resolve(this.audio.play()).then(()=>{this.unlocked=true;if(epoch===this.epoch&&!this.finish)this.audio.pause();});
 }
 warm(){return Promise.resolve();}
 setVolume(value){const n=Number(value);if(!Number.isFinite(n))throw TypeError('音量必须是有效数字');this.volume=Math.max(0,Math.min(1,n));this.audio.volume=this.volume;return this.volume;}
 getVolume(){return this.volume;}
 position(){return Number(this.audio.currentTime)||0;}
 setRate(rate){this.audio.playbackRate=rate;}
 duration(blob){
  if(this.measured.has(blob))return this.measured.get(blob);
  const job=new Promise(resolve=>{const a=this.create(),url=this.urls.createObjectURL(blob);let timer,finished=false;const done=()=>{if(finished)return;finished=true;clearTimeout(timer);const value=Number(a.duration);a.removeAttribute('src');a.load();this.urls.revokeObjectURL(url);resolve(Number.isFinite(value)?value:0);};a.addEventListener('loadedmetadata',done,{once:true});a.addEventListener('error',done,{once:true});timer=setTimeout(done,1500);a.preload='metadata';a.src=url;});this.measured.set(blob,job);return job;
 }
 play(blob,signal=new AbortController().signal,{offset=0,rate=1}={}){
  if(signal.aborted)return Promise.reject(aborted());this.epoch++;this.audio.pause();this.finish?.(aborted());this.unlocked=true;
  if(this.primeUrl){this.urls.revokeObjectURL(this.primeUrl);this.primeUrl=null;}
  const url=this.urls.createObjectURL(blob),audio=this.audio,request=++this.playRequest;
  return new Promise((resolve,reject)=>{
   let ended=false;const finish=error=>{if(ended)return;ended=true;signal.removeEventListener('abort',cancel);audio.removeEventListener('loadedmetadata',seek);audio.removeEventListener('ended',onEnd);audio.removeEventListener('error',onError);this.urls.revokeObjectURL(url);if(this.finish===finish){this.finish=null;audio.pause();if(error){audio.removeAttribute('src');audio.load();}}error?reject(error):resolve();};
   const seek=()=>{if(offset)audio.currentTime=offset;};
   const onEnd=()=>finish(),onError=()=>finish(Error('iPhone无法播放此音频，请将配音格式改为MP3或WAV')),cancel=()=>finish(aborted());
   this.finish=finish;audio.addEventListener('ended',onEnd);audio.addEventListener('error',onError);signal.addEventListener('abort',cancel,{once:true});audio.addEventListener('loadedmetadata',seek,{once:true});audio.src=url;audio.volume=this.volume;audio.playbackRate=rate;
   if(signal.aborted){cancel();return;}try{Promise.resolve(audio.play()).catch(error=>{if(error.name==='AbortError'&&(request!==this.playRequest||audio.paused))return;finish(error.name==='NotAllowedError'?Error('请回到TT点一次播放，以允许iPhone开启声音'):error);});}catch(error){finish(error);}
  });
 }
 pause(){this.playRequest++;this.audio.pause();return Promise.resolve();}
 resume(){this.playRequest++;return this.finish?Promise.resolve(this.audio.play()):Promise.resolve();}
 stop(){this.playRequest++;this.epoch++;this.audio.pause();this.finish?.(aborted());this.audio.removeAttribute('src');this.audio.load();}
 levels(){return [0,0,0,0,0];}loudness(){return 0;}mouth(){return null;}
 controls(handlers){this.handlers=handlers;}
 state(phase,line){try{if(!['playing','paused','generating','waiting'].includes(phase)&&this.priorSession!==undefined&&this.nav.audioSession?.type==='playback')this.nav.audioSession.type=this.priorSession;}catch{}const session=this.nav?.mediaSession;if(!session)return;try{
  if(['playing','paused','generating','waiting'].includes(phase)){
   if(!this.sessionOwned){for(const action of ['play','pause','stop'])try{session.setActionHandler(action,()=>this.handlers?.[action]?.());}catch{}this.sessionOwned=true;}
   if(globalThis.MediaMetadata)session.metadata=new MediaMetadata({title:line?.role||'MyPhone',artist:'语音朗读',album:'MyPhone'});
   session.playbackState=phase==='paused'?'paused':'playing';
  }else if(this.sessionOwned){session.playbackState='none';session.metadata=null;for(const action of ['play','pause','stop'])try{session.setActionHandler(action,null);}catch{}this.sessionOwned=false;}
 }catch{}}
 close(){this.stop();this.state('idle');if(this.primeUrl)this.urls.revokeObjectURL(this.primeUrl);this.audio.remove();try{if(this.priorSession!==undefined&&this.nav.audioSession?.type==='playback')this.nav.audioSession.type=this.priorSession;}catch{}return Promise.resolve();}
}
