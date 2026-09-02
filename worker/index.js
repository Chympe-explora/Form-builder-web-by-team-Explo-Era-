// Form & Website Builder — Cloudflare Worker API
//
// Bindings expected (set in wrangler.toml / dashboard):
//   DB                 — D1 database binding (see schema.sql)
//   JWT_SECRET          — long random string, `wrangler secret put JWT_SECRET`
//   TELEGRAM_BOT_TOKEN  — `wrangler secret put TELEGRAM_BOT_TOKEN`
//   TELEGRAM_CHAT_ID    — the chat/channel id files get forwarded to
//
// Never put any of the three secrets above in frontend code — they only
// ever live in this Worker's environment.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

function uid(prefix = '') {
  return prefix + crypto.randomUUID().replace(/-/g, '');
}

// ---------- password hashing (PBKDF2 via Web Crypto — no external deps) ----------

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const saltOutHex = [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { hash: hashHex, salt: saltOutHex };
}

// ---------- minimal JWT (HMAC-SHA256) ----------

function b64url(bytesOrStr) {
  const bytes = typeof bytesOrStr === 'string' ? new TextEncoder().encode(bytesOrStr) : bytesOrStr;
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecodeToStr(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = b64url(JSON.stringify(header));
  const encPayload = b64url(JSON.stringify(payload));
  const data = `${encHeader}.${encPayload}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}

async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSig] = parts;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBytes = Uint8Array.from(b64urlDecodeToStr(encSig), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(`${encHeader}.${encPayload}`));
  if (!valid) return null;
  const payload = JSON.parse(b64urlDecodeToStr(encPayload));
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

async function requireAuth(request, env) {
  const authz = request.headers.get('Authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  if (!token) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  return payload; // { sub: userId, email }
}

// ---------- default project scaffold ----------

function defaultConfig(name) {
  return {
    theme: { primaryColor: '#4B39D6', backgroundColor: '#EEEDFB', font: 'Roboto', logoMediaId: null, bannerMediaId: null },
    buttons: {
      next: { enabled: true, text: 'Next' },
      back: { enabled: true, text: 'Back' },
      submit: { enabled: true, text: 'Submit' },
      copy: { enabled: false, text: 'Copy' },
      download: { enabled: false, text: 'Download' },
      upload: { enabled: false, text: 'Upload File' },
    },
    whatsapp: { enabled: false, number: '', messageTemplate: 'New submission from {{name}}' },
    pages: [
      {
        id: 'page_1',
        title: name || 'Page 1',
        order: 0,
        elements: [
          { id: uid('el_'), type: 'heading', order: 0, hidden: false, props: { text: name || 'Untitled Form' } },
        ],
      },
    ],
  };
}

function randomSlug() {
  return crypto.randomUUID().split('-')[0];
}

// ---------- Telegram-backed media ----------

async function telegramUpload(env, fileBlob, filename) {
  const form = new FormData();
  form.append('chat_id', env.TELEGRAM_CHAT_ID);
  form.append('document', fileBlob, filename);
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  const data = await resp.json();
  if (!data.ok) throw new Error('Telegram upload failed: ' + JSON.stringify(data));
  const doc = data.result.document || data.result.photo?.slice(-1)[0];
  return { file_id: doc.file_id, mime_type: doc.mime_type || null };
}

async function telegramGetFilePath(env, fileId) {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
  const data = await resp.json();
  if (!data.ok) throw new Error('Telegram getFile failed');
  return data.result.file_path;
}

// ---------- router ----------

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---- auth ----
      if (path === '/api/auth/signup' && request.method === 'POST') {
        const { email, password } = await request.json();
        if (!email || !password || password.length < 8) return err('Email and an 8+ character password are required.');
        const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
        if (existing) return err('An account with that email already exists.', 409);
        const { hash, salt } = await hashPassword(password);
        const id = uid('user_');
        await env.DB.prepare('INSERT INTO users (id, email, password_hash, salt, created_at) VALUES (?,?,?,?,?)')
          .bind(id, email, hash, salt, new Date().toISOString())
          .run();
        const token = await signJWT({ sub: id, email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, env.JWT_SECRET);
        return json({ token, user: { id, email } });
      }

      if (path === '/api/auth/login' && request.method === 'POST') {
        const { email, password } = await request.json();
        const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
        if (!user) return err('Invalid email or password.', 401);
        const { hash } = await hashPassword(password, user.salt);
        if (hash !== user.password_hash) return err('Invalid email or password.', 401);
        const token = await signJWT({ sub: user.id, email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, env.JWT_SECRET);
        return json({ token, user: { id: user.id, email } });
      }

      // ---- projects (private, owner-scoped) ----
      if (path === '/api/projects' && request.method === 'GET') {
        const auth = await requireAuth(request, env);
        if (!auth) return err('Unauthorized', 401);
        const { results } = await env.DB.prepare(
          'SELECT id, name, slug, published, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC'
        ).bind(auth.sub).all();
        return json({ projects: results });
      }

      if (path === '/api/projects' && request.method === 'POST') {
        const auth = await requireAuth(request, env);
        if (!auth) return err('Unauthorized', 401);
        const { name } = await request.json();
        const id = uid('proj_');
        const slug = randomSlug();
        const now = new Date().toISOString();
        const config = JSON.stringify(defaultConfig(name));
        await env.DB.prepare(
          'INSERT INTO projects (id, user_id, slug, name, config, published, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)'
        ).bind(id, auth.sub, slug, name || 'Untitled', config, now, now).run();
        return json({ id, slug, name: name || 'Untitled' });
      }

      const projectMatch = path.match(/^\/api\/projects\/([^/]+)(\/(publish|unpublish|responses))?$/);
      if (projectMatch && ['GET', 'PUT', 'DELETE', 'POST'].includes(request.method)) {
        const auth = await requireAuth(request, env);
        if (!auth) return err('Unauthorized', 401);
        const projectId = projectMatch[1];
        const action = projectMatch[3];
        const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(projectId, auth.sub).first();
        if (!project) return err('Project not found.', 404);

        if (!action && request.method === 'GET') {
          return json({ ...project, config: JSON.parse(project.config) });
        }
        if (!action && request.method === 'PUT') {
          const body = await request.json();
          const config = body.config ? JSON.stringify(body.config) : project.config;
          const name = body.name ?? project.name;
          await env.DB.prepare('UPDATE projects SET name=?, config=?, updated_at=? WHERE id=?')
            .bind(name, config, new Date().toISOString(), projectId).run();
          return json({ ok: true });
        }
        if (!action && request.method === 'DELETE') {
          await env.DB.prepare('DELETE FROM responses WHERE project_id=?').bind(projectId).run();
          await env.DB.prepare('DELETE FROM media WHERE project_id=?').bind(projectId).run();
          await env.DB.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run();
          return json({ ok: true });
        }
        if (action === 'publish' && request.method === 'POST') {
          await env.DB.prepare('UPDATE projects SET published=1, updated_at=? WHERE id=?').bind(new Date().toISOString(), projectId).run();
          return json({ ok: true, publicUrl: `/f/${project.slug}` });
        }
        if (action === 'unpublish' && request.method === 'POST') {
          await env.DB.prepare('UPDATE projects SET published=0, updated_at=? WHERE id=?').bind(new Date().toISOString(), projectId).run();
          return json({ ok: true });
        }
        if (action === 'responses' && request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM responses WHERE project_id=? ORDER BY created_at DESC').bind(projectId).all();
          return json({ responses: results.map((r) => ({ ...r, data: JSON.parse(r.data) })) });
        }
      }

      const responseDeleteMatch = path.match(/^\/api\/responses\/([^/]+)$/);
      if (responseDeleteMatch && request.method === 'DELETE') {
        const auth = await requireAuth(request, env);
        if (!auth) return err('Unauthorized', 401);
        const responseId = responseDeleteMatch[1];
        // ownership check: response's project must belong to this user
        const row = await env.DB.prepare(
          `SELECT r.id FROM responses r JOIN projects p ON r.project_id = p.id WHERE r.id = ? AND p.user_id = ?`
        ).bind(responseId, auth.sub).first();
        if (!row) return err('Not found.', 404);
        await env.DB.prepare('DELETE FROM responses WHERE id=?').bind(responseId).run();
        return json({ ok: true });
      }

      // ---- public (no auth) ----
      const publicGetMatch = path.match(/^\/api\/public\/([^/]+)$/);
      if (publicGetMatch && request.method === 'GET') {
        const slug = publicGetMatch[1];
        const project = await env.DB.prepare('SELECT * FROM projects WHERE slug=? AND published=1').bind(slug).first();
        if (!project) return err('This form is not available.', 404);
        return json({ id: project.id, name: project.name, config: JSON.parse(project.config) });
      }

      const publicSubmitMatch = path.match(/^\/api\/public\/([^/]+)\/submit$/);
      if (publicSubmitMatch && request.method === 'POST') {
        const slug = publicSubmitMatch[1];
        const project = await env.DB.prepare('SELECT * FROM projects WHERE slug=? AND published=1').bind(slug).first();
        if (!project) return err('This form is not available.', 404);
        const data = await request.json();
        const id = uid('resp_');
        await env.DB.prepare('INSERT INTO responses (id, project_id, data, created_at) VALUES (?,?,?,?)')
          .bind(id, project.id, JSON.stringify(data), new Date().toISOString()).run();
        return json({ ok: true, id });
      }

      // ---- media (Telegram-backed) ----
      if (path === '/api/media/upload' && request.method === 'POST') {
        // Used both by the authenticated builder (logos/banners) and by
        // public visitors submitting a file_upload field — the projectId
        // + published check keeps this from being an open relay.
        const form = await request.formData();
        const projectId = form.get('projectId');
        const kind = form.get('kind') === 'submission' ? 'submission' : 'asset';
        const file = form.get('file');
        if (!projectId || !file) return err('projectId and file are required.');

        const project = await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(projectId).first();
        if (!project) return err('Project not found.', 404);
        if (kind === 'asset') {
          const auth = await requireAuth(request, env);
          if (!auth || auth.sub !== project.user_id) return err('Unauthorized', 401);
        } else if (!project.published) {
          return err('This form is not available.', 404);
        }

        const { file_id, mime_type } = await telegramUpload(env, file, file.name || 'upload');
        const mediaId = uid('media_');
        await env.DB.prepare(
          'INSERT INTO media (id, project_id, telegram_file_id, original_name, mime_type, kind, created_at) VALUES (?,?,?,?,?,?,?)'
        ).bind(mediaId, projectId, file_id, file.name || null, mime_type, kind, new Date().toISOString()).run();
        return json({ mediaId });
      }

      if (path === '/api/media' && request.method === 'GET') {
        const auth = await requireAuth(request, env);
        if (!auth) return err('Unauthorized', 401);
        const projectId = url.searchParams.get('projectId');
        if (!projectId) return err('projectId is required.');
        const project = await env.DB.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').bind(projectId, auth.sub).first();
        if (!project) return err('Project not found.', 404);
        const { results } = await env.DB.prepare(
          "SELECT id, original_name, mime_type, created_at FROM media WHERE project_id=? AND kind='asset' ORDER BY created_at DESC"
        ).bind(projectId).all();
        return json({ media: results });
      }

      const mediaDeleteMatch = path.match(/^\/api\/media\/([^/]+)$/);
      if (mediaDeleteMatch && request.method === 'DELETE') {
        const auth = await requireAuth(request, env);
        if (!auth) return err('Unauthorized', 401);
        const row = await env.DB.prepare(
          `SELECT m.id FROM media m JOIN projects p ON m.project_id = p.id WHERE m.id=? AND p.user_id=?`
        ).bind(mediaDeleteMatch[1], auth.sub).first();
        if (!row) return err('Not found.', 404);
        await env.DB.prepare('DELETE FROM media WHERE id=?').bind(mediaDeleteMatch[1]).run();
        return json({ ok: true });
      }

      const mediaFileMatch = path.match(/^\/api\/media\/([^/]+)\/file$/);
      if (mediaFileMatch && request.method === 'GET') {
        const media = await env.DB.prepare('SELECT * FROM media WHERE id=?').bind(mediaFileMatch[1]).first();
        if (!media) return err('Not found.', 404);
        const filePath = await telegramGetFilePath(env, media.telegram_file_id);
        const fileResp = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
        return new Response(fileResp.body, {
          headers: { 'Content-Type': media.mime_type || 'application/octet-stream', ...CORS_HEADERS },
        });
      }

      return err('Not found.', 404);
    } catch (e) {
      return err('Server error: ' + e.message, 500);
    }
  },
};
