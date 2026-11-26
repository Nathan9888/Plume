/* Faux Supabase pour les essais : la partie de GoTrue (comptes) et de PostgREST (tables plume_*) que Plume utilise,
   avec la sécurité par ligne (chaque compte ne voit que ses lignes), les révisions, les stèles de suppression et les erreurs
   que le vrai service renvoie. Usage : const srv = await require('./fake-supabase').start({ key: 'anon-test' }); srv.url … srv.close() */
'use strict';
const http = require('http');
const crypto = require('crypto');

exports.start = function start(opts) {
  const o = Object.assign({ key: 'anon-test', expiresIn: 3600, confirmEmail: false, signups: true, latency: 0 }, opts);
  const st = {
    users: new Map(),          // email → {id, email, password, confirmed}
    access: new Map(),         // access_token → {user, exp}
    refresh: new Map(),        // refresh_token → user
    docs: [],                  // lignes de plume_documents
    profiles: new Map(),       // user_id → ligne de plume_profile
    log: [],                   // {method, path, user}
    fail: null,                // fonction (req) => {status, body} pour simuler une panne
    last: 0,
  };
  const now = () => { st.last = Math.max(Date.now(), st.last + 1); return new Date(st.last).toISOString().replace('Z', '000Z'); };
  const uuid = () => crypto.randomUUID();
  const send = (res, status, body, extra) => {
    const t = body === undefined || body === null ? '' : JSON.stringify(body);
    res.writeHead(status, Object.assign({ 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'apikey, authorization, content-type, prefer, x-client-info', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' }, extra || {}));
    res.end(t);
  };
  const issue = (user) => {
    const at = 'at-' + crypto.randomBytes(8).toString('hex');
    const rt = 'rt-' + crypto.randomBytes(8).toString('hex');
    const exp = Math.floor(Date.now() / 1000) + o.expiresIn;
    st.access.set(at, { user, exp });
    st.refresh.set(rt, user);
    return { access_token: at, token_type: 'bearer', expires_in: o.expiresIn, expires_at: exp, refresh_token: rt, user: { id: user.id, email: user.email } };
  };
  const authed = (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const a = m && st.access.get(m[1]);
    if (!a || a.exp < Math.floor(Date.now() / 1000)) return null;
    return a.user;
  };
  const readBody = (req) => new Promise((resolve) => {
    const c = [];
    req.on('data', (d) => c.push(d));
    req.on('end', () => { const t = Buffer.concat(c).toString('utf8'); try { resolve(t ? JSON.parse(t) : null); } catch (_) { resolve(null); } });
  });

  // filtres PostgREST : col=eq.x, col=gt.x, col=gte.x, col=lt.x
  const matches = (row, params) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(k)) continue;
      const m = /^(eq|gt|gte|lt|lte|neq)\.(.*)$/.exec(v);
      if (!m) continue;
      const a = row[k];
      const b = m[2];
      const cmp = (x, y) => (typeof x === 'number' ? x - Number(y) : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0);
      const r = m[1] === 'eq' ? String(a) === b : m[1] === 'neq' ? String(a) !== b : m[1] === 'gt' ? cmp(a, b) > 0 : m[1] === 'gte' ? cmp(a, b) >= 0 : m[1] === 'lt' ? cmp(a, b) < 0 : cmp(a, b) <= 0;
      if (!r) return false;
    }
    return true;
  };
  const project = (row, select) => {
    if (!select || select === '*') return Object.assign({}, row);
    const out = {};
    for (const c of select.split(',')) out[c.trim()] = row[c.trim()];
    return out;
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return send(res, 204);
    if (o.latency) await new Promise((r) => setTimeout(r, o.latency));
    if (req.headers.apikey !== o.key) return send(res, 401, { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' });
    if (st.fail) { const f = st.fail(req, u); if (f) return send(res, f.status, f.body || { message: 'panne simulée' }); }
    const body = req.method === 'GET' ? null : await readBody(req);
    const user = authed(req);
    st.log.push({ method: req.method, path: u.pathname + u.search, user: user ? user.email : null });

    // ---- GoTrue
    if (u.pathname === '/auth/v1/signup' && req.method === 'POST') {
      if (!o.signups) return send(res, 422, { code: 422, error_code: 'signup_disabled', msg: 'Signups not allowed for this instance' });
      const email = String(body && body.email || '').toLowerCase();
      const pw = String(body && body.password || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { code: 400, error_code: 'validation_failed', msg: 'Unable to validate email address: invalid format' });
      if (pw.length < 6) return send(res, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
      if (st.users.has(email)) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      const user = { id: uuid(), email, password: pw, confirmed: !o.confirmEmail };
      st.users.set(email, user);
      return send(res, 200, o.confirmEmail ? { id: user.id, email, confirmation_sent_at: new Date().toISOString() } : issue(user));
    }
    if (u.pathname === '/auth/v1/token' && req.method === 'POST') {
      const grant = u.searchParams.get('grant_type');
      if (grant === 'password') {
        const user = st.users.get(String(body && body.email || '').toLowerCase());
        if (!user || user.password !== (body && body.password)) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        if (!user.confirmed) return send(res, 400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
        return send(res, 200, issue(user));
      }
      if (grant === 'refresh_token') {
        const user = st.refresh.get(body && body.refresh_token);
        if (!user) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
        st.refresh.delete(body.refresh_token);                    // les jetons de renouvellement tournent
        return send(res, 200, issue(user));
      }
      return send(res, 400, { code: 400, msg: 'unsupported grant' });
    }
    if (u.pathname === '/auth/v1/logout' && req.method === 'POST') {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      if (m) st.access.delete(m[1]);
      return send(res, 204);
    }
    if (u.pathname === '/auth/v1/recover' && req.method === 'POST') { st.recovered = body && body.email; return send(res, 200, {}); }

    // ---- PostgREST
    const tm = /^\/rest\/v1\/(plume_documents|plume_profile)$/.exec(u.pathname);
    if (tm) {
      if (!user) return send(res, 401, { code: 'PGRST301', message: 'JWT expired or invalid' });
      const table = tm[1];
      const select = u.searchParams.get('select');
      const prefer = String(req.headers.prefer || '');
      const wantRows = /return=representation/.test(prefer);
      const pk = table === 'plume_documents' ? 'id' : 'user_id';
      const mine = () => (table === 'plume_documents' ? st.docs : Array.from(st.profiles.values())).filter((r) => r.user_id === user.id);
      if (req.method === 'GET') {
        let rows = mine().filter((r) => matches(r, u.searchParams));
        const ord = u.searchParams.get('order');
        if (ord) { const [c, d] = ord.split('.'); rows.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (d === 'desc' ? -1 : 1)); }
        const lim = Number(u.searchParams.get('limit'));
        if (lim) rows = rows.slice(0, lim);
        return send(res, 200, rows.map((r) => project(r, select)));
      }
      const arr = Array.isArray(body) ? body : body ? [body] : [];
      if (req.method === 'POST') {
        const out = [];
        for (const raw of arr) {
          const row = Object.assign(table === 'plume_documents'
            ? { id: uuid(), title: 'Sans titre', preview: '', body: '', encrypted: false, rev: 1, deleted: false, device: null, created_at: now() }
            : { author: null, settings: {} }, raw, { user_id: user.id });
          if (table === 'plume_documents' && typeof row.body !== 'string') return send(res, 400, { code: '22P02', message: 'invalid body' });
          const existing = (table === 'plume_documents' ? st.docs : Array.from(st.profiles.values())).find((r) => r[pk] === row[pk]);
          if (existing) {
            if (existing.user_id !== user.id) return send(res, 403, { code: '42501', message: 'new row violates row-level security policy for table "' + table + '"' });
            if (/merge-duplicates/.test(prefer)) { Object.assign(existing, raw, { user_id: user.id, updated_at: now() }); out.push(existing); continue; }
            if (/ignore-duplicates/.test(prefer)) continue;
            return send(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint "' + table + '_pkey"' });
          }
          row.updated_at = now();
          if (table === 'plume_documents') st.docs.push(row); else st.profiles.set(user.id, row);
          out.push(row);
        }
        return wantRows ? send(res, 201, out.map((r) => project(r, select))) : send(res, 201);
      }
      if (req.method === 'PATCH') {
        const rows = mine().filter((r) => matches(r, u.searchParams));
        for (const r of rows) { Object.assign(r, body || {}, { user_id: user.id, updated_at: now() }); }
        return wantRows ? send(res, 200, rows.map((r) => project(r, select))) : send(res, 204);
      }
    }
    return send(res, 404, { message: 'not found' });
  });

  return new Promise((resolve) => {
    server.listen(o.port || 0, '127.0.0.1', () => {
      resolve({
        url: 'http://127.0.0.1:' + server.address().port,
        key: o.key,
        state: st,
        addUser: (email, password) => { const user = { id: uuid(), email: email.toLowerCase(), password, confirmed: true }; st.users.set(user.email, user); return user; },
        expireAllAccess: () => { for (const a of st.access.values()) a.exp = 0; },
        revokeAllRefresh: () => st.refresh.clear(),
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
};
