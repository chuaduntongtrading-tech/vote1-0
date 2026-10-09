"use strict";
import { platform, currentUser, signOut, authMessage, auth } from './platform.js';
const claude = platform;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const MIC_ERR = "Microphone access is unavailable. Please check microphone permission or enter your information manually.";
const TX_ERR  = "Unable to process speech. Please try again or enter the information manually.";

/* ---------- state (in memory only; nothing clinical is persisted) ---------- */
const S = {
  segs: [], interim: '', recording: false, paused: false, lang: 'ms-MY',
  soap: null, orig: null, aiMissing: [], unclass: false, editing: false, approved: false,
  sessionStart: null, sessionCounted: false, docTimed: false, generating: false, ctl: null
};
const bufferText = () => S.segs.join(' ').replace(/\s+\n/g,'\n').trim();

/* ---------- toast / overlay ---------- */
let toastT;
function toast(msg, ms = 3800){
  document.querySelectorAll('.toast').forEach(n => n.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role','status'); t.textContent = msg;
  document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms);
}
function openSheet(html){ $('sheet').innerHTML = html; $('overlay').classList.remove('hidden'); const f = $('sheet').querySelector('button,input'); f && f.focus(); }
function closeSheet(){ $('overlay').classList.add('hidden'); $('sheet').innerHTML = ''; }

/* ---------- login & microphone help sheets ---------- */
/* Netlify Identity sign up / log in. `retry` runs after a successful login. */
async function showLoginHelp(msg, retry){
  const u = await currentUser();
  if(u){
    openSheet(`<h2>Akaun VOTe</h2>
      <p>${esc(msg || 'Data akaun tidak dapat dimuatkan.')}</p>
      <p class="small muted">Log masuk sebagai ${esc(u.email)}</p>
      <div class="stack">
        <button class="btn primary" id="lh-retry">Cuba lagi</button>
        <button class="btn" id="lh-out">Log keluar</button>
        <button class="btn ghost" id="lh-guest">Teruskan sebagai tetamu</button>
      </div>`);
    $('lh-retry').onclick = () => { closeSheet(); retry && retry(); };
    $('lh-out').onclick = async () => { await signOut(); closeSheet(); syncLogout(); toast('Anda telah log keluar.'); };
    $('lh-guest').onclick = () => { closeSheet(); setGuest(); };
    return;
  }
  let tab = 'login';
  const render = () => {
    openSheet(`<h2>${tab === 'signup' ? 'Daftar akaun VOTe' : tab === 'forgot' ? 'Lupa kata laluan' : 'Log masuk VOTe'}</h2>
      <p class="small muted">${esc(msg || 'Log masuk untuk penjanaan SOAP automatik dan analitik pilot tanpa nama.')}</p>
      <form class="stack" id="au-form" novalidate>
        ${tab === 'signup' ? '<input class="field" id="au-name" autocomplete="name" placeholder="Nama paparan (pilihan)" aria-label="Nama paparan">' : ''}
        <input class="field" id="au-email" type="email" autocomplete="email" required placeholder="E-mel" aria-label="E-mel">
        ${tab === 'forgot' ? '' : `<input class="field" id="au-pass" type="password" minlength="8" required autocomplete="${tab === 'signup' ? 'new-password' : 'current-password'}" placeholder="Kata laluan" aria-label="Kata laluan">`}
        <div class="small" id="au-msg" role="status" style="min-height:1.2em;color:var(--danger)"></div>
        <button class="btn primary block" type="submit" id="au-go">${tab === 'signup' ? 'Daftar' : tab === 'forgot' ? 'Hantar pautan set semula' : 'Log masuk'}</button>
      </form>
      <div class="stack" style="margin-top:12px">
        ${tab === 'login' ? '<button class="btn sm" id="au-tab-signup">Belum ada akaun? Daftar</button><button class="btn sm ghost" id="au-tab-forgot">Lupa kata laluan?</button>' : '<button class="btn sm" id="au-tab-login">Sudah ada akaun? Log masuk</button>'}
        <button class="btn ghost" id="lh-guest">Teruskan sebagai tetamu</button>
      </div>`);
    ['signup','forgot','login'].forEach(t => { const b = $('au-tab-' + t); if(b) b.onclick = () => { tab = t; render(); }; });
    $('lh-guest').onclick = () => { closeSheet(); setGuest(); };
    $('au-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const email = $('au-email').value.trim(), pass = $('au-pass') ? $('au-pass').value : '';
      const out = $('au-msg'); out.style.color = 'var(--danger)';
      if(!email || (tab !== 'forgot' && pass.length < 8)){ out.textContent = 'Masukkan e-mel dan kata laluan (sekurang-kurangnya 8 aksara).'; return; }
      $('au-go').disabled = true;
      try{
        if(tab === 'forgot'){
          await auth.requestPasswordRecovery(email);
          out.style.color = 'var(--green)'; out.textContent = 'Semak e-mel anda untuk pautan set semula kata laluan.';
        }else if(tab === 'signup'){
          const nu = await auth.signup(email, pass, {full_name: $('au-name').value.trim()});
          if(nu && nu.emailVerified){ closeSheet(); toast('Akaun dicipta. Anda telah log masuk.'); retry && retry(); }
          else { out.style.color = 'var(--green)'; out.textContent = 'Akaun dicipta. Semak e-mel anda untuk mengesahkan akaun, kemudian log masuk.'; }
        }else{
          await auth.login(email, pass);
          closeSheet(); toast('Log masuk berjaya.'); retry && retry();
        }
      }catch(e){ out.textContent = authMessage(e); }
      finally{ const g = $('au-go'); if(g) g.disabled = false; }
    };
  };
  render();
}
function showNewPassword(inviteToken){
  openSheet(`<h2>${inviteToken ? 'Terima jemputan VOTe' : 'Tetapkan kata laluan baharu'}</h2>
    <form class="stack" id="np-form">
      <input class="field" id="np-pass" type="password" minlength="8" required autocomplete="new-password" placeholder="Kata laluan baharu" aria-label="Kata laluan baharu">
      <div class="small" id="np-msg" role="status" style="color:var(--danger)"></div>
      <button class="btn primary block" type="submit">Simpan kata laluan</button>
    </form>`);
  $('np-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const p = $('np-pass').value;
    if(p.length < 8){ $('np-msg').textContent = 'Sekurang-kurangnya 8 aksara.'; return; }
    try{ if(inviteToken) await auth.acceptInvite(inviteToken, p); else await auth.updateUser({password: p}); closeSheet(); toast(inviteToken ? 'Akaun sedia. Tekan Sign Up / Log In untuk mula.' : 'Kata laluan dikemas kini.'); }
    catch(e){ $('np-msg').textContent = authMessage(e); }
  };
}
function micSteps(){
  const ua = navigator.userAgent || '';
  if(/iPhone|iPad|iPod/i.test(ua)) return ['Buka <b>Tetapan</b> iPhone > <b>Safari</b> > <b>Mikrofon</b>, pilih <b>Tanya</b> atau <b>Benarkan</b>.','Atau di Safari, ketik <b>aA</b> di bar alamat > <b>Tetapan Laman Web</b> > <b>Mikrofon</b> > <b>Benarkan</b>.','Muat semula halaman ini.'];
  if(/Android/i.test(ua)) return ['Ketik ikon <b>kunci</b> atau <b>tetapan</b> di bar alamat > <b>Kebenaran</b> > <b>Mikrofon</b> > <b>Benarkan</b>.','Jika tiada, buka <b>Tetapan Android</b> > <b>Apl</b> > pelayar anda > <b>Kebenaran</b> > <b>Mikrofon</b>.','Muat semula halaman ini.'];
  return ['Klik ikon <b>kunci</b> di sebelah kiri bar alamat > <b>Kebenaran laman</b> / <b>Site settings</b>.','Tetapkan <b>Mikrofon</b> kepada <b>Benarkan</b>.','Muat semula halaman ini.'];
}
function micWhy(code){
  const m = {
    'not-allowed':'Mikrofon atau perkhidmatan suara disekat oleh aplikasi/pelayar yang memaparkan VOTe, walaupun telefon anda membenarkan mikrofon. Ini biasa berlaku bila VOTe dibuka di dalam aplikasi lain atau paparan terbenam.',
    'service-not-allowed':'Perkhidmatan suara ke teks disekat oleh aplikasi/pelayar yang memaparkan VOTe. Ini biasa berlaku bila VOTe dibuka di dalam aplikasi lain atau paparan terbenam.',
    'audio-capture':'Tiada mikrofon dikesan, atau mikrofon sedang digunakan oleh aplikasi lain (panggilan, rakaman skrin). Tutup aplikasi itu dan cuba lagi.',
    'network':'Suara ke teks memerlukan sambungan internet yang stabil. Semak data atau Wi-Fi.',
    'language-not-supported':'Bahasa yang dipilih tidak disokong oleh pelayar ini. Cuba tukar bahasa di Session.'
  };
  return m[code] || '';
}
async function showMicHelp(code){
  let state = 'prompt';
  try{ if(navigator.permissions) state = (await navigator.permissions.query({name:'microphone'})).state; }catch(_){}
  const why = micWhy(code);
  openSheet(`<h2>Kebenaran mikrofon</h2>
    ${why ? `<p>${why}</p>` : ''}
    <p>${state === 'denied' ? 'Mikrofon disekat untuk laman ini. Pelayar tidak membenarkan laman membuka tetapan kebenaran secara terus, jadi ikut langkah di bawah.' : 'Tekan butang di bawah dan pilih <b>Benarkan</b> apabila pelayar bertanya.'}</p>
    <div class="stack">
      ${state === 'denied' ? '' : '<button class="btn primary" id="mh-ask">🎙️ Minta kebenaran mikrofon</button>'}
      <ol class="plain" id="mh-steps" style="${state === 'denied' ? '' : 'display:none'}">${micSteps().map(x => `<li>${x}</li>`).join('')}</ol>
      <a class="btn" href="${DIRECT_URL}" target="_blank" rel="noopener noreferrer">Buka VOTe terus dalam pelayar (Chrome / Safari)</a>
      <div class="small muted">Alternatif: ketuk kotak teks, kemudian guna ikon mikrofon pada papan kekunci telefon untuk dikte. Anda juga boleh menaip manual.</div>
      <div class="small muted" id="mh-diag">Diagnostik: ralat=${esc(code || '-')}, kebenaran=${esc(state)}, sokongan suara=${SR ? 'ya' : 'tidak'}, dalam paparan terbenam=${(() => { try{ return window.top !== window.self ? 'ya' : 'tidak'; }catch(_){ return 'ya'; } })()}</div>
      <button class="btn ghost" id="mh-close">Tutup</button>
    </div>`);
  $('mh-close').onclick = closeSheet;
  const ask = $('mh-ask');
  if(ask) ask.onclick = async () => {
    try{
      const st = await navigator.mediaDevices.getUserMedia({audio:true});
      st.getTracks().forEach(t => t.stop());
      closeSheet(); toast('Kebenaran mikrofon diberi. Tekan MULA CERITA semula.', 5000);
    }catch(err){ $('mh-steps').style.display = ''; ask.remove(); $('mh-diag').textContent += ', getUserMedia=' + (err && err.name || 'gagal'); }
  };
}

