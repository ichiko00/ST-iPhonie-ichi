import {cleanHeart} from '../core/heart.js';
export function installAvatarThoughts({root,win,doc,messageFor,enabled=()=>true,onPat,shown=n=>n,notify=()=>{},delay=320}){
 let clickTimer=0,hideTimer=0,bubble=null;
 const clear=()=>{win.clearTimeout(hideTimer);bubble?.remove();bubble=null;};
 const target=e=>{const el=e.target.closest?.('[data-pat]');return el&&root.contains(el)?el:null;};
 function show(el){if(!enabled()||!el.isConnected)return;const message=messageFor(el),heart=cleanHeart(message?.heart);if(!heart){notify('💭 这轮还没有心声，新回复会附带生成');return;}clear();bubble=doc.createElement('div');bubble.className='avatar-thought';bubble.setAttribute('role','status');bubble.setAttribute('aria-label',shown(el.dataset.pat)+'的心声');const icon=doc.createElement('span');icon.className='thought-icon';icon.textContent='💭';icon.setAttribute('aria-hidden','true');const words=doc.createElement('span');words.textContent=heart;bubble.append(icon,words);el.append(bubble);const anchor=el.querySelector('.avatar')||el,r=anchor.getBoundingClientRect(),scaleX=r.width/(anchor.offsetWidth||r.width||1),scaleY=r.height/(anchor.offsetHeight||r.height||1),bounds=el.closest('.msgs')?.getBoundingClientRect()||{left:0,top:0,right:win.innerWidth,bottom:win.innerHeight};
 const room=Math.max(100,(bounds.right-r.right-16)/(scaleX||1));bubble.style.maxWidth=Math.min(220,room)+'px';bubble.style.left='calc(100% + 8px)';bubble.style.top='0px';
 const br=bubble.getBoundingClientRect();if(br.right>bounds.right-8){bubble.style.left='auto';bubble.style.right='calc(100% + 8px)';if(bubble.getBoundingClientRect().left<bounds.left+8){bubble.style.left='0px';bubble.style.right='auto';bubble.style.top='calc(100% + 6px)';}}
 const placed=bubble.getBoundingClientRect(),dy=placed.bottom>bounds.bottom-8?bounds.bottom-8-placed.bottom:placed.top<bounds.top+8?bounds.top+8-placed.top:0;if(dy)bubble.style.marginTop=(dy/(scaleY||1))+'px';
 hideTimer=win.setTimeout(clear,4500);}
 const click=e=>{const el=target(e);if(!el||!enabled())return;win.clearTimeout(clickTimer);if(e.detail>=2)return;clickTimer=win.setTimeout(()=>show(el),delay);};
 const double=e=>{const el=target(e);if(!el||!enabled())return;win.clearTimeout(clickTimer);clear();onPat(el.dataset.pat);};
 const key=e=>{const el=target(e);if(el&&enabled()&&['Enter',' '].includes(e.key)){e.preventDefault();show(el);}};
 root.addEventListener('click',click);root.addEventListener('dblclick',double);root.addEventListener('keydown',key);
 return{dispose(){win.clearTimeout(clickTimer);clear();root.removeEventListener('click',click);root.removeEventListener('dblclick',double);root.removeEventListener('keydown',key);}};
}
