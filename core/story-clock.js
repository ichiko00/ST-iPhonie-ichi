import {storyHash} from './story-sync.js';
export function parseStoryClock(raw){
 const text=String(raw||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,'\n').replace(/&nbsp;|&#160;/g,' ');
 let date='',time='';
 for(const line of text.split(/\n/)){
  if(/明天|后天|约定|预约|计划|如果|假如|昨天|回忆|将于/.test(line))continue;
  const d=line.match(/(?<!\d)(\d{4})[年.\/-](\d{1,2})[月.\/-](\d{1,2})(?:日)?(?!\d)/);
  if(d&&+d[2]>=1&&+d[2]<=12&&+d[3]>=1&&+d[3]<=31)date=d[1]+'-'+d[2].padStart(2,'0')+'-'+d[3].padStart(2,'0');
  const t=line.match(/(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/);
  if(t&&(/时间|时刻|当前|现在|🕒|🕐|🕰|⌚|⏰|🕑|🕓|🕔|🕕|🕖|🕗|🕘|🕙|🕚|🕛/.test(line)||d||/^\s*(?:[|｜·•*`_ -]*)(?:[01]?\d|2[0-3])[:：][0-5]\d(?:[|｜·•*`_ -]*)\s*$/.test(line)))time=t[1].padStart(2,'0')+':'+t[2];
 }
 return date||time?{date,time}:null;
}
export function resolveStoryClock(ctx,message={},latest=false){
 const chat=ctx?.chat||[],ref=message.callSource?.story?{story:message.callSource.story,ver:message.callSource.ver}:message.story?{story:message.story,ver:message.storyVer}:null;
 let index=chat.length-1;
 if(ref){const uid=ctx?.chatMetadata?.myPhoneTimeline?.chatUid;if(!uid||!ref.story.startsWith('mp2:'+uid+'/'))return null;const floor=ref.story.slice(('mp2:'+uid+'/').length);index=chat.findIndex(m=>(m.myPhoneFloorId||m.extra?.myPhoneFloorId)===floor);if(index<0)return null;}
 else if(!latest)return null;
 let date='',time='';
 for(let i=index;i>=0;i--){const m=chat[i];if(!m||m.is_user||m.is_system)continue;let raw=m.mes;if(i===index&&ref&&ref.ver&&storyHash(raw)!==ref.ver){raw=(m.swipes||[]).find(s=>storyHash(s)===ref.ver);if(!raw)return null;}const clock=parseStoryClock(raw);if(!clock)continue;if(!date&&clock.date)date=clock.date;if(!time&&clock.time)time=clock.time;if(date&&time)break;}
 return date||time?{date,time}:null;
}
export function storyClockLabel(clock){return clock?[clock.date,clock.time].filter(Boolean).join(' '):'';}