/* ---------- share VOTe link ---------- */
const DIRECT_URL = location.origin + '/';
const SHARE_URL = location.origin + '/';
const SHARE_TEXT = 'VOTe 1.0 (Voice Occupational Therapy): ceritakan sesi, VOTe bantu susun draf nota SOAP untuk disemak. Cuba di sini:';
function openShare(){
  openSheet(`<h2>Kongsi VOTe 1.0</h2>
    <p class="small muted">Pautan ini dikongsi kepada rakan OT. Tiada data pesakit atau sesi anda disertakan.</p>
    <div class="stack">
      <button class="btn primary" id="sh-native">📤 Kongsi…</button>
      <a class="btn" id="sh-wa" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(SHARE_TEXT + ' ' + SHARE_URL)}">💬 Hantar melalui WhatsApp</a>
      <button class="btn" id="sh-copy">📋 Salin pautan</button>
      <button class="btn ghost" id="sh-close">Tutup</button>
    </div>`);
  $('sh-close').onclick = closeSheet;
  $('sh-copy').onclick = async () => { if(await copyText(SHARE_URL)){ track('share'); toast('Pautan VOTe disalin.'); } else toast('Salin gagal. Pilih pautan dan salin manual: ' + SHARE_URL, 6000); };
  $('sh-wa').onclick = () => { track('share'); };
  const nat = $('sh-native');
  if(!navigator.share) nat.remove();
  else nat.onclick = async () => {
    try{ await navigator.share({title:'VOTe 1.0', text:SHARE_TEXT, url:SHARE_URL}); track('share'); closeSheet(); }
    catch(e){ if(e && e.name !== 'AbortError') toast('Kongsi tidak tersedia di sini. Guna WhatsApp atau Salin pautan.', 5000); }
  };
}
$('h-share').onclick = openShare;
function confirmBox({title, body, ok, cancel='CANCEL', danger=false}){
  return new Promise(res => {
    openSheet(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="row"><button class="btn" id="cf-no">${esc(cancel)}</button><button class="btn ${danger?'danger':'primary'}" id="cf-yes">${esc(ok)}</button></div>`);
    $('cf-no').onclick = () => { closeSheet(); res(false); };
    $('cf-yes').onclick = () => { closeSheet(); res(true); };
  });
}

/* ---------- navigation ---------- */
function go(view){
  if(!A.mode && (view === 'session' || view === 'library' || view === 'guide')) setGuest();
  ['home','session','guide','library','settings'].forEach(v => $('v-'+v).classList.toggle('hidden', v !== view));
  const navKey = view === 'guide' ? 'session' : view;
  document.querySelectorAll('nav button').forEach(b => { if (b.dataset.go === navKey) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  window.scrollTo({top:0});
  if (view === 'settings') refreshAdmin();
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => go(b.dataset.go));

/* ---------- analytics (anonymous counters only) ---------- */
const AN = { db:null, ref:null, data:null, timer:null, saving:Promise.resolve(), isOwner:false, uid:null };
const today = () => new Date().toISOString().slice(0,10);
async function initAnalytics(){
  if(AN.data) return true;
  try{
    const user = await claude.use('user'); const db = await claude.use('db');
    if(!user || !db) return false;
    AN.uid = await user.id(); if(!AN.uid) return false;
    AN.isOwner = await user.isOwner();
    AN.db = db; AN.ref = db.doc('usage/' + AN.uid);
    const snap = await AN.ref.get();
    AN.data = snap.exists ? snap.data() : {first: today(), t:{}, d:{}, docMs:0, docN:0, fb:[]};
    AN.data = JSON.parse(JSON.stringify(AN.data));
    AN.data.t ||= {}; AN.data.d ||= {}; AN.data.fb ||= [];
    AN.data.last = today(); touchDay(); schedSave();
    if(!$('v-settings').classList.contains('hidden')) refreshAdmin();
    return true;
  }catch(e){ AN.data = null; return false; }
}
const A = {mode:null};
function maybeDisclaimer(){ let a = false; try{ a = localStorage.getItem('vote_ack') === '1'; }catch(_){} if(!a) showDisclaimer(true); }
function showChoose(){
  setTimeout(maybeDisclaimer, 0); syncLogout();
  $('home-access').classList.add('hidden'); $('home-choose').classList.remove('hidden');
  $('home-who').textContent = A.mode === 'user' ? 'Log masuk sebagai pengguna pilot. Kiraan penggunaan tanpa nama direkodkan.' : 'Mod tetamu. Penggunaan tidak direkodkan. Penjanaan AI melalui salin-tampal ke ChatGPT atau Gemini; log masuk untuk penjanaan automatik.';
}
function setGuest(){ A.mode = 'guest'; L.mode = 'manual'; renderLibMode(); AN.data = null; AN.ref = null; AN.isOwner = false; AN.uid = null; showChoose(); }
$('h-guest').onclick = setGuest;
$('h-login').onclick = async () => {
  const ok = await initAnalytics();
  if(ok){ A.mode = 'user'; L.mode = 'auto'; renderLibMode(); showChoose(); }
  else showLoginHelp('Log masuk diperlukan untuk mod pengguna. Anda boleh teruskan sebagai tetamu.', () => $('h-login').click());
};
async function syncLogout(){ const u = await currentUser().catch(() => null); $('h-logout').classList.toggle('hidden', !u); }
$('h-logout').onclick = async () => { await signOut(); A.mode = null; AN.data = null; AN.ref = null; AN.isOwner = false; AN.uid = null; $('admin').classList.add('hidden'); $('home-access').classList.remove('hidden'); $('home-choose').classList.add('hidden'); go('home'); syncLogout(); toast('Anda telah log keluar.'); };
$('h-switch').onclick = async () => { if(A.mode === 'user') await signOut(); A.mode = null; AN.data = null; AN.ref = null; AN.isOwner = false; AN.uid = null; $('home-access').classList.remove('hidden'); $('home-choose').classList.add('hidden'); $('admin').classList.add('hidden'); syncLogout(); };
function touchDay(){ AN.data.d[today()] ||= {}; }
function track(key, n = 1){
  if(!AN.data) return;
  try{ AN.data.t[key] = (AN.data.t[key]||0) + n; touchDay(); const d = AN.data.d[today()]; d[key] = (d[key]||0) + n; AN.data.last = today(); schedSave(); }catch(e){}
}
function trackDocTime(){
  if(!AN.data || S.docTimed || !S.sessionStart) return;
  S.docTimed = true; AN.data.docMs = (AN.data.docMs||0) + (Date.now() - S.sessionStart); AN.data.docN = (AN.data.docN||0) + 1; schedSave();
}
function schedSave(){
  clearTimeout(AN.timer);
  AN.timer = setTimeout(() => {
    AN.saving = AN.saving.then(async () => {
      if(!AN.ref || !AN.data) return;
      const keep = Object.keys(AN.data.d).sort().slice(-45); const nd = {}; keep.forEach(k => nd[k] = AN.data.d[k]); AN.data.d = nd;
      try{ await AN.ref.set(AN.data); }catch(e){}
    });
  }, 2000);
}
function markSession(){
  if(!S.sessionStart) S.sessionStart = Date.now();
  if(!S.sessionCounted){ S.sessionCounted = true; track('sessions'); }
}

/* ---------- speech ---------- */
let rec = null, wantRec = false;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function speechLang(){ return S.lang === 'rojak' ? 'ms-MY' : S.lang; }
function startSpeech(t, lang){
  if(!SR){ toast('Pelayar ini tidak menyokong input suara. Gunakan Chrome atau Safari terkini, atau taip maklumat secara manual.', 7000); return false; }
  stopSpeech();
  rec = new SR(); rec.lang = lang; rec.continuous = true; rec.interimResults = true;
  rec.onresult = e => {
    let interim = '';
    for(let i = e.resultIndex; i < e.results.length; i++){
      const r = e.results[i];
      if(r.isFinal){ const x = r[0].transcript.trim(); if(x) t.onFinal(x); } else interim += r[0].transcript;
    }
    t.onInterim(interim);
  };
  rec.onerror = e => {
    if(e.error === 'no-speech' || e.error === 'aborted') return;
    wantRec = false; t.onStop();
    if(['not-allowed','service-not-allowed','audio-capture','network','language-not-supported'].includes(e.error)) showMicHelp(e.error); else toast(TX_ERR + ' (' + e.error + ')', 6000);
  };
  rec.onend = () => { if(wantRec){ try{ rec.start(); }catch(_){ wantRec = false; t.onStop(); } } else t.onStop(); };
  wantRec = true;
  try{ rec.start(); }catch(e){ wantRec = false; showMicHelp(e && e.name); return false; }
  return true;
}
function stopSpeech(){ wantRec = false; try{ rec && rec.stop(); }catch(_){} }

/* ---------- session buffer UI ---------- */
function renderBuffer(){
  const ta = $('transcript');
  if(document.activeElement !== ta || S.recording) ta.value = bufferText();
  ta.readOnly = S.recording;
  $('interim').textContent = S.recording && S.interim ? '… ' + S.interim : '';
  const st = $('status'); st.className = 'status';
  let label = 'Belum mula';
  if(S.recording){ st.classList.add('rec'); label = 'Recording'; }
  else if(S.paused){ st.classList.add('paused'); label = 'Paused'; }
  else if(bufferText()){ st.classList.add('ready'); label = 'Ready to generate'; }
  $('status-t').textContent = label;
  $('b-pause').disabled = !S.recording;
  $('b-resume').disabled = !(S.paused && !S.recording);
  $('b-mic').textContent = S.recording ? '🎙️ MERAKAM…' : (bufferText() ? '🎙️ SAMBUNG CERITA' : '🎙️ MULA CERITA');
  $('b-mic').disabled = S.recording;
  $('b-gen').disabled = S.generating;
}
function startRecording(){
  const ok = startSpeech({
    onFinal: x => { S.segs.push(x); S.interim = ''; markSession(); invalidateApproval(); renderBuffer(); },
    onInterim: x => { S.interim = x; renderBuffer(); },
    onStop: () => { S.recording = false; S.interim = ''; renderBuffer(); }
  }, speechLang());
  if(ok){ S.recording = true; S.paused = false; markSession(); renderBuffer(); }
}
function pauseRecording(){ stopSpeech(); S.recording = false; S.paused = true; S.interim = ''; renderBuffer(); }

$('b-mic').onclick = startRecording;
$('b-pause').onclick = pauseRecording;
$('b-resume').onclick = startRecording;
$('b-add').onclick = () => { $('addbox').classList.toggle('hidden'); $('add-text').focus(); };
$('b-add-go').onclick = () => {
  const v = $('add-text').value.trim(); if(!v) return;
  S.segs.push(v); $('add-text').value = ''; $('addbox').classList.add('hidden'); markSession(); invalidateApproval(); renderBuffer(); toast('Maklumat ditambah ke sesi.');
};
$('transcript').addEventListener('input', e => { S.segs = e.target.value.trim() ? [e.target.value] : []; if(S.segs.length) markSession(); S.paused = false; invalidateApproval(); renderBuffer(); });
$('b-undo').onclick = () => {
  if(!S.segs.length){ toast('Tiada ayat untuk dibuang.'); return; }
  if(S.segs.length === 1 && S.segs[0].includes('. ')){ const parts = S.segs[0].split(/(?<=[.!?])\s+/); parts.pop(); S.segs = parts.length ? [parts.join(' ')] : []; }
  else S.segs.pop();
  renderBuffer();
};
$('b-sample').onclick = () => { S.segs = ['Mak kata anak dah pergi sekolah tapi cikgu kata dia tak boleh duduk diam.']; markSession(); renderBuffer(); };
document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => {
  S.lang = b.dataset.lang; document.querySelectorAll('[data-lang]').forEach(x => x.setAttribute('aria-pressed', x === b));
  if(S.recording){ pauseRecording(); startRecording(); }
});

/* ---------- new client ---------- */
$('b-new').onclick = async () => {
  const ok = await confirmBox({title:'Start a new client/session?', body:'Current unsaved information will be cleared.', ok:'START NEW CLIENT', danger:true});
  if(!ok) return;
  stopSpeech(); if(S.ctl) S.ctl.abort();
  Object.assign(S, {segs:[], interim:'', recording:false, paused:false, soap:null, orig:null, aiMissing:[], unclass:false, editing:false, approved:false, sessionStart:null, sessionCounted:false, docTimed:false, checkCounted:false, generating:false, ctl:null});
  reportLang = 'en'; renderReportLang();
  track('newclient'); renderBuffer(); renderResult(); $('lib-out').innerHTML = ''; $('explore-out').innerHTML = '';
  toast('Sesi baharu dimulakan.');
};

/* ---------- SOAP generation ---------- */
const SOAP_RULES = `You are VOTe, a documentation assistant for Occupational Therapists in Malaysia. Convert the therapist's spoken or typed narrative (Bahasa Melayu, English, or mixed) into a DRAFT SOAP note in the OUTPUT LANGUAGE stated at the end of these instructions, following the Ministry of Health Malaysia (KKM) OT SOAP documentation guide and using OTPF-4 concepts only where the input supports them.

KKM SOAP structure:
S (Subjective): what the client, parent/caregiver, teacher or other informant REPORTED: complaints/concerns, history, prior level of function, current level of function, lifestyle/situation, emotions/attitudes, goals, response to previous treatment, other relevant information. Always name the source (e.g. "Mother reported...", "Teacher reported...").
O (Objective): only what the therapist directly observed, assessed or measured: session duration/location/purpose (only if stated), assessment findings and scores (only if stated), observable performance, assistance and prompting level (only if stated), intervention provided, client's response. 
A (Assessment): clinical interpretation of S + O: occupational performance problem and contributing factors, progress, potential, other relevant interpretation. Link to occupations/occupational performance. Do NOT simply repeat O. Use hedged wording ("findings suggest", "may be associated with"). Include OTPF-4 domains (occupations, contexts, performance patterns, performance skills, client factors, activity demands) ONLY where relevant and supported.
P (Plan): NEXT actions only: next intervention, further assessment/reassessment, caregiver education, home programme, environmental modification, equipment, referral, frequency/duration only if stated. Never put past intervention in P. If the therapist says nothing needs to change, write "Continue current plan." If the therapist gave no plan, write "Plan not stated by therapist. To be determined by therapist."

STRICT SAFETY RULES:
- NEVER fabricate diagnoses, symptoms, observations, scores, measurements, duration, frequency, assistance or prompting levels, goals, treatment response or assessment results. Do not fill gaps with assumptions. If something is missing, omit it or write "not reported" / "not observed during the current session" where appropriate.
- Keep the source distinct: caregiver/teacher report stays in S as reported. Never convert report into therapist observation. Never present interpretation as objective fact.
- If the narrative contains only reported information and no therapist observation, O must say "No direct therapist observation or measurement was provided for this session." Do not invent any.
- Convert informal language into professional terminology WITHOUT exaggeration. Preserve meaning.
- Do not reproduce personal identifiers (names, IC numbers, MRN, phone, address). Use "Client", "Mother", "Teacher", etc.
- If the input is tagged with [S], [O], [A] or [P], treat the tag only as the therapist's hint of the section; still obey all rules.
- If some content cannot be confidently classified, set "unclassified" to true and keep that content out of the note rather than guessing.
- You are not diagnosing and not prescribing; this is a draft for the therapist to review.

DOCUMENTATION SOURCE: the structure follows Panduan Dokumentasi (Format SOAP) Perkhidmatan Terapi Cara Kerja, KKM, 2023. The problem list and long/short term goals are written only at initial assessment or reassessment: include goals or a problem list only if the therapist states them; never create goals, timelines or assist levels. Use "Continue current plan." in P only if the therapist indicates the plan is unchanged.

PAIN DOCUMENTATION SAFETY:
- NEVER infer or invent a pain score from crying, facial expression, guarding, movement, aggression, withdrawal or behaviour. Only record a pain score if the narrative states that a validated pain assessment was performed and gives the score.
- Behaviour only, for example "child cried during dressing": write "Client demonstrated crying during dressing; pain intensity was not formally assessed/reported." Do not write a pain score.
- If a score is given with FLACC: "Pain was assessed using the FLACC scale, with a total score of X/10." If self-reported with FPS-R: "Client self-reported pain intensity using the FPS-R, scoring X/10." Name the tool only if the narrative names it.
- Where relevant and not provided, use "Not assessed" or "Not observed" rather than guessing.

OUTPUT: return ONLY a JSON object, no markdown fences, exactly:
{"S": string, "O": string, "A": string, "P": string, "missing": string[], "unclassified": boolean}
Keep the JSON keys exactly "S", "O", "A", "P", "missing", "unclassified" in every language. Within each string use short paragraphs or lines separated by \\n. "missing" lists brief English reminders of clinically useful information that was not provided (for example duration, assistance level, quantitative measure, frequency of behaviour, response to intervention, source clarity).`;

/* Report language is independent of the spoken language: default English, even for BM or mixed input. */
const REPORT_LANG = {
  en: `OUTPUT LANGUAGE: ENGLISH. Write S, O, A and P entirely in professional Occupational Therapy English, even when the narrative is in Bahasa Melayu or mixed BM-English. Translate faithfully; do not add or drop information while translating.`,
  ms: `OUTPUT LANGUAGE: BAHASA MELAYU. Write S, O, A and P entirely in formal professional Bahasa Melayu as used in Malaysian government clinical records, even when the narrative is in English or mixed. Keep standard clinical terms, assessment tool names and abbreviations in English where Malaysian OTs normally use them (for example FLACC, FPS-R, OTPF-4, fine motor, sensory processing), optionally with the BM term. Use these BM equivalents of the fixed phrases above: "Ibu melaporkan..." / "Guru melaporkan...", "tidak dilaporkan", "tidak diperhatikan semasa sesi ini", "Tiada pemerhatian atau pengukuran terus oleh terapis diberikan untuk sesi ini.", "Teruskan pelan semasa.", "Pelan tidak dinyatakan oleh terapis. Akan ditentukan oleh terapis.", "Kesakitan tidak dinilai/dilaporkan secara formal." Keep "missing" in English.`
};
const SECTION_NAMES = {en: ['Subjective','Objective','Assessment','Plan'], ms: ['Subjektif','Objektif','Penilaian','Pelan']};
/* Not persisted: every app load and every new client starts in English; BM is a per-session choice. */
let reportLang = 'en';
try{ localStorage.removeItem('vote_rlang'); }catch(_){}
function renderReportLang(){ document.querySelectorAll('[data-rlang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.rlang === reportLang)); }
document.querySelectorAll('[data-rlang]').forEach(b => b.onclick = () => {
  reportLang = b.dataset.rlang; renderReportLang();
  if(S.soap && S.soapLang !== reportLang) toast(reportLang === 'ms' ? 'Laporan seterusnya dalam Bahasa Melayu. Tekan JANA SOAP semula untuk menukar draf ini.' : 'Next report in English. Press JANA SOAP again to convert this draft.', 5000);
});
renderReportLang();

$('b-gen').onclick = async () => {
  const text = bufferText();
  if(!text){ toast('Tiada maklumat lagi. Tekan MULA CERITA atau taip maklumat dahulu.'); return; }
  if(S.recording) pauseRecording(); S.paused = false;
  const lang = reportLang;
  const soapPrompt = SOAP_RULES + '\n\n' + REPORT_LANG[lang] + '\n\nTHERAPIST NARRATIVE:\n"""\n' + text + '\n"""';
  let sample = null, manualR = null;
  if(L.mode === 'auto'){
    sample = await claude.use('sample');
    if(!sample){ toast('Log masuk untuk penjanaan automatik. Beralih ke mod salin-tampal.', 5000); L.mode = 'manual'; renderLibMode(); }
  }
  if(!sample){ try{ manualR = await manualJsonSheet(soapPrompt, SOAP_MANUAL_SUFFIX); }catch(e){ return; } }
  S.generating = true; S.ctl = new AbortController(); renderBuffer();
  $('empty').classList.add('hidden'); $('result').classList.remove('hidden');
  $('cards').innerHTML = `<div class="card" id="gen-wait"><b>VOTe sedang menyusun draf SOAP…</b><p class="small muted" style="margin:6px 0 10px">Ini mungkin ambil beberapa saat.</p><button class="btn sm" id="gen-stop">Berhenti</button></div>`;
  $('gen-stop').onclick = () => S.ctl && S.ctl.abort();
  ['edit-row','outbox'].forEach(i => $(i).classList.add('hidden')); $('check').classList.add('hidden'); $('unclass').classList.add('hidden');
  try{
    const r = manualR || await sample.json(soapPrompt, {signal: S.ctl.signal, cache:false});
    const soap = {S: String(r.S||'').trim(), O: String(r.O||'').trim(), A: String(r.A||'').trim(), P: String(r.P||'').trim()};
    S.soap = soap; S.soapLang = lang; S.orig = {...soap}; S.aiMissing = Array.isArray(r.missing) ? r.missing.map(String) : []; S.unclass = !!r.unclassified;
    S.approved = false; S.editing = false; S.checkCounted = false; track('soap');
    renderResult(); runCheck(false);
    $('right').scrollIntoView({behavior:'smooth', block:'start'});
  }catch(e){
    S.soap = null; renderResult();
    if(e && e.code === 'cancelled') toast('Penjanaan dihentikan.');
    else if(e && e.code === 'not_granted') toast('Sesi log masuk tamat. Sila log masuk semula untuk menjana SOAP automatik.', 6000);
    else if(e && e.code === 'rate_limited') toast('Terlalu banyak permintaan. Cuba lagi sebentar lagi.', 6000);
    else toast('Unable to generate the draft. Please try again or write the SOAP manually.', 6000);
  }finally{ S.generating = false; S.ctl = null; renderBuffer(); }
};

/* ---------- SOAP render / edit ---------- */
const SECTIONS = [['S','Subjective','s'],['O','Objective','o'],['A','Assessment','a'],['P','Plan','p']];
function renderResult(){
  const has = !!S.soap;
  $('empty').classList.toggle('hidden', has); $('result').classList.toggle('hidden', !has);
  if(!has) return;
  $('unclass').classList.toggle('hidden', !S.unclass);
  const names = SECTION_NAMES[S.soapLang] || SECTION_NAMES.en;
  $('cards').innerHTML = SECTIONS.map(([k,,c], i) => [k, names[i], c]).map(([k,name,c]) => `
    <article class="soapcard ${c}"><h3><span class="letter">${k}</span>${k} — ${name.toUpperCase()}</h3>
    ${S.editing ? `<textarea id="ed-${k}" aria-label="${name}">${esc(S.soap[k])}</textarea>` : `<div class="txt">${esc(S.soap[k]) || '<span class="muted">—</span>'}</div>`}</article>`).join('');
  $('edit-row').classList.toggle('hidden', S.editing); $('save-row').classList.toggle('hidden', !S.editing);
  const locked = !S.approved || S.editing;
  $('outbox').classList.toggle('hidden', S.editing);
  $('outbox').classList.toggle('locked', locked);
  $('out-hint').textContent = S.approved ? 'SOAP yang telah anda sahkan boleh disalin atau dieksport.' : 'Selesaikan Clinical Check dahulu untuk membuka salin dan eksport.';
}
$('b-edit').onclick = () => { S.editing = true; $('check').classList.add('hidden'); renderResult(); };
$('b-cancel').onclick = () => { S.editing = false; renderResult(); };
$('b-save').onclick = () => {
  const n = {}; SECTIONS.forEach(([k]) => n[k] = $('ed-'+k).value.trim());
  const changed = SECTIONS.some(([k]) => n[k] !== S.soap[k]);
  S.soap = n; S.editing = false; S.approved = false;
  if(changed) track('edited');
  renderResult(); runCheck(true);
};
function invalidateApproval(){ if(S.approved){ S.approved = false; renderResult(); } }

/* ---------- Clinical Check ---------- */
function words(t){ return new Set((t.toLowerCase().match(/[a-z]{4,}/g) || [])); }
function checkList(){
  const f = [], {S:s,O:o,A:a,P:p} = S.soap;
  if(!s) f.push('Subjective section is empty.');
  if(!o) f.push('Objective section is empty.');
  if(!a) f.push('Assessment section is empty.');
  if(!p) f.push('Plan section is empty.');
  if(!/\b\d+\s*[-–]?\s*(min|mins|minute|minutes|minit|hour|hours|jam)\b/i.test(o)) f.push('Duration not specified.');
  if(!/(assist|asst|independen|supervis|cue|prompt|bantuan|berdikari|seliaan|gesaan|isyarat|CGA|\bmin\.?\b|\bmod\.?\b|\bmax\.?\b|redirect)/i.test(o)) f.push('Assistance or prompting level not specified.');
  if(!/\d/.test(o)) f.push('Quantitative measurement not provided.');
  if(!/(respon|tolerat|engag|participat|able to|unable|completed|demonstrat|dapat|berjaya|melibatkan|menyiapkan|menunjukkan|bekerjasama)/i.test(o)) f.push('Intervention response not documented.');
  if(/\b(reported|stated|said|mother|father|teacher|caregiver|parent|mak|ibu|bapa|penjaga|cikgu|guru|melaporkan|dilaporkan)\b/i.test(o)) f.push('Therapist observation may not be clearly distinguished from caregiver report in O.');
  if(a && o){ const A = words(a), O = words(o); let i = 0; A.forEach(w => O.has(w) && i++); if(A.size > 6 && i / A.size > .6) f.push('Assessment may repeat the Objective section instead of interpreting it.'); }
  if(/\b(was|were|provided|performed|completed|demonstrated|observed)\b/i.test(p)) f.push('Plan may contain past intervention. Plan should list next actions only.');
  const all = [s,o,a,p].join(' ');
  if(/pain|sakit|hurt/i.test(all) && /\b\d{1,2}(\.\d)?\s*\/\s*10\b/.test(all) && !/(FLACC|FPS|faces|NRS|numeric|VAS|visual analog|wong)/i.test(all)) f.push('A pain score appears without a named validated assessment tool. Confirm the tool used, or remove the score.');
  const src = bufferText(); const srcNums = new Set(src.match(/\d+(?:\.\d+)?/g) || []);
  const draftNums = [...new Set((all.replace(/OTPF-4/gi,'').replace(/\bX\/10\b/g,'').match(/\d+(?:\.\d+)?/g) || []))].filter(n => !srcNums.has(n));
  if(draftNums.length) f.push('Number(s) ' + draftNums.slice(0,5).join(', ') + ' in the draft were not found as digits in your narrative. Confirm they were stated by you.');
  S.aiMissing.forEach(m => { if(m && !f.some(x => x.toLowerCase().slice(0,18) === m.toLowerCase().slice(0,18))) f.push(m); });
  return f;
}
function runCheck(scroll){
  if(!S.soap) return;
  const f = checkList();
  if(!S.checkCounted){ track('flags', f.length); S.checkCounted = true; }
  $('flags').innerHTML = f.length ? f.map(x => `<li>⚠ ${esc(x)}</li>`).join('') : '<li style="background:var(--ok-bg);color:var(--ink)">✓ No missing-information reminders found. Please still review carefully.</li>';
  document.querySelectorAll('.ck').forEach(c => c.checked = false); $('b-ack').disabled = true;
  $('check').classList.remove('hidden');
  if(scroll) $('check').scrollIntoView({behavior:'smooth', block:'start'});
}
$('b-check').onclick = () => { S.approved = false; S.checkCounted = true; runCheck(true); renderResult(); };
document.querySelectorAll('.ck').forEach(c => c.onchange = () => { $('b-ack').disabled = ![...document.querySelectorAll('.ck')].every(x => x.checked); });
$('b-ack').onclick = () => { S.approved = true; $('check').classList.add('hidden'); renderResult(); toast('Disahkan. Anda kini boleh salin atau eksport.'); $('outbox').scrollIntoView({behavior:'smooth', block:'center'}); };

/* ---------- rating reminder (after copy/export, rate-limited) ---------- */
function maybeAskRating(){
  if(!AN.data || S.askedLoad) return;
  if(((AN.data.t||{}).sessions || 0) < 3) return;
  const last = AN.data.askedOn;
  if(last && (Date.now() - new Date(last).getTime()) / 864e5 < 7) return;
  S.askedLoad = true; AN.data.askedOn = today(); schedSave();
  setTimeout(() => {
    if(!$('overlay').classList.contains('hidden')) return;
    let r = 0;
    openSheet(`<h2>Bagaimana pengalaman anda?</h2><p class="muted small">Sekejap sahaja. Ini membantu penambahbaikan VOTe. Jangan masukkan maklumat pesakit.</p>
      <div class="stars" id="rq-stars" role="group" aria-label="Penilaian 1 hingga 5">${[1,2,3,4,5].map(n => `<button data-r="${n}" aria-pressed="false" aria-label="${n} bintang">${n}</button>`).join('')}</div>
      <textarea class="field" id="rq-text" rows="2" style="margin:12px 0" placeholder="Komen (pilihan)" aria-label="Komen"></textarea>
      <div class="row"><button class="btn ghost" id="rq-later">Nanti</button><button class="btn primary" id="rq-send" disabled>Hantar</button></div>`);
    $('rq-stars').querySelectorAll('button').forEach(b => b.onclick = () => { r = +b.dataset.r; $('rq-stars').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', +x.dataset.r === r)); $('rq-send').disabled = false; });
    $('rq-later').onclick = closeSheet;
    $('rq-send').onclick = () => { AN.data.fb.push({t: today(), r, c: $('rq-text').value.trim().slice(0,500)}); AN.data.fb = AN.data.fb.slice(-20); schedSave(); closeSheet(); toast('Terima kasih atas maklum balas.'); };
  }, 900);
}

/* ---------- copy / export / share ---------- */
function soapText(){ return SECTIONS.map(([k]) => `${k}:\n${S.soap[k]}`).join('\n\n'); }
function needApproval(){ if(S.approved) return false; toast('Sila selesaikan Clinical Check dahulu.'); S.checkCounted = true; runCheck(true); return true; }
$('b-copy').onclick = async () => {
  if(!S.soap || needApproval()) return;
  const t = soapText();
  try{ await navigator.clipboard.writeText(t); }
  catch(_){ const ta = document.createElement('textarea'); ta.value = t; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(__){ toast('Salin gagal. Pilih teks dan salin secara manual.'); } ta.remove(); }
  track('copied'); trackDocTime(); toast('SOAP disalin.'); maybeAskRating();
};
function loadScript(src){ return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
const xe = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function buildDocx(){
  if(!window.JSZip) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  const para = (t, b) => `<w:p><w:r>${b ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xe(t)}</w:t></w:r></w:p>`;
  let body = para('SOAP Note', true);
  SECTIONS.forEach(([k]) => { body += para(k + ':', true); S.soap[k].split('\n').forEach(l => body += para(l, false)); body += para('', false); });
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>');
  return z.generateAsync({type:'arraybuffer'});
}
async function buildPdf(){
  if(!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const d = new window.jspdf.jsPDF({unit:'mm', format:'a4'}); const W = 170; let y = 20;
  const room = h => { if(y + h > 280){ d.addPage(); y = 20; } };
  d.setFont('helvetica','bold'); d.setFontSize(15); d.text('SOAP Note', 20, y); y += 10;
  SECTIONS.forEach(([k]) => {
    room(14); d.setFont('helvetica','bold'); d.setFontSize(12); d.text(k + ':', 20, y); y += 6;
    d.setFont('helvetica','normal'); d.setFontSize(11);
    d.splitTextToSize(S.soap[k] || '-', W).forEach(l => { room(6); d.text(l, 20, y); y += 5.6; }); y += 5;
  });
  return d.output('arraybuffer');
}
$('b-export').onclick = () => {
  if(!S.soap || needApproval()) return;
  openSheet(`<h2>📄 Export SOAP</h2><p class="muted small">Hanya SOAP yang telah anda sahkan dieksport.</p><div class="stack"><button class="btn" data-fmt="pdf">PDF</button><button class="btn" data-fmt="docx">Word (DOCX)</button><button class="btn" data-fmt="txt">TXT</button><button class="btn ghost" id="ex-x">Batal</button></div>`);
  $('ex-x').onclick = closeSheet;
  $('sheet').querySelectorAll('[data-fmt]').forEach(b => b.onclick = async () => {
    const fmt = b.dataset.fmt; b.disabled = true;
    try{
      const dl = await claude.use('downloads');
      const data = fmt === 'txt' ? soapText() : fmt === 'pdf' ? await buildPdf() : await buildDocx();
      const fname = 'VOTe-SOAP-' + today() + '.' + fmt;
      if(dl) await dl.save({filename: fname, data});
      else { const blob = data instanceof Blob ? data : new Blob([data]); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
      track('exported'); trackDocTime(); closeSheet(); toast('Fail dieksport.'); maybeAskRating();
    }catch(e){ closeSheet(); if(!e || e.code !== 'declined') toast('Eksport gagal. Cuba format lain atau gunakan COPY SOAP.', 6000); }
  });
};
$('b-share').onclick = openShare;

/* ---------- SOAP guide ---------- */
const GUIDE = [
  ['S','Subjective','s','--cs',["What did the client, caregiver or teacher report?","What is the main concern?","What changed since the previous session?","What is the client's functional goal?"]],
  ['O','Objective','o','--co',["What did you directly observe?","What activity/task was performed?","How long was the session/activity?","Where did it take place?","What assistance or prompting was required?","What intervention did you provide?","How did the client respond?"]],
  ['A','Assessment','a','--ca',["What do these findings mean for occupational performance?","What is the main functional problem?","What progress was observed?","What factors may be contributing?"]],
  ['P','Plan','p','--cp',["What will you do next session?","Is further assessment required?","Is caregiver education required?","Is a home programme required?"]]
];
const G = {step:0, ans:['','','',''], listening:false};
function renderGuide(){
  $('stepper').innerHTML = GUIDE.map((g,i) => `<div class="step ${i===G.step?'on':''}" style="--c:var(${g[3]})">${g[0]}</div>`).join('');
  const g = GUIDE[G.step];
  $('g-title').innerHTML = `<b>${g[0]} — ${g[1]}</b><div class="small muted">Rujukan: Panduan Dokumentasi (Format SOAP) TCK KKM 2023, ${GREF[G.step]}</div>`;
  $('g-qs').innerHTML = g[4].map(q => `<li>${esc(q)}</li>`).join('');
  $('g-text').value = G.ans[G.step];
  $('g-prev').disabled = G.step === 0;
  $('g-next').textContent = G.step === 3 ? 'Hantar ke sesi ✓' : 'Seterusnya ›';
  $('g-mic').textContent = G.listening ? '⏹ Berhenti' : '🎙️ Cakap';
}
function stopGuideMic(){ if(G.listening){ stopSpeech(); G.listening = false; $('g-interim').textContent=''; } }
document.querySelectorAll('[data-gm]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-gm]').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('g-quick').classList.toggle('hidden', b.dataset.gm !== 'quick'); $('g-guided').classList.toggle('hidden', b.dataset.gm !== 'guided');
  if(b.dataset.gm === 'guided') renderGuide(); else stopGuideMic();
});
$('g-text').addEventListener('input', e => G.ans[G.step] = e.target.value);
function guideMove(d){ stopGuideMic(); G.ans[G.step] = $('g-text').value; G.step += d; renderGuide(); }
$('g-prev').onclick = () => guideMove(-1);
$('g-next').onclick = () => {
  if(G.step < 3){ guideMove(1); return; }
  stopGuideMic(); G.ans[G.step] = $('g-text').value;
  const parts = GUIDE.map((g,i) => G.ans[i].trim() ? `[${g[0]}] ${G.ans[i].trim()}` : '').filter(Boolean);
  if(!parts.length){ toast('Tiada jawapan untuk dihantar.'); return; }
  S.segs.push(parts.join('\n')); markSession(); track('guided'); invalidateApproval();
  G.ans = ['','','','']; G.step = 0; go('session'); renderBuffer(); toast('Jawapan panduan ditambah ke sesi. Tekan JANA SOAP bila bersedia.', 5000);
};
$('g-mic').onclick = () => {
  if(G.listening){ stopGuideMic(); renderGuide(); return; }
  if(startSpeech({
    onFinal: x => { const ta = $('g-text'); ta.value = (ta.value ? ta.value + ' ' : '') + x; G.ans[G.step] = ta.value; $('g-interim').textContent=''; },
    onInterim: x => $('g-interim').textContent = x ? '… ' + x : '',
    onStop: () => { G.listening = false; renderGuide(); }
  }, speechLang())) { G.listening = true; renderGuide(); }
};
$('g-back').onclick = () => { stopGuideMic(); go('session'); };
$('g-go-quick').onclick = () => { go('session'); startRecording(); };
function openGuide(){ if(S.recording) pauseRecording(); go('guide'); }
$('b-guide').onclick = openGuide; $('h-guide').onclick = openGuide;
$('h-start').onclick = () => { go('session'); startRecording(); };
$('h-lib').onclick = () => go('library');

/* ---------- OT library ---------- */
const LIB = [
  ['term','🔵 OT Terminology','Explain an occupational therapy term clearly.',['Occupational performance','Sensory processing','Activity analysis','Graded activity']],
  ['reason','🧠 Clinical Reasoning','Explain the clinical reasoning concept and how a therapist might apply it.',['Occupational profile','Top-down approach','Contributing factors','Performance patterns']],
  ['tools','🩺 Assessment Tools','Describe the assessment tool: purpose, population, administration approach and limitations. Do NOT state scoring criteria, cut-offs or psychometric figures unless you are certain; otherwise direct the therapist to the official manual or publisher.',['Barthel Index','Canadian Occupational Performance Measure','Sensory Profile','Modified Barthel Index']],
  ['pain','🩹 Pain Assessment','Pain assessment options.',['Pain score sesuai umur berapa?','FLACC atau Faces?','Pain scale apa sesuai untuk kanak-kanak ini?']],
  ['interv','👐 Intervention Ideas','Present intervention ideas ONLY as options to consider, never as mandatory. Start with "Potential approaches to consider based on the information provided include...".',['Visual schedule','Graded prompting','Environmental modification','Sensory-based strategies']],
  ['ebp','📖 EBP & Research','Summarise the evidence base. Use the structure evidence, source, clinical relevance, considerations, therapist judgement.',['Sensory integration intervention','CO-OP approach','Parent-mediated intervention','Task-oriented training']],
  ['otpf','📘 OTPF-4 Reference','Explain the OTPF-4 concept (AOTA 2020, Occupational Therapy Practice Framework: Domain and Process, 4th ed.).',['Performance skills','Client factors','Activity demands','Contexts and environments']],
  ['doc','📝 Documentation Terms','Explain the documentation term in the context of KKM/Malaysian SOAP documentation.',['Level of assistance','Problem list','COAST goals','Prior level of function']],
  ['dsm','🧾 DSM-5-TR','Explain the DSM-5-TR diagnostic category or concept at overview level for OT practice. Do NOT reproduce DSM-5-TR diagnostic criteria text verbatim, and do not state criterion counts, durations or cut-offs unless you are certain; otherwise direct the therapist to the official manual. State that diagnosis is made by qualified medical or psychiatric professionals, and describe how the condition may affect occupational performance.',['Neurodevelopmental disorders','Depressive disorders','Trauma- and stressor-related disorders','Neurocognitive disorders']],
  ['psy','👨‍👩‍👧 Psychoeducation','Explain the topic in a way suitable for psychoeducation with clients and caregivers.',['Sensory regulation','Routine building','Executive function','Emotional regulation']]
];
const L = {sec: 'term', mode: 'auto'};
/* ---------- AI routing: Claude (automatic) or copy-paste (ChatGPT / Gemini) ---------- */
let pendingManual = null;
/* Pasted replies from ChatGPT / Gemini are often slightly broken JSON (code fences, "Copy code" labels,
   smart quotes, real line breaks inside strings, trailing commas), so try a few repairs before giving up. */
function escapeRawControls(s){
  let out = '', inStr = false, esc = false;
  for(const ch of s){
    if(inStr){
      if(esc){ esc = false; out += ch; continue; }
      if(ch === '\\'){ esc = true; out += ch; continue; }
      if(ch === '"'){ inStr = false; out += ch; continue; }
      if(ch === '\n'){ out += '\\n'; continue; }
      if(ch === '\r'){ continue; }
      if(ch === '\t'){ out += '\\t'; continue; }
      out += ch;
    }else{ if(ch === '"') inStr = true; out += ch; }
  }
  return out;
}
function cleanPaste(txt){
  let s = String(txt || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ').trim();
  const fence = s.match(/```[a-z]*\s*([\s\S]*?)```/i);
  if(fence && fence[1].includes('{')) s = fence[1].trim();
  return s;
}
function parseJsonReply(txt){
  const s = cleanPaste(txt);
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if(a < 0 || b <= a) throw new Error('no json');
  const raw = s.slice(a, b + 1);
  const fix = t => escapeRawControls(t).replace(/,\s*([}\]])/g, '$1');
  const tries = [raw, fix(raw), fix(raw.replace(/[\u201C\u201D\u201E\u2033]/g, '"'))];
  for(const t of tries){
    try{ const o = JSON.parse(t); if(o && typeof o === 'object' && !Array.isArray(o)) return o; }catch(_){}
  }
  throw new Error('bad');
}
/* SOAP replies: accept JSON (with S/O/A/P or Subjective/Objective/... keys) or plain text with S:/O:/A:/P: headings. */
const SOAP_KEYS = {s:'S', subjective:'S', subjektif:'S', o:'O', objective:'O', objektif:'O', a:'A', assessment:'A', penilaian:'A', analysis:'A', p:'P', plan:'P', pelan:'P', rancangan:'P'};
function soapFromJson(o){
  const r = {missing: [], unclassified: false};
  for(const [k, v] of Object.entries(o)){
    const key = SOAP_KEYS[k.trim().toLowerCase()];
    if(key) r[key] = Array.isArray(v) ? v.join('\n') : String(v ?? '');
    else if(/^missing$/i.test(k) && Array.isArray(v)) r.missing = v;
    else if(/^unclassified$/i.test(k)) r.unclassified = !!v;
  }
  return r;
}
function soapFromText(txt){
  /* Headings like "S:", "**S (Subjective)**", "1. Subjective", "S — SUBJECTIVE", "### Subjektif". */
  const head = /^[\s#>*_\-•]*(?:\d+[.)]\s*)?(subjective|subjektif|objective|objektif|assessment|analysis|penilaian|plan|pelan|rancangan|s|o|a|p)\b[\s*_]*(?:\([^)]*\))?[\s*_]*(?:[:–—-][\s*_]*(?:(?:subjective|subjektif|objective|objektif|assessment|analysis|penilaian|plan|pelan|rancangan)\b[\s*_]*:?)?|$)[\s*_]*(.*)$/i;
  const r = {}, missing = []; let cur = null;
  for(const line of cleanPaste(txt).split(/\r?\n/)){
    const m = line.match(head);
    if(m){ cur = SOAP_KEYS[m[1].toLowerCase()]; r[cur] = r[cur] || []; if(m[2].trim()) r[cur].push(m[2].trim()); continue; }
    if(/^[\s#*_]*(missing|maklumat (yang )?tiada)/i.test(line)){ cur = 'missing'; continue; }
    if(/^[\s#*_]*unclassified/i.test(line)) continue;
    if(!cur || !line.trim()) continue;
    if(cur === 'missing') missing.push(line.replace(/^[\s*\-•\d.]+/, '').trim());
    else r[cur].push(line.replace(/^\s*[*•]\s+/, '- ').trim());
  }
  const out = {missing: missing.filter(Boolean), unclassified: false};
  ['S','O','A','P'].forEach(k => { if(r[k]) out[k] = r[k].join('\n'); });
  return out;
}
function parseSoapReply(txt){
  const filled = r => ['S','O','A','P'].filter(k => r[k] && r[k].trim()).length;
  let r = null;
  try{ r = soapFromJson(parseJsonReply(txt)); }catch(_){}
  if(r && filled(r) >= 2) return r;
  const t = soapFromText(txt);
  if(filled(t) >= 2) return t;
  throw new Error('bad');
}
async function copyText(t){
  try{ await navigator.clipboard.writeText(t); return true; }
  catch(_){ const ta = document.createElement('textarea'); ta.value = t; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); let ok = false; try{ ok = document.execCommand('copy'); }catch(__){} ta.remove(); return ok; }
}
const MANUAL_SUFFIX = `

=== REPLY FORMAT: STRICT JSON ONLY (MANDATORY) ===
The reply is read by a computer program, not a person. It MUST be valid JSON or it cannot be used.
- Reply with ONE JSON object only, inside a single \`\`\`json code block.
- NO greeting, explanation, headings, bullet points or notes before or after the code block.
- Use straight double quotes ("), never smart quotes. No trailing commas. No comments.
- Inside strings, write line breaks as \\n. Do not put real line breaks inside a string.
- Do not change, translate or rename the JSON keys.`;
/* SOAP copy-paste: insist on JSON, but allow a fixed plain-text heading layout as a fallback the reader also accepts. */
const SOAP_MANUAL_SUFFIX = MANUAL_SUFFIX + `
- Example of the exact shape: \`\`\`json
{"S": "Mother reported ...", "O": "...", "A": "...", "P": "...", "missing": ["..."], "unclassified": false}
\`\`\`
ONLY if you are unable to produce JSON, reply instead in plain text using exactly these headings, each on its own line, and nothing else:
S:
O:
A:
P:
MISSING:`;
const PASTE_STEPS = `<ol class="plain">
  <li><b>Tekan 📋 Salin arahan</b> di bawah.</li>
  <li><b>Buka ChatGPT atau Gemini</b> (sebaiknya chat baharu), tampal arahan itu dan hantar.</li>
  <li><b>Tunggu jawapan siap sepenuhnya.</b> Jawapan biasanya dalam kotak kod yang bermula dengan <code>{</code> dan berakhir dengan <code>}</code>.</li>
  <li><b>Salin jawapan:</b> tekan ikon salin pada kotak kod (<i>Copy code</i> / 📋). Jika tiada ikon, salin keseluruhan jawapan; jangan salin sebahagian sahaja.</li>
  <li><b>Kembali ke VOTe,</b> tampal dalam kotak di bawah (atau tekan <b>📥 Tampal</b>), kemudian tekan <b>Papar jawapan</b>.</li>
</ol>
<div class="row"><a class="btn sm ghost" href="https://chatgpt.com/" target="_blank" rel="noopener">Buka ChatGPT ↗</a><a class="btn sm ghost" href="https://gemini.google.com/app" target="_blank" rel="noopener">Buka Gemini ↗</a></div>`;
async function pasteInto(id){
  try{ const t = await navigator.clipboard.readText(); if(t){ $(id).value = t; return; } }catch(_){}
  toast('Tekan lama dalam kotak jawapan dan pilih Tampal.', 5000); $(id).focus();
}
const PASTE_FAIL = 'Jawapan tidak dapat dibaca. Pastikan anda menyalin keseluruhan jawapan AI (dari { hingga }). Jika masih gagal, minta AI: "Reply again as ONE valid JSON object only, in a single json code block, with no other text."';
function manualJsonSheet(prompt, suffix = MANUAL_SUFFIX){
  return new Promise((res, rej) => {
    openSheet(`<h2>Salin-tampal ke ChatGPT / Gemini</h2>
      ${PASTE_STEPS}
      <div class="notice">Arahan ini mengandungi maklumat sesi anda dan anda sendiri menghantarnya ke perkhidmatan luar. Pastikan tiada nama, No. KP, MRN, alamat atau telefon pesakit, dan patuhi dasar organisasi.</div>
      <div class="stack">
        <button class="btn" id="ms-copy">📋 Salin arahan</button>
        <textarea class="field" id="ms-text" rows="6" placeholder="Tampal jawapan ChatGPT / Gemini di sini" aria-label="Jawapan AI"></textarea>
        <div class="row"><button class="btn primary" id="ms-go">Papar jawapan</button><button class="btn" id="ms-paste">📥 Tampal</button><button class="btn ghost" id="ms-x">Batal</button></div>
        <p class="small muted" style="margin:0"><b>Format JSON paling selamat.</b> Jika AI membalas dalam bentuk poin atau teks biasa, VOTe masih boleh membacanya asalkan ada tajuk S:, O:, A:, P: (atau Subjective / Objective / Assessment / Plan, Subjektif / Objektif / Penilaian / Pelan).</p>
      </div>`);
    const full = prompt + suffix;
    $('ms-copy').onclick = async () => { toast((await copyText(full)) ? 'Arahan disalin. Tampal ke ChatGPT atau Gemini.' : 'Salin gagal. Pilih teks dan salin manual.'); };
    $('ms-paste').onclick = () => pasteInto('ms-text');
    $('ms-go').onclick = () => {
      if(!$('ms-text').value.trim()){ toast('Kotak jawapan masih kosong. Tampal jawapan ChatGPT / Gemini dahulu.'); return; }
      try{ const o = parseSoapReply($('ms-text').value); closeSheet(); res(o); }catch(e){ toast(PASTE_FAIL, 9000); }
    };
    $('ms-x').onclick = () => { closeSheet(); rej({code:'cancelled'}); };
  });
}
function manualJson(prompt, opts){
  if(pendingManual) pendingManual({code:'cancelled'});
  if(opts.out) $(opts.out).innerHTML = '';
  return new Promise((res, rej) => {
    const panel = $('paste-panel'); panel.classList.remove('hidden');
    pendingManual = (err) => { panel.classList.add('hidden'); panel.innerHTML = ''; pendingManual = null; rej(err); };
    panel.innerHTML = `<h3>Mod salin-tampal</h3>
      ${PASTE_STEPS}
      <div class="notice">Anda sendiri menghantar arahan ini ke perkhidmatan luar. ${opts.caseInfo ? 'Arahan ini mengandungi maklumat sesi anda. ' : ''}Pastikan tiada nama, No. KP, MRN, alamat atau telefon pesakit, dan patuhi dasar organisasi.</div>
      <button class="btn" id="pm-copy">📋 Salin arahan</button>
      <textarea class="field" id="pm-text" rows="6" placeholder="Tampal jawapan ChatGPT / Gemini di sini" aria-label="Jawapan AI"></textarea>
      <div class="row"><button class="btn primary" id="pm-go">Papar jawapan</button><button class="btn" id="pm-paste">📥 Tampal</button><button class="btn ghost" id="pm-x">Batal</button></div>`;
    $('pm-copy').onclick = async () => { toast((await copyText(prompt)) ? 'Arahan disalin. Tampal ke ChatGPT atau Gemini.' : 'Salin gagal. Pilih teks dan salin manual.'); };
    $('pm-paste').onclick = () => pasteInto('pm-text');
    $('pm-go').onclick = () => {
      if(!$('pm-text').value.trim()){ toast('Kotak jawapan masih kosong. Tampal jawapan ChatGPT / Gemini dahulu.'); return; }
      try{ const o = parseJsonReply($('pm-text').value); panel.classList.add('hidden'); panel.innerHTML = ''; pendingManual = null; res(o); }
      catch(e){ toast(PASTE_FAIL, 9000); }
    };
    $('pm-x').onclick = () => pendingManual && pendingManual({code:'cancelled'});
    panel.scrollIntoView({behavior:'smooth', block:'start'});
  });
}
async function aiJson(prompt, opts = {}){
  const {out, caseInfo, ...rest} = opts;
  if(L.mode === 'auto'){
    const sample = await claude.use('sample');
    if(sample) return sample.json(prompt, rest);
    toast('Log masuk untuk penjanaan automatik. Beralih ke mod salin-tampal.', 5000);
    L.mode = 'manual'; renderLibMode();
  }
  return manualJson(prompt + MANUAL_SUFFIX, {out, caseInfo});
}
function renderLibMode(){ document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === L.mode)); }
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { L.mode = b.dataset.mode; renderLibMode(); if(pendingManual) pendingManual({code:'cancelled'}); });


function renderLibSections(){
  $('lib-sections').innerHTML = LIB.map(s => `<button class="chip" data-sec="${s[0]}" aria-pressed="${s[0]===L.sec}">${s[1]}</button>`).join('');
  $('lib-sections').querySelectorAll('button').forEach(b => b.onclick = () => { L.sec = b.dataset.sec; renderLibSections(); });
  const cur = LIB.find(s => s[0] === L.sec);
  $('lib-starters').innerHTML = cur[3].map(t => `<button class="chip" data-t="${esc(t)}">${esc(t)}</button>`).join('');
  $('lib-starters').querySelectorAll('button').forEach(b => b.onclick = () => { $('lib-q').value = b.dataset.t; libSearch(); });
  renderPain(); renderDocPanel(); renderDsmPanel(); if(L.sec !== 'pain') $('lib-out').innerHTML = '';
}
const LIB_RULES = `You are the OT Library of VOTe, a reference tool for Occupational Therapists in Malaysia. Respond about the user's term using the section instruction. Write for therapist readers in clear professional English, except "parent_friendly" which must be in simple Bahasa Melayu.
Rules: do not invent references, authors, years, statistics or study results. In "sources" list only well-established works you are certain exist (for example: AOTA 2020, Occupational Therapy Practice Framework: Domain and Process, 4th ed., AJOT 74(Suppl 2), 7412410010; Panduan Dokumentasi (Format SOAP) Perkhidmatan Terapi Cara Kerja KKM 2023). For the Documentation Terms section, base the answer on that KKM guide and list it first in "sources"). If you cannot cite a reliable source, return ["Rujukan perlu disahkan oleh terapis"]. For assessment tools do not state scoring criteria, cut-offs or psychometric values unless certain; point to the official manual/publisher instead. Intervention content must be framed as options to consider with therapist judgement, never "you must". Do not diagnose.
"label" is one of: "supported" (strong, widely accepted evidence), "consider" (limited or mixed evidence; use clinical judgement), "general" (general reference / not evidence-graded).
Return ONLY JSON, no fences:
{"title":string,"label":"supported"|"consider"|"general","clinical_definition":string,"simple":string,"ot_relevance":string,"example":string,"parent_friendly":string,"evidence":null|{"evidence":string,"clinical_relevance":string,"considerations":string,"therapist_judgement":string},"sources":string[]}
Set "evidence" only for evidence-related answers (always for the EBP section), otherwise null.`;
const LABELS = {supported:'🔵 Evidence-supported', consider:'🟡 Consider with clinical judgement', general:'⚪ General reference'};
async function libSearch(){
  const q = $('lib-q').value.trim(); if(!q){ toast('Taip istilah untuk dicari.'); return; }
  if(L.sec === 'pain') return painAsk(q);
  const sec = LIB.find(s => s[0] === L.sec);
  $('lib-out').innerHTML = '<div class="card">Sedang mencari…</div>'; $('lib-go').disabled = true; track('library');
  try{
    const r = await aiJson(LIB_RULES + '\n\nSECTION: ' + sec[1] + '\nSECTION INSTRUCTION: ' + sec[2] + '\nTERM / QUESTION: ' + q, {cache:true, out:'lib-out'});
    const ev = r.evidence; const srcs = (r.sources||[]).slice(); if(L.sec === 'doc' && !srcs.some(x => /Panduan Dokumentasi/i.test(x))) srcs.unshift(KKM_FULL); if(L.sec === 'dsm' && !srcs.some(x => /DSM-5-TR/i.test(x))) srcs.unshift(DSM_FULL);
    $('lib-out').innerHTML = `<div class="card"><h3>${esc(r.title || q)}</h3><div style="margin:8px 0"><span class="badge">${LABELS[r.label] || LABELS.general}</span></div>
      <div class="lib-block"><h4>Clinical definition</h4>${esc(r.clinical_definition)}</div>
      <div class="lib-block"><h4>Simple explanation</h4>${esc(r.simple)}</div>
      <div class="lib-block"><h4>OT relevance</h4>${esc(r.ot_relevance)}</div>
      <div class="lib-block"><h4>Example</h4>${esc(r.example)}</div>
      <div class="lib-block"><h4>Parent-friendly explanation</h4>${esc(r.parent_friendly)}</div>
      ${ev ? `<div class="lib-block"><h4>Evidence</h4>${esc(ev.evidence)}<h4 style="margin-top:8px">Clinical relevance</h4>${esc(ev.clinical_relevance)}<h4 style="margin-top:8px">Considerations</h4>${esc(ev.considerations)}<h4 style="margin-top:8px">Therapist judgement</h4>${esc(ev.therapist_judgement)}</div>` : ''}
      <div class="lib-block"><h4>Source / reference</h4><ul class="plain">${srcs.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="small muted" style="margin:6px 0 0">Sahkan rujukan sebelum digunakan.</p></div></div>`;
  }catch(e){ if(e && e.code === 'cancelled'){ $('lib-out').innerHTML = ''; return; } $('lib-out').innerHTML = `<div class="card">${e && e.code === 'not_granted' ? 'Sila log masuk semula untuk carian automatik.' : 'Unable to search right now. Please try again.'}</div>`; }
  finally{ $('lib-go').disabled = false; }
}
$('lib-go').onclick = libSearch;
$('lib-q').addEventListener('keydown', e => { if(e.key === 'Enter') libSearch(); });

/* ---------- DSM-5-TR guideline + quick reference ---------- */
const DSM_SHORT = 'American Psychiatric Association. (2022). Diagnostic and Statistical Manual of Mental Disorders (5th ed., text rev.; DSM-5-TR)';
const DSM_FULL = DSM_SHORT + '. American Psychiatric Association Publishing.';
function renderDsmPanel(){
  const box = $('dsm-panel');
  box.classList.toggle('hidden', L.sec !== 'dsm');
  if(L.sec !== 'dsm' || box.dataset.ready) return;
  box.dataset.ready = '1';
  const blk = (title, items) => `<details class="card"><summary>${title}</summary><ul class="plain" style="margin-top:8px">${items.map(i => `<li>${i}</li>`).join('')}</ul></details>`;
  box.innerHTML = `<div class="card stack"><h3>🧾 Rujukan pantas DSM-5-TR</h3>
    <p class="small muted" style="margin:0">Ringkasan struktur ${esc(DSM_SHORT)}. Ini panduan susun atur sahaja; kriteria diagnostik penuh ada dalam manual asal.</p></div>
    ${blk('Struktur manual', [
      'Seksyen I: Asas DSM-5-TR (pengenalan, penggunaan manual, pernyataan berhati-hati untuk penggunaan forensik).',
      'Seksyen II: Kriteria diagnostik dan kod, disusun mengikut bab diagnostik.',
      'Seksyen III: Langkah penilaian (assessment measures), formulasi budaya, model alternatif DSM-5 untuk gangguan personaliti, dan keadaan untuk kajian lanjut.'])}
    ${blk('Bab diagnostik (Seksyen II)', [
      'Neurodevelopmental Disorders',
      'Schizophrenia Spectrum and Other Psychotic Disorders',
      'Bipolar and Related Disorders',
      'Depressive Disorders',
      'Anxiety Disorders',
      'Obsessive-Compulsive and Related Disorders',
      'Trauma- and Stressor-Related Disorders',
      'Dissociative Disorders',
      'Somatic Symptom and Related Disorders',
      'Feeding and Eating Disorders',
      'Elimination Disorders',
      'Sleep-Wake Disorders',
      'Sexual Dysfunctions',
      'Gender Dysphoria',
      'Disruptive, Impulse-Control, and Conduct Disorders',
      'Substance-Related and Addictive Disorders',
      'Neurocognitive Disorders',
      'Personality Disorders',
      'Paraphilic Disorders',
      'Other Mental Disorders and Additional Codes',
      'Selepas bab-bab ini: Medication-Induced Movement Disorders and Other Adverse Effects of Medication; Other Conditions That May Be a Focus of Clinical Attention.'])}
    ${blk('Panduan penggunaan untuk Pegawai Terapi Cara Kerja', [
      'Diagnosis ditetapkan oleh pakar perubatan atau psikiatri yang berkelayakan. OT merujuk DSM-5-TR untuk memahami konteks diagnosis, bukan untuk mendiagnosis.',
      'Dalam dokumentasi SOAP, catat diagnosis seperti yang dinyatakan oleh pasukan perubatan, kemudian fokus pada kesan terhadap occupational performance, contributing factors dan matlamat.',
      'Gunakan istilah DSM-5-TR dengan tepat dan sahkan dengan manual asal sebelum memetik kriteria, specifier atau kod.',
      'Sahkan sistem kod yang digunakan di fasiliti anda (ICD-10 atau ICD-10-CM) kerana kod dalam DSM-5-TR dipadankan dengan ICD-10-CM.'])}
    <div class="card"><h4 style="margin:0 0 4px;font-family:var(--font-head);color:var(--teal)">Sumber</h4><p class="small" style="margin:0">${esc(DSM_FULL)} Hak cipta manual kekal pada APA. VOTe tidak menyalin teks kriteria diagnostik dan tidak menyertakan fail PDF manual; rujuk salinan sah anda sendiri.</p></div>`;
}

/* ---------- KKM SOAP guide source + quick reference ---------- */
const KKM_SHORT = 'Panduan Dokumentasi (Format SOAP) Perkhidmatan Terapi Cara Kerja, Kementerian Kesihatan Malaysia, Edisi Pertama 2023';
const KKM_FULL = KKM_SHORT + '. Jawatankuasa Teknikal Perkhidmatan Terapi Cara Kerja, KKM.';
const GREF = ['Bahagian 5 (S), m/s 3-4','Bahagian 6 (O), m/s 5-9','Bahagian 7 (A), m/s 10-15','Bahagian 8 (P), m/s 16-17'];
function renderDocPanel(){
  const box = $('doc-panel');
  box.classList.toggle('hidden', L.sec !== 'doc');
  if(L.sec !== 'doc' || box.dataset.ready) return;
  box.dataset.ready = '1';
  const blk = (title, items) => `<details class="card"><summary>${title}</summary><ul class="plain" style="margin-top:8px">${items.map(i => `<li>${i}</li>`).join('')}</ul></details>`;
  box.innerHTML = `<div class="card stack"><h3>📝 Rujukan pantas format SOAP KKM</h3>
    <p class="small muted" style="margin:0">Ringkasan berdasarkan ${esc(KKM_SHORT)}. Rujuk panduan asal untuk teks penuh dan contoh.</p></div>
    ${blk('S: Subjective (m/s 3-4)', [
      'Maklumat daripada klien atau pihak berkaitan (ahli keluarga, penjaga) jika klien tidak dapat memberi maklumat.',
      'Boleh merangkumi: complaints/concerns, history, prior level of function (PLOF), current level of function (CLOF), lifestyle/situation, emotions/attitudes, goals, response to treatment, other information.',
      'Maklumat perlu berkaitan kefungsian dalam occupation. Klien boleh digelar pt., client, student atau nama sendiri.'])}
    ${blk('O: Objective (m/s 5-9)', [
      'Tiga bahagian: (1) durasi, lokasi dan tujuan terapi, (2) penilaian yang dilakukan, (3) rawatan yang diberikan.',
      'Contoh bentuk (1): "Client participated in __-minute OT session in __ for __." Bahagian ini tidak wajib.',
      'Data penilaian perlu boleh diperhatikan, diukur dan diulang. Boleh versi penuh, ringkas atau jadual; boleh rujuk lampiran borang penilaian.',
      'Rawatan: catat intervensi atau modaliti, bagaimana klien melaksanakan tugasan, dan tindak balas klien.',
      'Nyatakan instrumen atau borang yang digunakan. Guna istilah dan singkatan standard.'])}
    ${blk('A: Assessment (m/s 10-15)', [
      'Empat bahagian: senarai masalah (problem list), long term goals (LTG), short term goals (STG), analisa.',
      'Problem list dengan assist level: "Client requires [assist level] in [occupational task] due to [contributing factor]." Tanpa assist level: "Client unable to / have difficulty to [task] due to [factor]."',
      'LTG dan STG boleh ditulis dengan kaedah COAST: Client, Occupation, Assist level, Specific conditions, Timeline. Kaedah lain (SMART, GAS dan lain-lain) juga dibenarkan.',
      'Problem list dan sasaran tidak perlu ditulis setiap kali; ditulis ketika penilaian awal dan penilaian semula.',
      'Analisa boleh merangkumi: Problem, Progress, Potential, Other information.'])}
    ${blk('P: Plan (m/s 16-17)', [
      'Perkara utama: purpose of continued therapy and/or specific intervention, frequency, duration.',
      'Perkara lain: further evaluation/reevaluation, client and caregiver education and training, prescribing/fabricating equipment, referral to other professionals/agencies.',
      'Plan merujuk kepada intervensi sesi seterusnya, bukan yang telah diberikan. Boleh tulis "continue current plan" jika pelan asal masih berjalan.'])}
    ${blk('Tips tambahan (m/s 18)', [
      'Biasakan istilah daripada OTPF, ICF dan model atau frame of reference yang relevan.',
      'Guna level of assistance untuk menyatakan tahap kefungsian, serta singkatan dan simbol yang sesuai.'])}
    <div class="card"><h4 style="margin:0 0 4px;font-family:var(--font-head);color:var(--teal)">Sumber</h4><p class="small" style="margin:0">${esc(KKM_FULL)} Hak cipta panduan kekal pada KKM. VOTe merujuk struktur panduan dan tidak menyalin teks penuhnya.</p></div>`;
}

/* ---------- pain assessment library ---------- */
const PAIN_TOOLS = {
  flacc: {
    name: 'FLACC (Face, Legs, Activity, Cry, Consolability)',
    kind: 'Observational (behavioural)',
    rows: [
      ['Purpose','To score pain-related behaviour when a reliable self-report of pain intensity cannot be obtained.'],
      ['Population','Developed for postoperative pain in young children (Merkel et al., 1997). Also used with children who cannot self-report, including some with cognitive or communication limitations. A revised version (r-FLACC) has been described for children with cognitive impairment; verify the source before use.'],
      ['Developmental considerations','Suitability depends on whether the child can reliably self-report, not on age alone. Behavioural responses vary with developmental level, temperament and context.'],
      ['Administration','Therapist observes and scores. Awake: observe for 1 to 5 minutes or longer with legs and body uncovered; reposition the child or observe activity. Asleep: observe for 5 minutes or longer. Use the official form for full instructions.'],
      ['Scoring','Five categories (Face, Legs, Activity, Cry, Consolability), each scored 0, 1 or 2. Total 0 to 10. Descriptors are shown in the table below.'],
      ['Interpretation','Higher score = more pain-related behaviour. Commonly cited bands: 0 relaxed and comfortable; 1 to 3 mild discomfort; 4 to 6 moderate pain; 7 to 10 severe discomfort or pain. Follow your organisation\'s policy for action thresholds.'],
      ['Strengths','Short, five items, usable when the child cannot report pain. Widely used and studied.'],
      ['Limitations','Scores behaviour, not the child\'s own experience. Behaviours may also reflect fear, distress, hunger or other causes. A score is not a diagnosis and should be interpreted with the clinical context.'],
      ['Clinical considerations','Score only what is observed during a defined observation period. Do not retrospectively assign a score from a general description of behaviour.'],
      ['Authoritative source','FLACC developed by Merkel, Voepel-Lewis and Malviya at C.S. Mott Children\'s Hospital, University of Michigan. Use the official form.'],
      ['Original reference','Merkel SI, Voepel-Lewis T, Shayevitz JR, Malviya S. The FLACC: a behavioral scale for scoring postoperative pain in young children. Pediatric Nursing. 1997;23(3):293-297.'],
      ['Source link','No single link is guaranteed to stay valid. Obtain the form from the University of Michigan or your hospital\'s approved pain assessment forms.']
    ]
  },
  fpsr: {
    name: 'Faces Pain Scale – Revised (FPS-R)',
    kind: 'Self-report',
    rows: [
      ['Purpose','To let a child report how much pain they feel, using a series of faces scored on a 0 to 10 metric.'],
      ['Population','Children who can understand the task and report pain intensity. Developed from the original Faces Pain Scale (Bieri et al., 1990). Check the IASP guidance for the age range supported; age is not a cut-off.'],
      ['Developmental considerations','Needs enough understanding of the instructions and of "more pain" along a line of faces. Reliability depends on the child\'s understanding and cooperation, so check understanding rather than relying on age.'],
      ['Administration','Show the faces and give the standard instruction from the official form. Say "hurt" or "pain", whichever suits the child. Ask the child to point to the face that shows how much they hurt. Do not use words such as "happy" or "sad": the scale measures how the child feels inside, not how the face looks.'],
      ['Scoring','Six faces scored 0, 2, 4, 6, 8, 10 from left to right. 0 = no pain; 10 = the most pain / very much pain, per the official wording.'],
      ['Interpretation','Higher score = more pain reported. Use for intensity and change over time. Action thresholds follow local policy.'],
      ['Strengths','Self-report is preferred when feasible. Simple to use. Scored on a 0 to 10 metric comparable with other 0 to 10 scales.'],
      ['Limitations','Not suitable if the child cannot understand or respond reliably. The score reflects the child\'s report at that moment and may be affected by anxiety, wish to please, or misunderstanding.'],
      ['Clinical considerations','Do not interpret the child\'s own facial expression as an emotion or as a pain score. Record the face the child chooses and the score.'],
      ['Authoritative source','International Association for the Study of Pain (IASP). Copyright is held by IASP (2001). The faces image is not reproduced here. Use the official IASP form, which may be photocopied for non-commercial clinical, educational and research use under IASP terms.'],
      ['Original reference','Hicks CL, von Baeyer CL, Spafford PA, van Korlaar I, Goodenough B. The Faces Pain Scale – Revised: toward a common metric in pediatric pain measurement. Pain. 2001;93(2):173-183. Derived from Bieri D, et al. Pain. 1990;41:139-150.'],
      ['Source link','iasp-pain.org/FPS-R (verify the current page and permitted use).']
    ]
  }
};
const FLACC_TABLE = [
  ['Face','No particular expression or smile','Occasional grimace or frown, withdrawn, disinterested','Frequent to constant frown, clenched jaw, quivering chin'],
  ['Legs','Normal position or relaxed','Uneasy, restless, tense','Kicking or legs drawn up'],
  ['Activity','Lying quietly, normal position, moves easily','Squirming, shifting back and forth, tense','Arched, rigid, or jerking'],
  ['Cry','No cry (awake or asleep)','Moans or whimpers, occasional complaint','Crying steadily, screams or sobs, frequent complaints'],
  ['Consolability','Content, relaxed','Reassured by occasional touching, hugging, or being talked to, distractible','Difficult to console or comfort']
];
function toolCard(k){
  const t = PAIN_TOOLS[k];
  const table = k === 'flacc' ? `<div class="lib-block"><h4>Scoring descriptors (each 0 / 1 / 2)</h4><div style="overflow-x:auto"><table class="tbl"><thead><tr><th></th><th>0</th><th>1</th><th>2</th></tr></thead><tbody>${FLACC_TABLE.map(r => `<tr>${r.map((c,i) => i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted" style="margin:6px 0 0">Descriptors as published in Merkel et al. (1997) and standard clinical forms. Always check against the official form. VOTe does not modify them.</p></div>` : '';
  return `<details class="card"><summary>${esc(t.name)} <span class="badge">${esc(t.kind)}</span></summary>${t.rows.map(r => `<div class="lib-block"><h4>${esc(r[0])}</h4>${esc(r[1])}</div>`).join('')}${table}</details>`;
}
function renderPain(){
  const box = $('pain-panel');
  box.classList.toggle('hidden', L.sec !== 'pain');
  if(L.sec !== 'pain' || box.dataset.ready) return;
  box.dataset.ready = '1';
  box.innerHTML = `<div class="card stack"><h3>🩹 Pain assessment decision support</h3>
    <div class="notice">Age alone does not decide the pain scale. VOTe suggests options to consider; the therapist chooses the final tool.</div>
    <label>Age (optional, context only)<input class="field" id="pn-age" type="text" inputmode="numeric" placeholder="cth. 5 tahun"></label>
    <label>Communication<select class="field" id="pn-comm"><option value="verbal">Verbal</option><option value="limited">Limited verbal</option><option value="nonverbal">Non-verbal</option></select></label>
    <label>Understands simple instructions<select class="field" id="pn-und"><option value="unsure">Unsure</option><option value="yes">Yes</option><option value="partly">Partly</option><option value="no">No</option></select></label>
    <label>Able to reliably report pain intensity<select class="field" id="pn-self"><option value="unsure">Unsure</option><option value="yes">Yes</option><option value="no">No</option></select></label>
    <label>Developmental / cognitive notes and clinical context (optional)<input class="field" id="pn-ctx" type="text" placeholder="cth. selepas pembedahan, sesi ADL"></label>
    <button class="btn primary" id="pn-go">Cadangkan pilihan</button>
    <div id="pn-out"></div></div>
    ${toolCard('flacc')}${toolCard('fpsr')}
    <div class="card stack"><h3>Pain documentation safety</h3>
    <p style="margin:0">Never infer a pain score from crying, facial expression, guarding, movement, aggression, withdrawal or behaviour unless a validated pain assessment was actually performed.</p>
    <ul class="plain small">
      <li>Behaviour only: "Client demonstrated crying during dressing; pain intensity was not formally assessed/reported."</li>
      <li>FLACC performed: "Pain was assessed using the FLACC scale, with a total score of X/10."</li>
      <li>FPS-R performed: "Client self-reported pain intensity using the FPS-R, scoring X/10."</li>
    </ul></div>`;
  $('pn-go').onclick = painDecide;
}
function painDecide(){
  track('pain');
  const comm = $('pn-comm').value, und = $('pn-und').value, self = $('pn-self').value, age = $('pn-age').value.trim(), ctx = $('pn-ctx').value.trim();
  let head, why = [];
  if(self === 'yes' && und === 'yes' && comm !== 'nonverbal'){
    head = 'Consider a validated self-report measure such as FPS-R, subject to developmental and clinical suitability.';
    why.push('The child appears able to understand the task and report pain intensity reliably.');
    why.push('Confirm understanding with a simple check before using the scale.');
  } else if(self === 'no' || und === 'no' || comm === 'nonverbal'){
    head = 'Consider an observational pain assessment such as FLACC, subject to clinical suitability.';
    why.push('Reliable self-report may be difficult for this child.');
    why.push('An observational score reflects behaviour and may also reflect distress, fear or other causes.');
  } else {
    head = 'Either approach may be worth considering. Reliable self-report is not yet clear.';
    why.push('Try a brief understanding check for self-report (for example FPS-R). If the child cannot respond reliably, consider an observational option such as FLACC.');
    why.push('Further information about understanding and communication would help the choice.');
  }
  if(age) why.push('Age noted (' + age + ') as context only. It is not used as a cut-off.');
  if(ctx) why.push('Context noted: ' + ctx + '. Check the tool is suitable for this population and setting.');
  $('pn-out').innerHTML = `<div class="card" style="background:var(--surface2)"><h3 style="margin-bottom:6px">🩹 PAIN ASSESSMENT</h3><p><b>${esc(head)}</b></p><ul class="plain">${why.map(w => `<li>${esc(w)}</li>`).join('')}</ul><p class="small muted" style="margin:8px 0 0">Final tool selection remains the therapist's responsibility. See the tool details below for administration and scoring.</p></div>`;
}
const PAIN_RULES = `You support an Occupational Therapist choosing a paediatric pain assessment approach. Answer the therapist's question in the language they used (Bahasa Melayu or English).
Rules: Age alone must NOT determine the tool; never give simplistic rules such as "under X years use FLACC". Consider age, development, communication, cognitive ability, ability to self-report and clinical context. Phrase everything as options to consider, subject to clinical suitability; the therapist decides. FLACC is an observational option, FPS-R (Faces Pain Scale – Revised) is a self-report option. Do not state scoring criteria, cut-offs or psychometric figures (the app shows the validated descriptors separately). Never infer a pain score from behaviour. Do not diagnose. Do not invent references.
Return ONLY JSON, no fences: {"answer":string,"recommendation":"flacc"|"fpsr"|"both"|"unclear","reasoning":string[],"things_to_check":string[]}`;
async function painAsk(q){
  $('lib-out').innerHTML = '<div class="card">Sedang menimbang pilihan…</div>'; $('lib-go').disabled = true; track('pain'); track('library');
  try{
    const r = await aiJson(PAIN_RULES + '\n\nQUESTION:\n' + q, {cache:false, out:'lib-out'});
    const tag = {flacc:'Observational option: FLACC', fpsr:'Self-report option: FPS-R', both:'Both may be considered', unclear:'More information needed'}[r.recommendation] || 'More information needed';
    $('lib-out').innerHTML = `<div class="card"><h3>🩹 PAIN ASSESSMENT</h3><div style="margin:8px 0"><span class="badge">${esc(tag)}</span></div><p>${esc(r.answer)}</p>
      ${(r.reasoning||[]).length ? `<div class="lib-block"><h4>Reasoning</h4><ul class="plain">${r.reasoning.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${(r.things_to_check||[]).length ? `<div class="lib-block"><h4>Things to check</h4><ul class="plain">${r.things_to_check.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      <p class="small muted" style="margin:8px 0 0">Potential options to consider only. The therapist remains responsible for final tool selection.</p></div>`;
  }catch(e){ if(e && e.code === 'cancelled'){ $('lib-out').innerHTML = ''; return; } $('lib-out').innerHTML = '<div class="card">Unable to answer right now. Please use the form below.</div>'; }
  finally{ $('lib-go').disabled = false; }
}

const EXPLORE_RULES = `You support an Occupational Therapist's clinical reasoning. Based ONLY on the case information below, suggest ideas to think about. You do not diagnose and do not prescribe: every item is an option for the therapist to consider. Do not invent facts, scores or references. Use OTPF-4 terms only where relevant. Do not reproduce personal identifiers.
Return ONLY JSON, no fences, all items short English strings:
{"occupations":string[],"performance_difficulties":string[],"otpf_domains":string[],"assessment_areas":string[],"pain_assessment_options":string[],"intervention_options":string[],"caregiver_education":string[],"evidence_notes":string[]}
For pain_assessment_options: only if pain is relevant to the case; phrase as \"Potential options to consider...\"; age alone must not decide the tool; never infer a pain score from behaviour; do not state scoring criteria; otherwise return []. Start intervention_options items with wording such as "Consider..." or "Potential approach: ...". In evidence_notes mention only general, well-established evidence areas and state that references must be verified; if unsure return [].`;
$('lib-explore').onclick = async () => {
  const info = S.soap ? soapText() : bufferText();
  if(!info){ toast('Tiada maklumat sesi. Bercerita dahulu di Session.', 5000); return; }
  $('explore-out').innerHTML = '<div class="card">Sedang meneroka kes…</div>'; $('lib-explore').disabled = true; track('explore'); track('library');
  try{
    const r = await aiJson(EXPLORE_RULES + '\n\nCASE INFORMATION:\n"""\n' + info + '\n"""', {cache:false, out:'explore-out', caseInfo:true});
    const blk = (t, a) => a && a.length ? `<div class="lib-block"><h4>${t}</h4><ul class="plain">${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    $('explore-out').innerHTML = `<div class="card">${blk('Relevant occupations',r.occupations)}${blk('Possible performance difficulties',r.performance_difficulties)}${blk('Relevant OTPF-4 domains',r.otpf_domains)}${blk('Possible assessment areas',r.assessment_areas)}${blk('Pain assessment options to consider',r.pain_assessment_options)}${blk('Intervention options to consider',r.intervention_options)}${blk('Caregiver education ideas',r.caregiver_education)}${blk('Relevant evidence (verify references)',r.evidence_notes)}<p class="small muted" style="margin:10px 0 0">VOTe can help the therapist think, but cannot replace clinical judgement.</p></div>`;
  }catch(e){ if(e && e.code === 'cancelled'){ $('explore-out').innerHTML = ''; return; } $('explore-out').innerHTML = '<div class="card">Unable to explore the case right now. Please try again.</div>'; }
  finally{ $('lib-explore').disabled = false; }
};

/* ---------- settings ---------- */
document.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => {
  const v = b.dataset.theme; document.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', x === b));
  if(v === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v);
});
let rating = 0;
$('stars').innerHTML = [1,2,3,4,5].map(n => `<button data-r="${n}" aria-pressed="false" aria-label="${n} bintang">${n}</button>`).join('');
$('stars').querySelectorAll('button').forEach(b => b.onclick = () => { rating = +b.dataset.r; $('stars').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', +x.dataset.r === rating)); });
$('fb-send').onclick = () => {
  if(!rating){ toast('Pilih penilaian 1 hingga 5 dahulu.'); return; }
  if(!AN.data){ toast('Log masuk (Sign Up / Log In di Home) untuk menghantar maklum balas.', 5000); return; }
  AN.data.fb.push({t: today(), r: rating, c: $('fb-text').value.trim().slice(0, 500)}); AN.data.fb = AN.data.fb.slice(-20); AN.data.askedOn = today(); schedSave();
  $('fb-text').value = ''; rating = 0; $('stars').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed','false')); toast('Terima kasih atas maklum balas.');
};

/* ---------- admin dashboard (owner only) ---------- */
async function refreshAdmin(){
  $('admin').classList.toggle('hidden', !AN.isOwner);
  if(!AN.isOwner || !AN.db) return;
  $('ad-out').innerHTML = '<div class="muted">Memuat…</div>';
  try{
    const snap = await AN.db.collection('usage').get(); const all = snap.docs.map(d => d.data());
    const tot = k => all.reduce((s,u) => s + ((u.t||{})[k]||0), 0);
    const cut = new Date(Date.now() - 7*864e5).toISOString().slice(0,10);
    const active = all.filter(u => (u.last||'') >= cut).length;
    const returning = all.filter(u => Object.keys(u.d||{}).filter(k => Object.keys(u.d[k]||{}).length).length >= 2).length;
    const docMs = all.reduce((s,u) => s + (u.docMs||0), 0), docN = all.reduce((s,u) => s + (u.docN||0), 0);
    const fbs = all.flatMap(u => u.fb || []);
    const avg = fbs.length ? fbs.reduce((s,f) => s + f.r, 0) / fbs.length : null;
    const gen = tot('soap');
    const tiles = [
      [all.length,'Pilot users'],[active,'Active (7 days)'],[returning,'Returning (2+ days)'],[tot('sessions'),'Documentation sessions'],
      [gen,'SOAP generated'],[tot('edited'),'SOAP edited'],[tot('copied'),'SOAP copied'],[tot('exported'),'SOAP exported'],
      [tot('library'),'OT Library uses'],[tot('guided'),'Guided SOAP uses'],[tot('pain'),'Pain Assessment uses'],[tot('newclient'),'New Client uses'],
      [tot('share'),'Share link VOTe (kali)'],[all.filter(u => ((u.t||{}).share||0) > 0).length,'Pengguna yang berkongsi'],
      [docN ? (docMs/docN/60000).toFixed(1) + ' min' : '—','Avg documentation time'],
      [avg ? avg.toFixed(1) + '/5' : '—','Usability rating (' + fbs.length + ')'],
      [gen ? Math.round(tot('edited')/gen*100) + '%' : '—','Edit rate (not accuracy)'],
      [gen ? (tot('flags')/gen).toFixed(1) : '—','Avg missing-info flags']
    ];
    const days = {}; all.forEach(u => Object.entries(u.d||{}).forEach(([k,v]) => days[k] = (days[k]||0) + (v.soap||0)));
    const keys = []; for(let i = 13; i >= 0; i--) keys.push(new Date(Date.now() - i*864e5).toISOString().slice(0,10));
    const vals = keys.map(k => days[k]||0), mx = Math.max(1, ...vals);
    const bars = vals.map((v,i) => `<rect x="${i*22+4}" y="${70 - v/mx*62}" width="16" height="${v/mx*62}" rx="3" fill="var(--teal)"><title>${keys[i]}: ${v}</title></rect>`).join('');
    $('ad-out').innerHTML = `<div class="tiles">${tiles.map(t => `<div class="tile"><b>${t[0]}</b><span>${t[1]}</span></div>`).join('')}</div>
      <div><b>SOAP generated, last 14 days</b><svg viewBox="0 0 312 78" width="100%" role="img" aria-label="Trend SOAP dijana 14 hari">${bars}</svg></div>
      <div><b>Feedback</b>${fbs.length ? `<ul class="plain">${fbs.slice(-12).reverse().map(f => `<li>${f.r}/5 ${esc(f.c||'')} <span class="muted small">${esc(f.t)}</span></li>`).join('')}</ul>` : '<p class="muted">Belum ada maklum balas.</p>'}</div>
      <p class="small muted">Edit rate bukan ukuran ketepatan klinikal. Ketepatan perlu dinilai berasingan melalui semakan terapis.</p>`;
  }catch(e){ $('ad-out').innerHTML = '<div class="muted">Data tidak dapat dimuatkan.</div>'; }
}
$('ad-load').onclick = refreshAdmin;

/* ---------- disclaimer gate ---------- */
function showDisclaimer(first){
  openSheet(`<h2>PENAFIAN / DISCLAIMER</h2>
  <p>VOTe ialah alat bantuan dokumentasi yang menggunakan AI untuk membantu menstrukturkan maklumat klinikal kepada format SOAP berdasarkan input terapis.</p>
  <p>VOTe bukan pengganti penilaian, clinical reasoning atau professional judgement Occupational Therapist.</p>
  <p>Semua kandungan yang dijana hendaklah disemak, disahkan dan diperbetulkan oleh terapis sebelum dimasukkan ke dalam rekod klinikal rasmi.</p>
  <p>VOTe tidak sepatutnya mereka-reka diagnosis, pemerhatian, ukuran, tahap bantuan, tempoh, skor atau maklumat klinikal yang tidak diberikan.</p>
  <p><b>Privasi:</b> Jangan masukkan maklumat pengenalan pesakit yang tidak diperlukan.</p>
  <p><b>Mod automatik:</b> Bagi pengguna yang log masuk, teks sesi dihantar melalui Netlify AI Gateway kepada model Claude (Anthropic) untuk menjana draf. VOTe tidak menyimpan teks tersebut.</p>
  <p>Pengguna bertanggungjawab memastikan penggunaan VOTe mematuhi polisi organisasi, keselamatan maklumat dan keperluan kerahsiaan yang berkaitan.</p>
  <p>Dengan menggunakan VOTe, pengguna memahami bahawa output AI adalah draft dokumentasi dan tanggungjawab klinikal akhir kekal pada terapis.</p>
  <p class="small muted">Analitik pilot: hanya jika anda log masuk, kiraan penggunaan tanpa nama direkodkan. Mod tetamu tidak direkodkan. Tiada data pesakit atau kandungan SOAP direkodkan.</p>
  ${first ? '<label class="checks" style="display:flex;gap:12px;align-items:flex-start;margin:10px 0"><input type="checkbox" id="dc-ck" style="width:24px;height:24px;flex:none;accent-color:var(--teal)"><span>Saya faham dan bersetuju.</span></label><button class="btn primary block" id="dc-ok" disabled>Teruskan</button>' : '<button class="btn primary block" id="dc-ok">Tutup</button>'}`);
  if(first){ $('dc-ck').onchange = e => $('dc-ok').disabled = !e.target.checked; }
  $('dc-ok').onclick = () => { if(first){ try{ localStorage.setItem('vote_ack', '1'); }catch(_){} } closeSheet(); };
}
$('s-disclaimer').onclick = () => showDisclaimer(false);

/* ---------- init ---------- */
renderBuffer(); renderResult(); renderLibSections(); renderGuide();
L.mode = 'manual'; renderLibMode();
go('home');
auth.handleAuthCallback().then(r => {
  if(!r) return;
  if(r.type === 'recovery') showNewPassword();
  else if(r.type === 'confirmation') toast('E-mel disahkan. Anda telah log masuk; tekan Sign Up / Log In untuk mula.', 6000);
  else if(r.type === 'invite' && r.token) showNewPassword(r.token);
}).catch(() => {}).finally(syncLogout);
