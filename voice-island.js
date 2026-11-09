import {voiceDisplay} from './core/voice-display.js';
import {splitBilingual} from './core/bilingual.js';
// 台词小窗 on the tavern page (设置 → 台词小窗, off at first): the latest story reply's voiced lines in a small pill over
// the story — and over a visual-novel sprite that may cover the waves in the text — so they can be heard one by one at
// the reader's pace. The pill says how many lines there are (or shows the one being said); a tap opens the list: tap a
// line to hear it (again to pause), 整条 plays them all, ✕ puts it away until the next reply; a tap elsewhere takes it
// back in. Drag it anywhere (kept by its middle); at the default place it lines up with the other islands at the top.
// It steps aside while the phone is out or a call is on.
import {joinStack, stackTop} from './island-stack.js';

export function islandDialogueText(line){const original=voiceDisplay(line.text),translation=voiceDisplay(line.translation),pair=splitBilingual(original,translation);return{primary:pair.translation||translation||original,secondary:pair.translation?pair.original:''};}
const KEY = 'myphone.voiceIsland';
const HEIGHT_KEY = KEY + '.height';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const WAVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M7 7l10 10M17 7 7 17"/></svg>';
const SKIP = forward => `<svg viewBox="0 0 32 32" aria-hidden="true"><g ${forward?'transform="translate(32 0) scale(-1 1)"':''}><path d="M15 5a11 11 0 1 1-10 11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M16 1.2 10.8 5 16 8.8Z" fill="currentColor"/></g><text x="16" y="21" text-anchor="middle" fill="currentColor" font-size="12" font-family="system-ui" font-weight="600">15</text></svg>`;
const LIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const clock = n => `${Math.floor((n||0)/60)}:${String(Math.floor((n||0)%60)).padStart(2,'0')}`;
const lineLabel = l => l.translationRead ? '译文 · '+(l.sourceRole||'旁白') : l.narration ? '旁白' : l.role||'台词';
const BUSY = ['playing', 'generating'];

/**
 * enabled(): the setting is on. latest(): {id, name, lines: [{role, text, translation}]} of the latest reply with lines,
 * or null. now(): {id, index, phase} of what is being said. play(id, index): that line (again: pause/resume).
 * playAll(id): every line. phoneOpen(), callShown(): whether to step aside.
 */
