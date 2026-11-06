import {storySnapshot,hydrateStoryMetadata} from './core/story-sync.js';
export function createStorySync({context,backend,deliver,notice=()=>{},persist=async()=>{},busy=()=>false}){
 let queue=Promise.resolve(),timer=null,closed=false,lastWarning='',pendingOptions=null;
 const snapshot=()=>storySnapshot(context());
 function source(index){const view=snapshot();return view?.sources.find(s=>s.index===Number(index))||null;}
 function current(ref){if(!ref)return true;const view=snapshot();return!!view?.sources.some(s=>s.story===ref.story&&s.ver===ref.ver);}
 async function run({allowEmpty=false,deliverNew=true}={}){
  if(closed||busy())return{delivered:0,deferred:true};const ctx=context();if(!ctx?.chatMetadata?.myPhoneTimeline){const docs=await backend.chats.exportStoryArchives?.()||[];hydrateStoryMetadata(ctx,docs);}
  const view=snapshot();if(!view)return{delivered:0};
  if(view.changed){context()?.saveMetadataDebounced?.();await persist().catch(error=>backend.reportDiagnostic?.('楼层标识保存',error,'warn'));}
  if(closed||snapshot()?.chatUid!==view.chatUid)return{delivered:0};
  const before=new Map((await backend.chats.exportThreads()).map(t=>[t.id,t]));
  if(closed||snapshot()?.chatUid!==view.chatUid)return{delivered:0};
  if(busy()){return{delivered:0,deferred:true};}
  if(view.sources.some(ref=>!current(ref))){schedule({allowEmpty,deliverNew});return{delivered:0,deferred:true};}
  const result=await backend.chats.syncStory(view,{allowEmpty});
  for(const id of result.changed){const after=await backend.chats.get(id),gone=(before.get(id)?.messages||[]).filter(m=>!(after?.messages||[]).some(n=>n.id===m.id));if(gone.length){backend.noteGone?.('chats',gone.map(m=>`${id}/${m.id}`));await backend.memoryAfterDelete?.(id,before.get(id),after).catch(()=>{});}backend.emit('chat',{threadId:id,storySync:true});}
  const warning=result.warnings.join('；');if(warning&&warning!==lastWarning){notice(warning);lastWarning=warning;}
  let delivered=0;
  if(deliverNew&&backend.settings?.chat?.proactive?.on!==false)for(const key of result.needsDelivery){const ref=view.sources.find(s=>s.story===key);if(closed||!current(ref))continue;delivered+=await deliver(ref.index,{source:ref})||0;if(!current(ref)){schedule({allowEmpty});continue;}await backend.chats.markStoryDelivered(ref);}
  // Capture exact generated IDs (and edits/media) so returning to a swipe restores the same messages.
  if(delivered&&snapshot()?.chatUid===view.chatUid){
    const prior=new Map((await backend.chats.exportThreads()).map(t=>[t.id,t]));
    const captured=await backend.chats.syncStory(snapshot(),{allowEmpty});
    for(const id of captured.changed){const after=await backend.chats.get(id),gone=(prior.get(id)?.messages||[]).filter(m=>!(after?.messages||[]).some(n=>n.id===m.id));if(gone.length){backend.noteGone?.('chats',gone.map(m=>`${id}/${m.id}`));await backend.memoryAfterDelete?.(id,prior.get(id),after).catch(()=>{});}backend.emit('chat',{threadId:id,storySync:true});}
  }
  if(result.removed.length)notice(`已随正文更新 ${result.removed.length} 条关联消息，独立手机聊天已保留`);
  return{...result,delivered};
 }
 function sync(options={}){const job=queue.then(()=>run(options));queue=job.catch(error=>backend.reportDiagnostic?.('正文手机同步',error,'warn'));return job;}
 function schedule(options={}){if(closed)return;pendingOptions={allowEmpty:pendingOptions?.allowEmpty||options.allowEmpty===true,deliverNew:pendingOptions?.deliverNew||options.deliverNew!==false};clearTimeout(timer);timer=setTimeout(()=>{const next=pendingOptions;pendingOptions=null;sync(next).catch(error=>notice(error.message));},140);}
 const unsubscribe=backend.subscribe?.(event=>{if(event?.type==='chat'&&!event.storySync&&!('typing' in event))schedule({deliverNew:false});});
 return{source,current,sync,schedule,dispose:()=>{closed=true;clearTimeout(timer);unsubscribe?.();}};
}
