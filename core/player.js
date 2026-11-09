import {MediaElementAudio,prefersMediaAudio} from './media-audio.js';
import { buildRequest } from './providers.js';
import { TTSParameters } from './parameters.js';
import { findRoute } from './routes.js';
import { requestHash } from './cache.js';
import { effectChain, lineEffect } from './voice-fx.js';
import { audioKind, unpacked, mp3FromFrame, undecodable } from './audio-bytes.js';
import { mouthShape } from './model-files.js';
import { joinAudio } from './audio-join.js';

// A refusal because the line is too long (自己的接口 shaped like OpenAI's, ElevenLabs), not a reference audio. A 413 is
// not one: that is a request too big, most often for the reference audio it carries, and cutting the line would not help.
const LONG_CODES = new Set(['input_too_long', 'text_too_long', 'max_character_limit_exceeded']);
const tooLong = error => !!error && (LONG_CODES.has(error.code)
  || /too long|太长|过长/i.test(String(error.message || '')) && !/参考|reference|prompt/i.test(String(error.message || '')));
/** A line cut in two near its middle: at a sentence end, else at a comma, else at a space; null when it cannot be. */
export function halves(text) {
  const t = String(text ?? '').trim();
  if (t.length < 8) return null;
  for (const marks of [/[。！？!?…；;.]+["”’」』）)]*/g, /[，,、：:]+/g, /\s+/g]) {
    let best = -1;
    for (const m of t.matchAll(marks)) { const at = m.index + m[0].length; if (at < t.length && (best < 0 || Math.abs(at - t.length / 2) < Math.abs(best - t.length / 2))) best = at; }
    const parts = best > 0 ? [t.slice(0, best).trim(), t.slice(best).trim()] : null;
    if (parts?.every(p => /[\p{L}\p{N}]/u.test(p))) return parts;
  }
  return null;
}
export { audioKind, mp3FromFrame } from './audio-bytes.js';

const stopped = () => new DOMException('已停止', 'AbortError');

const copyLine = line => line ? { role: '', text: '', translation: '', emotion: '', ...structuredClone(line) } : null;
function volumeValue(value) {
 const volume = Number(value);
 if (!Number.isFinite(volume)) throw new TypeError('音量必须是有效数字');
 return Math.min(1, Math.max(0, volume));
}

export class BrowserAudio {
 constructor() {
  this.context = null;
  this.analyser = null;
  this.gain = null;
  this.source = null;
  this.finish = null;
  this.volume = 1;
  this.playEpoch = 0;
  this.pausedByUser = false;
  this.decoded = new Map();
  this.decodeBytes = 0;
 }
 unlock() {
  this.pausedByUser=false;
  this.context ??= new AudioContext();
  if (!this.analyser) {
   this.gain = this.context.createGain();
   this.gain.gain.value = this.volume;
   this.analyser = this.context.createAnalyser();
   this.analyser.fftSize = 128;
   this.analyser.smoothingTimeConstant = .72;
   // A finer one for the 视觉小说 models' lips (the vowels need more than the wave's five bars).
   this.lips = this.context.createAnalyser();
   this.lips.fftSize = 1024;
   this.lips.smoothingTimeConstant = .45;
   this.gain.connect(this.lips);
   this.lips.connect(this.analyser);
   this.analyser.connect(this.context.destination);
  }
  return this.context.resume();
 }
 /** Decode ahead without resuming the audio device or playing any sound. Bounded PCM cache. */
 async warm(blob) {
  this.context ??= new AudioContext();
  const ctx = this.context;
  let entry = this.decoded.get(blob);
  if (entry) return entry.job;
  entry = {bytes: 0, job: null};
  // decodeAudioData takes the bytes away, so each try gets its own copy; a refused MP3 is tried again from its first whole frame.
  entry.job = blob.arrayBuffer().then(async raw => {
   let bytes = new Uint8Array(raw);
   bytes = await unpacked(bytes) || bytes;
   try { return await ctx.decodeAudioData(bytes.slice().buffer); }
   catch (error) {
    const cut = audioKind(bytes) === 'mp3' ? mp3FromFrame(bytes) : null;
    if (cut) try { return await ctx.decodeAudioData(cut.slice().buffer); } catch { /* said below */ }
    throw Object.assign(Error(undecodable(bytes)), {code: 'UNDECODABLE', cause: error});
   }
  }).then(buffer => {
   if (ctx !== this.context || this.decoded.get(blob) !== entry) return buffer;
   entry.bytes = (buffer.length || 0) * (buffer.numberOfChannels || 1) * 4;
   this.decodeBytes += entry.bytes;
   while (this.decodeBytes > 32 * 1024 * 1024 || this.decoded.size > 24) {
    const [old, row] = this.decoded.entries().next().value;
    this.decoded.delete(old); this.decodeBytes -= row.bytes;
   }
   return buffer;
  }).catch(error => { if (this.decoded.get(blob) === entry) this.decoded.delete(blob); throw error; });
  this.decoded.set(blob, entry);
  return entry.job;
 }
 setVolume(value) {
  this.volume = volumeValue(value);
  if (this.gain) {
   const parameter = this.gain.gain;
   if (parameter.setTargetAtTime) parameter.setTargetAtTime(this.volume, this.context.currentTime, .015);
   else parameter.value = this.volume;
  }
  return this.volume;
 }
 getVolume() { return this.volume; }
 async duration(blob) { return (await this.warm(blob)).duration; }
 position() { const c=this.clock;return c?Math.min(c.duration,c.offset+Math.max(0,this.context.currentTime-c.at)*c.rate):0; }
 setRate(rate) { if(this.clock){this.clock.offset=this.position();this.clock.at=this.context.currentTime;this.clock.rate=rate;}if(this.source)this.source.playbackRate.value=rate; }

 /** effect: 'phone' | 'inner' | '' (core/voice-fx.js), put between the line and the volume. */
 async play(blob, signal = new AbortController().signal, { effect = '', offset = 0, rate = 1 } = {}) {
  signal.throwIfAborted();
  const ctx = this.context;
  if (!ctx || ctx.state !== 'running') throw Error('请再点一次播放，允许浏览器开启声音');
  this.stop();
  const epoch = this.playEpoch;
  const check = () => {
   signal.throwIfAborted();
   if (epoch !== this.playEpoch || ctx !== this.context) throw stopped();
  };
  let buffer;
  try {
   buffer = await this.warm(blob);
  } catch (error) {
   check();
   throw error?.code === 'UNDECODABLE' ? error : Error('浏览器无法播放此音频格式，请在引擎配置改选 MP3 或 WAV');
  }
  check();
  if(ctx.state!=='running'&&!this.pausedByUser){let timer;try{await Promise.race([ctx.resume(),new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);}catch{}finally{clearTimeout(timer);}check();if(ctx.state!=='running')throw Error('音频设备已暂停或被系统打断，请回到页面再点一次播放');}
  return new Promise((resolve, reject) => {
   const source = ctx.createBufferSource(), fx = effectChain(ctx, effect, this.gain);
   let settled = false;
   const finish = error => {
    if (settled) return;
    settled = true;
    signal.removeEventListener('abort', abort);
    source.onended = null;
    try { source.disconnect(); } catch {}
    // An echo rings on a little after the line; stopped, it stops with it.
    if (fx) { if (error) fx.dispose(); else setTimeout(() => fx.dispose(), fx.tail * 1000 + 200); }
    if (this.source === source) this.source = null;
    if (this.finish === finish) this.finish = null;
    if (error) reject(error); else resolve();
   };
   const abort = () => {
    source.onended = null;
    try { source.stop(); } catch {}
    finish(stopped());
   };
   try {
    source.buffer = buffer;
    source.connect(fx ? fx.input : this.gain);
    this.source = source;
    this.finish = finish;
    source.onended = () => finish();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else { source.playbackRate.value=rate; this.clock={at:ctx.currentTime,offset,rate,duration:buffer.duration}; source.start(0,Math.min(offset,Math.max(0,buffer.duration-.01))); }
   } catch (error) { finish(error); }
  });
 }
 /** How loud the voice is now, 0–1: the last 21 ms of sound in decibels against the loudest of late, so the line's
  *  loudest syllables fill the wave and one 26 dB quieter leaves it empty, whether the voice or the volume is loud or
  *  quiet. It rises in a hundredth of a second or two and falls in a few, like a meter. 0 before anything played. */
 loudness(now = performance.now()) {
  if (!this.analyser || !this.lips) return 0;
  const m = this.meter ??= { at: now, level: 0, peak: -30, wave: new Float32Array(this.lips.fftSize), trail: [] };
  // Several waves read it in one frame (the floating ball, the story's wave, the phone): the first reading counts.
  if (m.trail.length && now - m.at < 8) return m.level;
  this.lips.getFloatTimeDomainData(m.wave);
  let sum = 0;
  for (const v of m.wave) sum += v * v;
  const db = 10 * Math.log10(sum / m.wave.length + 1e-10), dt = Math.min(.1, Math.max(0, now - m.at) / 1000);
  // The loudest of late sinks 4 dB a second once the voice drops, never below −42 dB, so a pause stays a pause.
  m.peak = Math.max(db, -42, m.peak - 4 * dt);
  const target = db < -66 ? 0 : Math.min(1, Math.max(0, (db - m.peak + 26) / 26));
  m.level += (target - m.level) * (1 - Math.exp(-dt / (target > m.level ? .018 : .07)));
  m.at = now;
  m.trail.push([now, m.level]);
  while (m.trail.length > 2 && now - m.trail[1][0] > 100) m.trail.shift();
  return m.level;
 }
 /** The wave's five bars, 0–1, from how loud the voice is: the middle bar is the voice now, the bars beside it what it
  *  was 35 and 70 ms before, so each syllable runs out from the middle. [] before anything played. */
 levels(now = performance.now()) {
  if (!this.analyser || !this.lips) return [];
  this.loudness(now);
  const trail = this.meter.trail;
  const then = ago => { for (let i = trail.length - 1; i > 0; i--) if (now - trail[i][0] >= ago) return trail[i][1]; return trail[0][1]; };
  return [.74, .9, 1, .9, .74].map((gain, i) => gain * then(Math.abs(i - 2) * 35));
 }
 /** The mouth for the sound playing now (core/model-files.js mouthShape), null before anything played. */
 mouth() {
  if (!this.lips) return null;
  const data = new Uint8Array(this.lips.frequencyBinCount);
  this.lips.getByteFrequencyData(data);
  const shape = mouthShape(data, this.context.sampleRate / this.lips.fftSize, this.lipPeak ?? .6);
  // The loudest of late, falling back slowly: the next lines open as wide whether the voice is quiet or loud.
  this.lipPeak = Math.max(.3, shape.loud, (this.lipPeak ?? .6) * .997);
  return shape;
 }
 pause() { this.pausedByUser=true;return this.context?.suspend(); }
 resume() { this.pausedByUser=false;return this.context?.resume(); }
 stop() {
  this.playEpoch++;
  if (this.source) {
   this.source.onended = null;
   try { this.source.stop(); } catch {}
  }
  this.finish?.(stopped());
 }
 close() {
  this.stop();
  const context = this.context;
  this.gain?.disconnect();
  this.analyser?.disconnect();
  this.context = this.analyser = this.gain = this.lips = this.meter = null;
  this.decoded.clear(); this.decodeBytes = 0;
  return context?.close();
 }
}

const systemNarration=(line,s)=>!!line?.narration&&(s.narration?.voice!=='role'||line.translationRead&&!findRoute(s.routes,line.role)?.voice?.trim());

export class DialoguePlayer {
 /** speech: the browser's voice for a 旁白 read with 系统朗读 (core/narration.js browserSpeech), or null. */
 constructor({ settings, providers, cache, sink = (prefersMediaAudio()?new MediaElementAudio():new BrowserAudio()), change = () => {}, unknown = () => {}, prepared = () => {}, speech = null, voiced = () => {} }) {
  this.voiced = voiced;
  Object.assign(this, { settings, providers, cache, sink, change, unknown, prepared, speech });
  this.epoch = 0;
  this.rate = 1;
  this.sessionAudio = new Map();
  this.durations = new Map();
  this.phase = 'idle';
  this.message = '';
  this.queue = [];
  this.index = 0;
  this.pending = null;
  this.skipped = [];
  this.controller = null;
  this.valid = () => true;
  this.played = new Set();
  try{const saved=JSON.parse(globalThis.localStorage?.getItem('myphone-heard-audio-v1')||'[]');if(Array.isArray(saved))this.played=new Set(saved.slice(-5000).filter(x=>typeof x==='string'));}catch{}
  // Lines being made now, by request key: playing a line that 提前生成 is still making waits for it, not pays twice.
  this.making = new Map();
  this.readyAudio = new Map();
  this.readyBytes = 0;
  this.volume = volumeValue(sink.getVolume?.() ?? 1);
  sink.controls?.({play:()=>{if(this.phase==='paused')this.toggle();else if(this.queue.length)Promise.resolve(sink.resume()).catch(error=>this.emit('error',error.message));},pause:()=>{if(['playing','generating'].includes(this.phase))this.toggle();},stop:()=>this.stop()});
  this.clearMetadata();
 }
 clearMetadata() {
  this.engine = '';
  this.speaker = '';
  this.line = null;
  this.source = 'dialogue';
  this.requestKey = null;
 }
 snapshot() {
  return { phase: this.phase, message: this.message, stepwise: !!this.stepwise, boundary: !!this.boundary, index: this.index, total: this.queue.length,
   engine: this.engine, speaker: this.speaker, line: copyLine(this.line), source: this.source,
   requestKey: this.requestKey, volume: this.getVolume() };
 }
 setVolume(value) {
  this.volume = volumeValue(value);
  this.sink.setVolume?.(this.volume);
  this.change(this.snapshot());
  return this.volume;
 }
 getVolume() { return this.volume; }
 /** The cache key a line's audio has with its speaker's current voice settings, or null without a speaker. */
 async lineKey(line) {
  const s = this.settings(), route = findRoute(s.routes, line.role);
  if (!route) return null;
  return requestHash(buildRequest(route.engine, s.connections[route.engine], { ...route, language: route.language || s.general.defaultLanguage }, line, this.providers.references));
 }
 async lineState(line) {
  try {
   const s = this.settings(), key = await this.lineKey(line);
   if (!key) return 'ungenerated';
   if (this.played.has(key)) return 'played';
   return s.general.cacheEnabled && await this.cache.has(key) ? 'ready' : 'ungenerated';
  } catch { return 'ungenerated'; }
 }
 emit(phase, message) {
  this.phase = phase;
  this.message = message;
  this.sink.state?.(phase,this.queue[this.index]||this.line);
  this.change(this.snapshot());
 }
 stop(message = '已停止') {
  this.epoch++;
  this.ahead = null;
  this.buffered = new Map();
  this.bufferState = {entries: this.buffered, active: 0};
  this.controller?.abort();
  this.controller = null;
  this.sink.stop();
  this.speech?.stop();
  this.queue = [];
  this.index = 0;
  this.pending = null;
  this.settingsOverride = null;
  this.resumePhase = null;
  this.stepwise = false; this.boundary = false;
  this.skipped = [];
  this.wake?.();
  this.wake = null;
  this.clearMetadata();
  this.emit('idle', message);
 }
 /** ahead: while a line plays, the next one is already being made (a call: no pause between its sentences). */
 start(lines, valid = () => true, settingsOverride = null, {ahead = false, stepwise = false, prebuffer = false, startIndex = 0, offset = 0, session = null} = {}) {
  this.stop();
  this.settingsOverride = settingsOverride;
  this.lookahead = ahead;
  this.prebuffer = prebuffer;
  this.startupBuffer = prebuffer && !session;
  this.buffering = false;this.playNow = false;
  this.stepwise = stepwise;
  if (!lines.length) return;
  this.valid = valid;
  this.queue = lines.map(copyLine);
  this.history = this.queue;
  this.sessionAudio = session?.audio || new Map();
  this.durations = session?.durations || new Map();
  this.index = startIndex; this.seekOffset = offset;
  this.controller = new AbortController();
  this.line = this.queue[this.index];
  this.speaker = this.line.role || '';
  this.emit('generating', '准备播放');
  return this.unlockAndRun();
 }
 lineId(line) { return JSON.stringify(line); }
 transport() {
  const lines=this.history||[], durations=lines.map(l=>this.durations.get(this.lineId(l))||0);
  const index=this.queue.length?this.index:Math.max(0,lines.length-1);
  const system=systemNarration(lines[index],this.settingsOverride||this.settings());
  const position=this.phase==='generating'?this.seekOffset||0:system?0:this.sink.position?.()||0;
  const totalSeconds=durations.length&&durations.every(n=>n>0)?durations.reduce((a,b)=>a+b,0):0;
  return {index,position,duration:durations[index]||0,durations,totalSeconds,elapsed:totalSeconds?durations.slice(0,index).reduce((a,b)=>a+b,0)+position:position,rate:this.rate,system,phase:this.phase,
   buffering:!!this.buffering,bufferSeconds:this.bufferSeconds||0,ready:lines.filter(l=>this.sessionAudio.has(this.lineId(l))).length,total:lines.length};
 }
 setRate(rate) { this.rate=Math.max(.75,Math.min(2,Number(rate)||1));this.sink.setRate?.(this.rate);this.change(this.snapshot()); }
 jump(index,offset=0) {
  if(!this.history?.[index] || !this.valid()) return;
  const lines=this.history,valid=this.valid,settings=this.settingsOverride,session={audio:this.sessionAudio,durations:this.durations};
  const paused=this.phase==='paused';
  const job=this.start(lines,valid,settings,{ahead:true,prebuffer:this.prebuffer,stepwise:this.stepwise,startIndex:index,offset,session});
  if(paused)this.toggle();return job;
 }
 seekTo(seconds) {
  const t=this.transport();let index=t.index,offset=Math.max(0,Number(seconds)||0);
  if(t.totalSeconds){index=0;while(index<t.durations.length-1&&offset>=t.durations[index])offset-=t.durations[index++];}
  return this.jump(index,Math.min(offset,Math.max(0,t.durations[index]-.05)));
 }
 seekBy(seconds) {
  const t=this.transport();if(t.system||!t.duration)return false;
  let index=t.index,offset=t.position+seconds;
  while(offset<0&&index>0&&t.durations[index-1]){index--;offset+=t.durations[index];}
  while(offset>=t.durations[index]&&t.durations[index]>0&&index<t.durations.length-1&&t.durations[index+1]){offset-=t.durations[index];index++;}
  this.jump(index,Math.max(0,Math.min(offset,Math.max(0,t.durations[index]-.05))));return true;
 }
 async bufferedMake(line,route,s,signal,found=()=>{},still=()=>!signal.aborted) {
  const id=this.lineId(line),saved=this.sessionAudio.get(id);
  if(saved){found(true,saved.key);return saved;}
  const audio=this.sessionAudio,durations=this.durations;
  const made=await this.make(line,route,s,signal,found,still);
  if(made&&still()){
   audio.set(id,made);
   try{const duration=await this.sink.duration?.(made.blob);if(Number.isFinite(duration)&&duration>0)durations.set(id,duration);}catch{}
  }
  return still()?made:null;
 }
 current(epoch) { return epoch === this.epoch && !this.controller?.signal.aborted; }
 canContinue(epoch) {
  if (!this.current(epoch)) return false;
  if (this.valid()) return true;
  this.stop('消息已变化，请重新播放');
  return false;
 }
 async waitForResume(epoch) {
  if (!this.canContinue(epoch)) return false;
  if (this.phase === 'paused') await new Promise(resolve => { this.wake = resolve; });
  return this.canContinue(epoch);
 }
 /**
  * A line's audio from its engine. A line the service refuses as too long (some take 30 seconds a line, and a 旁白
  * piece may run longer) is said in two parts cut at a sentence end, those again if need be, and the parts joined.
  */
 async say(engine, connection, route, line, request, signal, depth = 0) {
  try { return await this.providers.synthesize(request, signal); }
  catch (error) {
   const parts = depth < 4 && tooLong(error) ? halves(line.text) : null;
   if (!parts) throw error;
   const audio = [];
   for (const text of parts) { const part = { ...line, text }; audio.push(await this.say(engine, connection, route, part, buildRequest(engine, connection, route, part, this.providers.references), signal, depth + 1)); }
   return joinAudio(audio);
  }
 }
 /** A line's audio: from the cache, or made and kept. found(fromCache, key) is told before any making starts. */
 async make(line, route, s, signal, found = () => {}, still = () => !signal.aborted) {
  const effective = { ...structuredClone(route), language: route.language || s.general.defaultLanguage, model: route.model || s.connections[route.engine].model };
  let request = buildRequest(route.engine, s.connections[route.engine], effective, line, this.providers.references);
  const key = await requestHash(request);
  if (!still()) return null;
  const cacheEpoch = this.cache.epoch;
  if (this.readyEpoch !== cacheEpoch || !s.general.cacheEnabled) { this.readyAudio.clear(); this.readyBytes = 0; this.readyEpoch = cacheEpoch; }
  let blob = s.general.cacheEnabled ? this.readyAudio.get(key) || await this.cache.get(key) : null;
  if (!still()) return null;
  const fromCache = !!blob;
  found(fromCache, key);
  if (!blob) {
   // Someone else making the same line (提前生成, or the line ahead): its sound, unless that was given up.
   // A request given up (stopped, the reply changed) is not waited for: it may never answer.
   const shared = this.making.get(key);
   if (shared && !shared.signal?.aborted) blob = await Promise.race([shared.job, new Promise(resolve => { shared.signal?.addEventListener('abort', () => resolve(null), { once: true }); signal?.addEventListener('abort', () => resolve(null), { once: true }); })]).catch(() => null);
   if (!still()) return null;
   if (!blob) {
    const job = (async () => {
     // Cached audio never waits for a network catalog refresh.
     if (route.engine === 'fish' && TTSParameters.fishNative({ ...s.connections.fish, model: effective.model })) {
      await this.providers.fishCatalog?.();
      if (!still()) return null;
      request = buildRequest(route.engine, s.connections[route.engine], effective, line, this.providers.references);
     }
     const audio = await this.say(route.engine, s.connections[route.engine], effective, line, request, signal);
     // Made anew, not from the cache: what the 账本 counts.
     this.voiced(route.engine, line.text);
     return audio;
    })(), entry = { job, signal };
    this.making.set(key, entry);
    const done = () => { if (this.making.get(key) === entry) this.making.delete(key); };
    job.catch(() => {}).finally(done);
    signal?.addEventListener('abort', done, { once: true });
    blob = await job;
   }
   if (!still()) return null;
   if (this.settings().general.cacheEnabled) await this.cache.put(key, blob, cacheEpoch, {
    line: copyLine(line), route: { name: effective.name, engine: effective.engine, model: effective.model, voice: effective.voice }, requestKey: key
   });
  }
  if (s.general.cacheEnabled && this.cache.epoch === cacheEpoch && !this.readyAudio.has(key) && blob.size <= 16 * 1024 * 1024) {
   this.readyAudio.set(key, blob); this.readyBytes += blob.size;
   while (this.readyBytes > 16 * 1024 * 1024 || this.readyAudio.size > 24) { const [old, value] = this.readyAudio.entries().next().value; this.readyAudio.delete(old); this.readyBytes -= value.size; }
  }
  return { key, blob, fromCache, effective, request };
 }
 /**
  * 提前生成: makes these lines one after another and keeps them in the cache, plays nothing. Lines nobody has a voice
  * for are left out. Stops when `signal` is aborted or valid() turns false; a failure ends it (thrown). Returns how
  * many were made (not counting ones already in the cache).
  */
 async prepare(lines, { valid = () => true, signal, each = () => {} } = {}) {
  let made = 0;
  for (const line of lines) {
   const s = this.settings();
   if (signal?.aborted || !valid() || !s.general.cacheEnabled) break;
   if (line.narration) continue;
   const route = findRoute(s.routes, line.role);
   if (!route?.voice?.trim() && !(route?.engine === 'fish' && s.connections.fish.params.references.length) && !(route?.engine === 'mini' && s.connections.mini.params.timbre_weights.length)) continue;
   const done = await this.make(line, route, s, signal || new AbortController().signal, () => {}, () => !signal?.aborted && valid());
   if (!done) break;
   try { await this.sink.warm?.(done.blob); } catch { /* Playback reports unsupported audio when requested. */ }
   if (signal?.aborted || !valid()) break;
   if (!done.fromCache) { made++; each(line); }
  }
  return made;
 }
 /** Starts making the line at `index` now (one ahead of the one about to play); null when there is nothing to make. */
 makeAhead(index, signal) {
  const s=this.settingsOverride||this.settings();while(index<this.queue.length&&systemNarration(this.queue[index],s))index++;const line=this.queue[index];
  const route = line && findRoute(s.routes, line.role);
  if (!route?.voice?.trim() && !(route?.engine === 'fish' && s.connections.fish.params.references.length) && !(route?.engine === 'mini' && s.connections.mini.params.timbre_weights.length)) return null;
  const made = this.make(line, route, s, signal, () => {}, () => !signal.aborted && this.valid());
  made.catch(() => {});
  made.then(value => value && this.sink.warm?.(value.blob)).catch(() => {});
  return { index, made };
 }
 async finishedLine(epoch) {
  if (!this.canContinue(epoch)) return false;
  if (this.stepwise && this.index + 1 < this.queue.length && !this.queue[this.index+1]?.translationRead) {
   this.boundary = true; this.resumePhase = 'generating';
   this.emit('paused', '等待下一句');
   if (!await this.waitForResume(epoch)) return false;
   this.boundary = false;
  }
  this.index++; return true;
 }
 // Keep a small rolling window; the first ready segment can play immediately.
 fillBuffer(epoch, signal) {
  if (!this.canContinue(epoch) || this.phase === 'paused') return;
  const state = this.bufferState;
  const remaining = new Set(this.queue.slice(this.index));
  for (const line of state.entries.keys()) if (!remaining.has(line)) state.entries.delete(line);
  const s = this.settingsOverride || this.settings();
  let window = 0;
  for (const line of this.queue.slice(this.index)) {
   if (systemNarration(line, s)) continue;
   const route = findRoute(s.routes, line.role);
   if (!route?.voice?.trim() && !(route?.engine === 'fish' && s.connections.fish.params.references.length) && !(route?.engine === 'mini' && s.connections.mini.params.timbre_weights.length)) continue;
   if (++window > 4) break;
   if (state.entries.has(line)) continue;
   if (state.active >= 2) break;
   state.active++;
   const entry = {};
   state.entries.set(line, entry);
   entry.job = Promise.resolve().then(() => {
    if (!this.canContinue(epoch)) return null;
    return this.bufferedMake(line, route, s, signal, () => {}, () => this.canContinue(epoch));
   }).then(value => ({value}), error => ({error})).finally(() => {
    state.active--;
    if (this.current(epoch)) this.fillBuffer(epoch, signal);
   });
  }
 }
 async bufferStartup(epoch,signal) {
  this.fillBuffer(epoch,signal);
  const first=this.queue[this.index],entry=this.buffered.get(first);
  if(!entry)return;
  await entry.job;
  if(!this.canContinue(epoch)||!this.durations.get(this.lineId(first)))return;
  const deadline=Date.now()+8000;
  this.buffering=true;
  while(this.canContinue(epoch)&&!this.playNow&&Date.now()<deadline){
   let seconds=0,all=true;
   for(const line of this.queue.slice(this.index,this.index+4)){
    if(systemNarration(line,this.settingsOverride||this.settings()))continue;
    const duration=this.durations.get(this.lineId(line));if(!duration){all=false;break;}seconds+=duration;
   }
   this.bufferSeconds=seconds;
   if(seconds>=20||all)break;
   this.emit(this.phase==='paused'?'paused':'generating',`开播缓冲 · 已备 ${Math.floor(seconds)} 秒`);
   await new Promise(resolve=>setTimeout(resolve,80));
  }
  if(this.current(epoch))this.buffering=false;
 }
 async run(epoch) {
  const signal = this.controller.signal;
  try {
   if(this.startupBuffer)await this.bufferStartup(epoch,signal);
   while (this.index < this.queue.length) {
    if (!this.canContinue(epoch)) return;
    if (this.prebuffer) this.fillBuffer(epoch, signal);
    const s = this.settingsOverride || this.settings(), line = this.queue[this.index];
    // 旁白 with 系统朗读: the browser says it, nothing is made or kept. Without one, the story goes on to the next line.
    if (systemNarration(line,s)) {
     this.line = line; this.speaker = line.role; this.engine = 'system'; this.requestKey = null; this.pending = null;
     if (!this.speech) { if (!this.skipped.includes('旁白（这个浏览器不能系统朗读）')) this.skipped.push('旁白（这个浏览器不能系统朗读）'); this.index++; continue; }
     if (!await this.waitForResume(epoch)) return;
     for (let said = false; !said;) {
      this.emit('playing', '正在朗读 · ' + line.role);
      try { await this.speech.speak(line.text, { voice:line.translationRead&&s.narration.systemVoice&&!this.speech.voices?.().some(v=>v.id===s.narration.systemVoice&&/^(zh|cmn)/i.test(v.lang))?'':s.narration.systemVoice, rate:s.narration.rate*this.rate,volume:this.volume,lang:line.translationRead?'zh-CN':'' }, signal); said = true; }
      catch (error) {
       if (error?.name !== 'AbortError' || !this.current(epoch)) throw error;
       // Paused (see toggle): this piece again on resuming. 整篇朗读 turned off under it (dropNarration): on with the lines.
       if (this.phase !== 'paused') { said = true; continue; }
       if (!await this.waitForResume(epoch)) return;
      }
     }
     if (!this.canContinue(epoch)) return;
     if (!await this.finishedLine(epoch)) return;
     continue;
    }
    const route = findRoute(s.routes, line.role);
    this.line = line;
    this.speaker = line.role;
    this.engine = route?.engine || '';
    this.requestKey = null;
    if (!route?.voice?.trim() && !(route?.engine === 'fish' && s.connections.fish.params.references.length) && !(route?.engine === 'mini' && s.connections.mini.params.timbre_weights.length)) {
     // Playing a whole reply goes on past speakers without a voice, so a story with more people than voices still plays
     // through; a single line stops and asks for a voice.
     if (this.queue.length > 1) {
      if (line.role && !this.skipped.includes(line.role)) this.skipped.push(line.role);
      this.index++;
      continue;
     }
     this.pending = line.role;
     this.emit('waiting', '等待为 ' + line.role + ' 选择音色');
     this.unknown(line.role);
     return;
    }
    this.pending = null;
    // Made while the line before played (ahead): ready now. A failed one is tried again here, where its error shows.
    let early;
    const buffered = this.buffered?.get(line);
    if (buffered) {
     this.emit(this.phase === 'paused' ? 'paused' : 'generating', '准备播放 · ' + line.role);
     const result = await buffered.job;
     if (!this.canContinue(epoch)) return;
     if (result.error) throw result.error;
     early = result.value;
    } else early = this.ahead?.index === this.index ? await this.ahead.made.catch(() => null) : null;
    this.ahead = null;
    if (!this.canContinue(epoch)) return;
    const made = early || await this.bufferedMake(line, route, s, signal, (fromCache, key) => {
     if (!this.canContinue(epoch)) return;
     this.requestKey = key;
     this.emit(this.phase === 'paused' ? 'paused' : 'generating', (fromCache ? '读取缓存 · ' : '正在生成 · ') + line.role);
    }, () => this.canContinue(epoch));
    if (!made || !this.canContinue(epoch)) return;
    const { key, blob, fromCache, effective, request } = made;
    this.requestKey = key;
    await this.prepared({ key, blob, line: copyLine(line), route: structuredClone(effective), request: structuredClone(request), fromCache });
    if (this.lookahead && !this.prebuffer) this.ahead = this.makeAhead(this.index + 1, signal);
    if (!await this.waitForResume(epoch)) return;
    this.emit('playing', '正在播放 · ' + line.role + (fromCache ? ' · 缓存' : ''));
    const offset=this.seekOffset||0;this.seekOffset=0;
    await this.sink.play(blob, signal, { effect: lineEffect(line), offset, rate:this.rate });
    if (!this.canContinue(epoch)) return;
    this.played.add(key);
    try{globalThis.localStorage?.setItem('myphone-heard-audio-v1',JSON.stringify([...this.played].slice(-5000)));}catch{}
    if (!await this.finishedLine(epoch)) return;
   }
   this.complete();
  } catch (error) { this.fail(epoch, signal, error); }
 }
 complete() {
  this.buffered?.clear();
  const skipped = this.skipped || [];
  this.queue = [];
  this.index = 0;
  this.pending = null;
  this.skipped = [];
  this.emit('idle', skipped.length ? `播放完成 · 跳过了还没选音色的${skipped.join('、')}` : '播放完成');
 }
 fail(epoch, signal, error) {
  if (!this.current(epoch) || signal.aborted) return;
  this.controller?.abort();
  this.buffered?.clear();
  this.queue = [];
  this.index = 0;
  this.pending = null;
  this.emit('error', error.message || '播放失败，请手动重试');
 }
 async playBlob(blob, metadata = {}) {
  this.stop();
  if (!(blob instanceof Blob) || !blob.size) throw Error('没有可播放的音频');
  const line = copyLine(metadata.line || { role: metadata.role || metadata.speaker || '', text: metadata.text || '', translation: metadata.translation || '', emotion: metadata.emotion || '' });
  this.valid = () => true;
  this.queue = [line];
  this.line = line;
  this.speaker = metadata.speaker || line.role || '';
  this.engine = metadata.engine || metadata.route?.engine || '';
  this.source = 'favorite';
  this.requestKey = metadata.requestKey || metadata.key || null;
  this.controller = new AbortController();
  const epoch = this.epoch, signal = this.controller.signal;
  this.emit('generating', '准备播放收藏');
  try {
   await this.sink.unlock();
   if (!this.canContinue(epoch) || !await this.waitForResume(epoch)) return;
   this.emit('playing', '正在播放 · ' + (this.speaker || '收藏音频'));
   const offset=this.seekOffset||0;this.seekOffset=0;
    await this.sink.play(blob, signal, { effect: lineEffect(line), offset, rate:this.rate });
   if (!this.canContinue(epoch)) return;
   if (this.requestKey) this.played.add(this.requestKey);
   this.complete();
  } catch (error) { this.fail(epoch, signal, error); }
 }
 setStepwise(enabled) {
  this.stepwise=!!enabled;
  const revision=this.modeRevision=(this.modeRevision||0)+1;
  this.change(this.snapshot());
  // An asynchronous device resume must not override a later switch back to stepwise.
  if(!this.stepwise&&this.boundary&&this.phase==='paused'){
   const epoch=this.epoch;
   return Promise.resolve(this.sink.resume()).then(()=>{
    if(!this.current(epoch)||this.modeRevision!==revision||this.stepwise||!this.boundary||this.phase!=='paused')return;
    this.speech?.resume();this.emit('generating','继续全文朗读');
    this.wake?.();this.wake=null;
   }).catch(error=>{if(this.current(epoch)&&this.modeRevision===revision)this.emit('error',error.message||'请再次点击播放');});
  }
 }
 toggle() {
  if (['playing', 'generating'].includes(this.phase)) {
   this.resumePhase = this.phase;
   const epoch = this.epoch;
   // Many phones cannot hold the browser's speech: asked to, it just goes on talking. It is cut, and that piece said again on resuming.
   if (this.line?.narration && this.engine === 'system') this.speech?.stop(); else this.speech?.pause();
   Promise.resolve(this.sink.pause()).catch(error => { if (this.current(epoch)) this.emit('error', error.message || '暂停失败'); });
   this.emit('paused', '已暂停');
  } else if (this.phase === 'paused') {
   const epoch = this.epoch;
   return Promise.resolve(this.sink.resume()).then(() => {
    if (!this.current(epoch) || this.phase !== 'paused') return;
    this.speech?.resume();
    this.emit(this.resumePhase === 'generating' ? 'generating' : 'playing', this.resumePhase === 'generating' ? '继续生成' : '继续播放');
    this.wake?.();
    this.wake = null;
   }).catch(error => { if (this.current(epoch)) this.emit('error', error.message || '请再次点击以开启声音'); });
  }
 }
 /** 整篇朗读 turned off part way through a reply: the lines go on, the story between them does not. */
 dropNarration() {
  if (!this.queue.some(line => line.narration)) return;
  const current = this.queue[this.index];
  this.queue = [...this.queue.slice(0, this.index + 1), ...this.queue.slice(this.index + 1).filter(line => !line.narration||line.translationRead)];
  if (current?.narration && !current.translationRead && this.engine === 'system' && this.phase === 'playing') this.speech?.stop();
 }
 async unlockAndRun() {
  const epoch = this.epoch;
  try {
   await this.sink.unlock();
   if (this.current(epoch)) await this.run(epoch);
  } catch (error) { if (this.current(epoch)) this.emit('error', error.message || '请再次点击以开启声音'); }
 }
 continuePending() {
  if (this.phase !== 'waiting') return;
  this.emit('generating', '准备继续播放');
  return this.unlockAndRun();
 }
 close() { this.stop(); this.readyAudio.clear(); this.readyBytes = 0; return this.sink.close?.(); }
}
