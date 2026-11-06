import {storyHash} from './story-sync.js';
// Message-received may precede the final streamed text in Tavern forks.
export function createStoryFinalizer({context,streaming=()=>false,settled,error=()=>{},delay=180}){
 let timer=null,closed=false,epoch=0;const done=new Set(),inFlight=new Set();
 const owner=()=>String(context()?.getCurrentChatId?.()||context()?.chatId||'');
 function cancel(){epoch++;clearTimeout(timer);timer=null;}
 function schedule(id){
  if(closed)return;cancel();const ticket=epoch,chatOwner=owner();let prior='',stable=0,tries=0;
  const tick=async()=>{
   if(closed||ticket!==epoch||owner()!==chatOwner)return;timer=null;
   const ctx=context(),chat=ctx?.chat||[];let index=Number.isInteger(Number(id))&&id!==undefined?Number(id):chat.length-1;
   while(index>=0&&(chat[index]?.is_user||chat[index]?.is_system))index--;
   const m=chat[index];
   if(streaming()||!m||typeof m.mes!=='string'||!m.mes.trim()){prior='';stable=0;}
   else{const raw=m.mes,signature=chatOwner+'|'+index+'|'+storyHash(raw);stable=signature===prior?stable+1:0;prior=signature;
    if(stable>=1){if(done.has(signature)||inFlight.has(signature))return;inFlight.add(signature);try{await settled(index);if(!closed&&owner()===chatOwner&&chat[index]?.mes===raw){done.add(signature);if(done.size>200)done.delete(done.values().next().value);}}catch(e){error(e);}finally{inFlight.delete(signature);}return;}
   }
   if(++tries<350)timer=setTimeout(tick,delay);else error(Error('正文生成尚未稳定，等待下一次正文事件重试'));
  };timer=setTimeout(tick,delay);
 }
 return{schedule,rendered(id){if(timer!==null||inFlight.size)schedule(id);},cancel,dispose(){closed=true;cancel();}};
}