export function createVoiceIsland({doc = document, enabled, latest, now, play, playAll, playStep = null, setMode = null, toggle = null, seek = null, seekTo = null, rate = null, startNow = null, phoneOpen, callShown = () => false}) {
  const win = doc.defaultView;
  const el = doc.createElement('div');
  el.className = 'myphone-voice-island';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.innerHTML = `<div class="vi-pill"><span class="vi-ico">${WAVE}</span><span class="vi-line"><span class="vi-scroll" data-vi-line></span></span><span class="vi-bars" aria-hidden="true"><i></i><i></i><i></i></span></div>
    <div class="vi-card"><div class="vi-head"><span class="vi-ico">${WAVE}</span><b data-vi-title></b><div class="vi-mode" role="group" aria-label="朗读模式"><button type="button" data-vi="mode-all" aria-pressed="true">全文</button><button type="button" data-vi="mode-step" aria-pressed="false">逐句</button></div></div>
      <div class="vi-current"><b data-vi-speaker></b><div data-vi-current></div></div>
      <div class="vi-progress"><input data-vi-progress type="range" min="0" max="1" step="0.1" value="0" aria-label="当前段落播放进度"><div class="vi-times"><span data-vi-time></span><span data-vi-buffer></span></div></div>
      <button type="button" class="vi-btn vi-start-now" data-vi="now" hidden>现在播放</button><div class="vi-controls"><button class="vi-btn vi-skip" type="button" data-vi="back" aria-label="后退15秒">${SKIP(false)}</button><button type="button" class="vi-btn vi-all" data-vi="all"></button><button class="vi-btn vi-skip" type="button" data-vi="forward" aria-label="快进15秒">${SKIP(true)}</button><button type="button" class="vi-btn vi-list-toggle" data-vi="close" aria-label="展开朗读列表" aria-expanded="false">${LIST}</button></div>
      <div class="vi-list" data-vi-list></div><div class="vi-resize" data-vi-resize role="separator" tabindex="0" aria-label="调整台词小窗高度" aria-orientation="horizontal"></div></div>`;
  doc.body.append(el);
  let place = null, dismissed = '', reply = null, built = '', expanded = false, width = 0, openedAt = 0, dragged = false;
  try { place = JSON.parse(win.localStorage.getItem(KEY) || 'null'); } catch { /* the top middle */ }
  const list = el.querySelector('.vi-list'), grip = el.querySelector('[data-vi-resize]');
  let selectedStep = false;
  let preferredHeight = null, sizing = null, following = '', manualUntil = 0;
  list.addEventListener('wheel',()=>manualUntil=Date.now()+5000,{passive:true});list.addEventListener('touchmove',()=>manualUntil=Date.now()+5000,{passive:true});
  const lineViewport=el.querySelector('.vi-line'),lineText=el.querySelector('[data-vi-line]');
  function marquee(){const distance=lineText.scrollWidth-lineViewport.clientWidth;const moving=!expanded&&lineViewport.clientWidth>0&&distance>1;lineText.classList.toggle('vi-scrolling',moving);if(moving){lineText.style.setProperty('--vi-travel',-distance+'px');lineText.style.setProperty('--vi-duration',Math.max(6,distance/24+4)+'s');}}
  function follow(force=false){if(!expanded||(!force&&Date.now()<manualUntil))return;const row=list.querySelector('[data-state]');if(!row)return;const id=built+'|'+row.dataset.viI;if(!force&&following===id)return;following=id;const r=row.getBoundingClientRect(),box=list.getBoundingClientRect();if(r.top<box.top||r.bottom>box.bottom)list.scrollTop+=r.top-box.top;}
  try { const saved = Number(win.localStorage.getItem(HEIGHT_KEY)); if (Number.isFinite(saved) && saved > 0) preferredHeight = saved; } catch { /* this visit */ }
  function heightBounds() {
    // Reserve the grip inside the former maximum card height. Even the smallest list keeps one dialogue row.
    const max = Math.max(1, Math.min(win.innerHeight * .46, 320) - 24);
    const min = Math.min(max, list.querySelector('.vi-row')?.offsetHeight || 64);
    return {min, max};
  }
  function sizeList() {
    if (!expanded) return;
    const {min, max} = heightBounds(), height = Math.min(max, Math.max(min, preferredHeight ?? max));
    list.style.maxHeight = height + 'px';
    grip.setAttribute('aria-valuemin', Math.round(min));
    grip.setAttribute('aria-valuemax', Math.round(max));
    grip.setAttribute('aria-valuenow', Math.round(height));
  }
  function rememberHeight() {
    try {
      if (preferredHeight === null) win.localStorage.removeItem(HEIGHT_KEY);
      else win.localStorage.setItem(HEIGHT_KEY, String(preferredHeight));
    } catch { /* this visit */ }
  }
  const free = () => !place || !Number.isFinite(place.cx) || !Number.isFinite(place.y);
  function where() {
    el.style.transform = 'translateX(-50%)';
    const w = el.offsetWidth || 220, h = el.offsetHeight || 40, vw = win.innerWidth, vh = win.innerHeight;
    width = w;
    if (free()) { el.style.left = '50%'; el.style.top = stackTop(el); return; }
    el.style.left = Math.min(vw - w / 2 - 6, Math.max(w / 2 + 6, place.cx * vw)) + 'px';
    el.style.top = Math.min(vh - Math.min(h, 120) - 6, Math.max(6, place.y * vh)) + 'px';
  }
  const leave = joinStack({el, order: 2, free, place: where});
  const key = r => r ? JSON.stringify([r.id,r.lines.map(l=>[l.role,l.text,l.translation])]) : '';
  const text = (sel, value) => { const p = el.querySelector(sel); if (p.textContent !== value) {p.textContent = value;if(p===lineText){p.classList.remove('vi-scrolling');void p.offsetWidth;}} };

  function draw(r, s) {
    const mine = s && s.id === r.id && BUSY.includes(s.phase) ? s.index : -1, paused = s && s.id === r.id && s.phase === 'paused' ? s.index : -1;
    el.dataset.playing = mine >= 0 ? '1' : '';
    if (built !== key(r)) {
      built = key(r);
      text('[data-vi-title]', r.name || '朗读播放器');
      el.querySelector('[data-vi-list]').innerHTML = r.lines.map((l,i)=>{const text=l.translationPaired?{primary:voiceDisplay(l.text),secondary:''}:islandDialogueText(l);return `<button type="button" class="vi-row" data-vi-i="${i}"><b>${esc(lineLabel(l))}</b><span>${esc(text.primary)}</span>${text.secondary?`<small>${esc(text.secondary)}</small>`:''}</button>`;}).join('');
      sizeList();
    }
    for (const row of el.querySelectorAll('.vi-row')) {
      const i = Number(row.dataset.viI), state = i === mine ? 'playing' : i === paused ? 'paused' : '';
      if ((row.dataset.state || '') !== state) { if (state) row.dataset.state = state; else delete row.dataset.state; }
    }
    follow();
    // 整篇朗读: while the 旁白 reads, no line is the one playing, but the reply is.
    const mineAll = s && s.id === r.id && BUSY.includes(s.phase), pausedAll = s && s.id === r.id && s.phase === 'paused';
    const said = s?.id===r.id&&[...BUSY,'paused'].includes(s.phase)?s.line||r.lines[s.index]:null;
    text('[data-vi-speaker]',said?lineLabel(said):'整条朗读');
    text('[data-vi-current]',said?voiceDisplay(said.text):voiceDisplay(r.lines[0]?.text)||'点播放开始朗读');
    const t=s?.id===r.id?s.transport:null,slider=el.querySelector('[data-vi-progress]');
    slider.disabled=!t?.duration||t.system||!['playing','paused'].includes(s?.phase);slider.max=String(t?.totalSeconds||t?.duration||1);if(doc.activeElement!==slider)slider.value=String(Math.min(t?.totalSeconds?t.elapsed:t?.position||0,Number(slider.max)));slider.setAttribute('aria-label',t?.totalSeconds?'整条播放进度':'当前段落播放进度');
    text('[data-vi-time]',t?.system?'系统朗读 · 可点选段落':`${clock(t?.totalSeconds?t.elapsed:t?.position)} / ${t?.totalSeconds?clock(t.totalSeconds):t?.duration?clock(t.duration):'--:--'} · ${t?.totalSeconds?'整条':'本段'}`);
    text('[data-vi-buffer]',t?.buffering?`开播缓冲 · 已备 ${Math.floor(t.bufferSeconds)} 秒`:t?(t.ready>=t.total?'音频已就绪':s.phase==='generating'?'正在准备音频':'边听边缓存'):'');el.querySelector('[data-vi=now]').hidden=!t?.buffering;
    for(const button of el.querySelectorAll('.vi-skip')){button.disabled=!t?.duration||t.system||!['playing','paused'].includes(s?.phase);button.title=t?.system?'系统朗读不支持精确跳秒':'在已准备的音频范围内跳转';}
    text('[data-vi-line]', said ? `${lineLabel(said)}：${voiceDisplay(said.text)}` : mineAll && s.narration ? `旁白：${s.narration}` : '准备好，随时开始');
    marquee();
    if(s?.id===r.id&&[...BUSY,'paused'].includes(s.phase))selectedStep=!!s.stepwise;
    el.querySelector('[data-vi=mode-all]').setAttribute('aria-pressed',String(!selectedStep));
    el.querySelector('[data-vi=mode-step]').setAttribute('aria-pressed',String(selectedStep));
    const all = el.querySelector('[data-vi=all]'), on = mineAll ? 'pause' : pausedAll ? 'resume' : 'all';
    if (all.dataset.on !== on) { all.dataset.on = on; all.innerHTML = on === 'pause' ? `${PAUSE}<span>暂停</span>` : on === 'resume' ? `${PLAY}<span>继续</span>` : `${PLAY}<span>整条</span>`; }
    el.setAttribute('aria-label', `朗读播放器：${r.name || ''}`);
  }
  function setExpanded(on) {
    if (expanded === on) return;
    expanded = on; openedAt = on ? Date.now() : 0;
    el.dataset.expanded = on ? '1' : '';
    const listToggle=el.querySelector('[data-vi=close]');listToggle.setAttribute('aria-expanded',String(on));listToggle.setAttribute('aria-label',on?'收起朗读列表':'展开朗读列表');
    if (!on && sizing) { preferredHeight = sizing.before; sizing = null; }
    if (on) sizeList();
    if (on) follow(true);else following='';
    (win.requestAnimationFrame || (fn => win.setTimeout(fn, 16))).call(win, () => {where();marquee();});
  }
  function refresh() {
    let r = null, s = null;
    try { r = enabled() ? latest() : null; s = r ? now() : null; } catch { r = null; }
    reply = r?.lines?.length ? r : null;
    if (reply && dismissed && dismissed !== key(reply)) dismissed = '';
    const show = reply && !phoneOpen() && !callShown() && dismissed !== key(reply);
    if (!show) { el.hidden = true; setExpanded(false); return; }
    draw(reply, s);
    if (el.hidden) { el.hidden = false; where(); }
    else if (el.offsetWidth !== width) where();
    marquee();
  }

  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('button, input, .vi-list, [data-vi-resize]')) return;
    const r = el.getBoundingClientRect();
    drag = {id: e.pointerId, dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, live: false};
    try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
  });
  el.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.live && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    drag.live = true; el.dataset.dragging = '';
    place = {cx: (e.clientX - drag.dx) / win.innerWidth, y: (e.clientY - drag.dy) / win.innerHeight};
    where();
  });
  el.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.live; drag = null; delete el.dataset.dragging;
    if (moved) { dragged = true; try { win.localStorage.setItem(KEY, JSON.stringify(place)); } catch { /* this visit */ } }
  });
  el.addEventListener('pointercancel', () => { drag = null; delete el.dataset.dragging; });
  grip.addEventListener('pointerdown', e => {
    if (e.button > 0 || !expanded || sizing) return;
    e.preventDefault(); e.stopPropagation();
    sizing = {id: e.pointerId, y: e.clientY, height: list.clientHeight || Number(grip.getAttribute('aria-valuenow')), before: preferredHeight};
    try { grip.setPointerCapture(e.pointerId); } catch { /* gone */ }
  });
  grip.addEventListener('pointermove', e => {
    if (!sizing || e.pointerId !== sizing.id) return;
    e.preventDefault();
    const {min, max} = heightBounds();
    preferredHeight = Math.min(max, Math.max(min, sizing.height + e.clientY - sizing.y));
    sizeList();
  });
  function finishSizing(e, cancel = false) {
    if (!sizing || e.pointerId !== sizing.id) return;
    if (cancel) preferredHeight = sizing.before;
    sizing = null; sizeList();
    if (!cancel) rememberHeight();
    try { grip.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }
  grip.addEventListener('pointerup', e => finishSizing(e));
  grip.addEventListener('pointercancel', e => finishSizing(e, true));
  grip.addEventListener('lostpointercapture', e => finishSizing(e, true));
  grip.addEventListener('keydown', e => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const {min, max} = heightBounds(), height = list.clientHeight || Number(grip.getAttribute('aria-valuenow'));
    preferredHeight = e.key === 'Home' ? min : e.key === 'End' ? max : Math.min(max, Math.max(min, height + (e.key === 'ArrowUp' ? -16 : 16)));
    sizeList(); rememberHeight();
  });
  // Opening and closing happen on click, not on pointerup: a phone hit-tests the tap's click after the card has opened
  // under the finger, and that click used to land on 整条 or a line and play it. A tap in the first moment after
  // opening is that same tap, so it does nothing.
  el.addEventListener('click', e => {
    if (e.target.closest('[data-vi-resize], input')) return;
    if (dragged) { dragged = false; return; }
    const b = e.target.closest('[data-vi], [data-vi-i]');
    if (!b) return;
    if (!reply) return;
    // Mode and list controls never start audio; do not swallow a quick tap after opening.
    if (Date.now()-openedAt<350 && !['mode-all','mode-step','close'].includes(b.dataset.vi)) return;
    const id = reply.id;
    if(b.dataset.vi==='now'){startNow?.();return;}
    if (b.dataset.vi==='back'||b.dataset.vi==='forward') {seek?.(b.dataset.vi==='back'?-15:15);return;}
    if (b.dataset.viI !== undefined) Promise.resolve().then(() => play(id, Number(b.dataset.viI), {stepwise:selectedStep})).catch(() => {});
    else if (b.dataset.vi === 'mode-all' || b.dataset.vi === 'mode-step') { selectedStep=b.dataset.vi==='mode-step';setMode?.(id,selectedStep);refresh(); }
    else if (b.dataset.vi === 'all') { const s = now(); Promise.resolve().then(() => s && s.id === id && [...BUSY, 'paused'].includes(s.phase) ? toggle?.() : selectedStep ? playStep?.(id) : playAll(id)).catch(() => {}); }
    else if (b.dataset.vi === 'close') { setExpanded(!expanded); }
  });
  el.querySelector('[data-vi-progress]').addEventListener('change',e=>seekTo?.(Number(e.target.value)));
  const timer=win.setInterval(()=>{if(!el.hidden)refresh();},350);
  // A tap anywhere else takes the list back in.
  const away = e => { if (expanded && !el.contains(e.target)) setExpanded(false); };
  doc.addEventListener('pointerdown', away, true);
  const onResize = () => { if (sizing) { preferredHeight = sizing.before; sizing = null; } sizeList(); if (!el.hidden) {where();marquee();follow(true);} };
  win.addEventListener('resize', onResize);
  return {refresh, open() { dismissed = ''; refresh(); if (!el.hidden) setExpanded(false); }, get shown() { return !el.hidden; }, get expanded() { return expanded; },
    dispose() { win.clearInterval(timer);leave(); doc.removeEventListener('pointerdown', away, true); win.removeEventListener('resize', onResize); el.remove(); }};
}
