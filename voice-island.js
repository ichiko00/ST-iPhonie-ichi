import {voiceDisplay} from './core/voice-display.js';
import {splitBilingual} from './core/bilingual.js';
// The story player docks independently of the phone launcher.

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
  el.innerHTML = `<button type="button" class="vi-edge" data-vi="open" aria-label="展开正文朗读播放器" aria-expanded="false">${WAVE}</button>
    <div class="vi-card"><div class="vi-head"><span class="vi-ico">${WAVE}</span><b data-vi-title></b><div class="vi-mode" role="group" aria-label="朗读模式"><button type="button" data-vi="mode-all" aria-pressed="true">全文</button><button type="button" data-vi="mode-step" aria-pressed="false">逐句</button></div><button type="button" class="vi-btn vi-fold" data-vi="fold" aria-label="收回屏幕边缘">−</button></div>
      <div class="vi-current"><b data-vi-speaker></b><div data-vi-current></div></div>
      <div class="vi-progress"><input data-vi-progress type="range" min="0" max="1" step="0.1" value="0" aria-label="当前段落播放进度"><div class="vi-times"><span data-vi-time></span><span data-vi-buffer></span></div></div>
      <button type="button" class="vi-btn vi-start-now" data-vi="now" hidden>现在播放</button><div class="vi-controls"><button class="vi-btn vi-skip" type="button" data-vi="back" aria-label="后退15秒">${SKIP(false)}</button><button type="button" class="vi-btn vi-all" data-vi="all"></button><button class="vi-btn vi-skip" type="button" data-vi="forward" aria-label="快进15秒">${SKIP(true)}</button><button type="button" class="vi-btn vi-list-toggle" data-vi="close" aria-label="展开朗读列表" aria-expanded="false">${LIST}</button></div>
      <div class="vi-list" data-vi-list></div><div class="vi-resize" data-vi-resize role="separator" tabindex="0" aria-label="调整台词小窗高度" aria-orientation="horizontal"></div></div>`;
  doc.body.append(el);
  let place = {side:'left', y:.42}, reply = null, built = '', expanded = false, openedAt = 0;
  let panelOpen = false, drag = null, suppressClickUntil = 0;
  try {
    const saved = JSON.parse(win.localStorage.getItem(KEY) || 'null');
    if (saved && Number.isFinite(saved.y)) place = {...saved, side: saved.side || (saved.cx > .5 ? 'right' : 'left')};
  } catch { /* use the default edge */ }
  const edge = el.querySelector('.vi-edge');
  const list = el.querySelector('.vi-list'), grip = el.querySelector('[data-vi-resize]');
  let selectedStep = false;
  let preferredHeight = null, sizing = null, following = '', manualUntil = 0;
  list.addEventListener('wheel',()=>manualUntil=Date.now()+5000,{passive:true});list.addEventListener('touchmove',()=>manualUntil=Date.now()+5000,{passive:true});
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
  function where() {
    if (el.hidden) return;
    const vw = win.innerWidth, vh = win.innerHeight, right = place.side === 'right';
    const w = el.offsetWidth, h = el.offsetHeight;
    let top = Math.max(6, Math.min(vh - h - 6, Math.round(place.y * vh)));
    const phone = doc.querySelector('#myphone-floating')?.getBoundingClientRect();
    if (!panelOpen && phone?.width && phone.height &&
        (right ? phone.right > vw - w - 8 : phone.left < w + 8) &&
        top + h + 8 > phone.top && top < phone.bottom + 8) {
      const below = phone.bottom + 8;
      top = below + h <= vh - 6 ? below : Math.max(6, phone.top - h - 8);
    }
    el.dataset.side = place.side;
    el.style.left = (right ? vw - w - (panelOpen ? 8 : 0) : panelOpen ? 8 : 0) + 'px';
    el.style.top = top + 'px';
  }
  function setPanel(on) {
    panelOpen = on;
    openedAt = on ? Date.now() : 0;
    el.toggleAttribute('data-panel', on);
    edge.setAttribute('aria-expanded', String(on));
    where();
    if (on) follow(true);
  }
  const key = r => r ? JSON.stringify([r.id,r.lines.map(l=>[l.role,l.text,l.translation])]) : '';
  const text = (sel, value) => { const p = el.querySelector(sel); if (p.textContent !== value) p.textContent = value; };

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
    edge.title = mineAll ? '正文朗读中 · 点击展开' : pausedAll ? '正文朗读已暂停 · 点击展开' : '展开正文朗读播放器';
    edge.setAttribute('aria-label', edge.title);
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
    (win.requestAnimationFrame || (fn => win.setTimeout(fn, 16))).call(win, where);
  }
  function refresh() {
    let r = null, s = null;
    try { r = enabled() ? latest() : null; s = r ? now() : null; } catch { r = null; }
    reply = r?.lines?.length ? r : null;
    const show = reply && !phoneOpen() && !callShown();
    if (!show) { el.hidden = true; setPanel(false); setExpanded(false); return; }
    draw(reply, s);
    el.hidden = false;
    if (!drag) where();
  }
  edge.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drag) return;
    drag = {id:e.pointerId, x:e.clientX, y:e.clientY, offset:e.clientY-el.offsetTop, before:place, moved:false};
    edge.setPointerCapture(e.pointerId);
  });
  edge.addEventListener('pointermove', e => {
    if (drag?.id !== e.pointerId || (!drag.moved && Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<6)) return;
    drag.moved = true;
    el.dataset.dragging = '';
    place = {side:e.clientX > win.innerWidth/2?'right':'left', y:(e.clientY-drag.offset)/win.innerHeight};
    where();
  });
  function finishDrag(e, cancel = false) {
    if (drag?.id !== e.pointerId) return;
    if (cancel) place = drag.before;
    else if (drag.moved) {
      suppressClickUntil = Date.now() + 250;
      place.y = Math.max(0, Math.min(1, place.y));
      try { win.localStorage.setItem(KEY, JSON.stringify(place)); } catch { /* this visit */ }
    }
    drag = null;
    delete el.dataset.dragging;
    where();
  }
  edge.addEventListener('pointerup', finishDrag);
  edge.addEventListener('pointercancel', e => finishDrag(e,true));
  edge.addEventListener('lostpointercapture', e => finishDrag(e,true));
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
    const b = e.target.closest('[data-vi], [data-vi-i]');
    if (!b) return;
    if (!reply) return;
    if (b.dataset.vi === 'open') {
      if (e.detail === 0 || Date.now() >= suppressClickUntil) { setPanel(true); el.querySelector('[data-vi=fold]').focus({preventScroll:true}); }
      return;
    }
    if (b.dataset.vi === 'fold') { setPanel(false); edge.focus({preventScroll:true}); return; }
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
  const away = e => { if (panelOpen && !el.contains(e.target)) setPanel(false); };
  const escape = e => { if (e.key === 'Escape' && panelOpen && el.contains(doc.activeElement)) { e.stopPropagation(); setPanel(false); edge.focus({preventScroll:true}); } };
  doc.addEventListener('keydown', escape, true);
  doc.addEventListener('pointerdown', away, true);
  const onResize = () => { if (sizing) { preferredHeight = sizing.before; sizing = null; } sizeList(); if (!el.hidden) {where();follow(true);} };
  win.addEventListener('resize', onResize);
  return {refresh, open() { refresh(); if (!el.hidden) setPanel(true); }, get shown() { return !el.hidden; }, get expanded() { return expanded; },
    dispose() { win.clearInterval(timer);doc.removeEventListener('keydown', escape, true); doc.removeEventListener('pointerdown', away, true); win.removeEventListener('resize', onResize); el.remove(); }};
}
