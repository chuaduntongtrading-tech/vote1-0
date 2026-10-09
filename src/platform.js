// Netlify platform adapter. VOTe was designed around a small `use(capability)` API
// ('user', 'db', 'sample', 'downloads'); this module implements it with Netlify Identity,
// the /api/usage + /api/admin/usage functions (Netlify Database) and /api/ai (AI Gateway).
import { getUser, login, signup, logout, requestPasswordRecovery, updateUser, acceptInvite, handleAuthCallback, AuthError, MissingIdentityError } from '@netlify/identity';

const err = (code) => Object.assign(new Error(code), { code });

async function api(path, opts = {}){
  const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if(r.status === 401) throw err('not_granted');
  if(r.status === 429) throw err('rate_limited');
  if(!r.ok) throw err('failed');
  return r.json();
}

const user = {
  async id(){ const u = await getUser(); return u ? u.id : null; },
  async isOwner(){ const u = await getUser(); return !!u && (u.roles || []).includes('admin'); },
  async email(){ const u = await getUser(); return u ? u.email : null; }
};

// Firestore-like surface used by the original app: doc('usage/<uid>').get()/set(), collection('usage').get()
const db = {
  doc(){
    return {
      async get(){ const r = await api('/api/usage'); return { exists: r.exists, data: () => r.data }; },
      async set(data){ await api('/api/usage', { method: 'PUT', body: JSON.stringify(data) }); }
    };
  },
  collection(){
    return { async get(){ const rows = await api('/api/admin/usage'); return { docs: rows.map(d => ({ data: () => d })) }; } };
  }
};

function parseJsonReply(txt){
  let s = String(txt || '').trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if(a < 0 || b <= a) throw err('failed');
  const o = JSON.parse(s.slice(a, b + 1));
  if(!o || typeof o !== 'object' || Array.isArray(o)) throw err('failed');
  return o;
}

const sample = {
  async json(prompt, opts = {}){
    try{
      const r = await api('/api/ai', { method: 'POST', body: JSON.stringify({ prompt }), signal: opts.signal });
      return parseJsonReply(r.text);
    }catch(e){
      if(e && e.name === 'AbortError') throw err('cancelled');
      throw e;
    }
  }
};

export const platform = {
  async use(cap){
    if(cap === 'downloads') return null;
    const u = await getUser();
    if(!u) return null;
    if(cap === 'user') return user;
    if(cap === 'db') return db;
    if(cap === 'sample') return sample;
    return null;
  }
};

export async function currentUser(){ return getUser(); }
export async function signOut(){ try{ await logout(); }catch(_){} }

export function authMessage(e){
  if(e instanceof MissingIdentityError) return 'Log masuk belum diaktifkan untuk laman ini.';
  if(e instanceof AuthError){
    if(e.status === 401) return 'E-mel atau kata laluan tidak sah, atau e-mel belum disahkan.';
    if(e.status === 403) return 'Pendaftaran ditutup. Hubungi pentadbir VOTe untuk jemputan.';
    if(e.status === 422) return 'Maklumat tidak sah. Semak e-mel dan kata laluan (sekurang-kurangnya 8 aksara).';
    return e.message || 'Log masuk gagal. Cuba lagi.';
  }
  return 'Log masuk gagal. Cuba lagi.';
}

export const auth = { login, signup, requestPasswordRecovery, updateUser, acceptInvite, handleAuthCallback };
