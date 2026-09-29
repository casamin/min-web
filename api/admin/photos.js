// GET    /api/admin/photos              -> lista todas las fotos guardadas (product, tone, kind, url)
// POST   /api/admin/photos               -> sube/reemplaza una foto { product, tone, kind, dataUrl }
// DELETE /api/admin/photos?product=X&tone=N&kind=K -> quita una foto
// kind: portada (solo sofa) | tarjeta | frente | tres_cuartos | lateral | escenario | closeup
// Toda la sesión se valida con isAdmin() (cookie HMAC firmada) — el service_role key nunca sale del servidor.
const { isAdmin, send, readBody, cors } = require('../_lib');

const PRODUCTS = ['sofa', 'sofa2', 'sillon', 'chaise', 'cama'];
const BUCKET = 'product-photos';
const KINDS = ['portada', 'tarjeta', 'frente', 'tres_cuartos', 'lateral', 'escenario', 'closeup'];
const LEGACY = { main: 'frente', det: 'closeup' };
const normKind = k => LEGACY[k] || k;

function supa() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas en Vercel');
  return { url, key };
}

function publicUrl(base, path, ts) {
  const v = ts ? `?v=${Date.parse(ts) || ''}` : '';
  return `${base}/storage/v1/object/public/${BUCKET}/${path}${v}`;
}

async function listRows() {
  const { url, key } = supa();
  const r = await fetch(`${url}/rest/v1/product_photos?select=product,tone,kind,storage_path,updated_at`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!r.ok) throw new Error(`DB ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function upsertRow(product, tone, kind, storagePath) {
  const { url, key } = supa();
  const r = await fetch(`${url}/rest/v1/product_photos?on_conflict=product,tone,kind`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify([{ product, tone, kind, storage_path: storagePath }])
  });
  if (!r.ok) throw new Error(`DB ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function deleteRow(product, tone, kind) {
  const { url, key } = supa();
  const r = await fetch(
    `${url}/rest/v1/product_photos?product=eq.${product}&tone=eq.${tone}&kind=eq.${kind}`,
    { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!r.ok) throw new Error(`DB ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function uploadObject(path, buffer, contentType) {
  const { url, key } = supa();
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buffer
  });
  if (!r.ok) throw new Error(`Storage ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function deleteObject(path) {
  const { url, key } = supa();
  await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  }).catch(() => {}); // si ya no existe, seguimos sin fallar el borrado del registro
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (!isAdmin(req)) return send(res, 401, { error: 'No autorizado' });
  const { url: base } = supa();

  if (req.method === 'GET') {
    const rows = await listRows();
    return send(res, 200, rows.map(r => ({ ...r, url: publicUrl(base, r.storage_path, r.updated_at) })));
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const { product, tone, dataUrl } = body, kind = normKind(body.kind);
    if (!PRODUCTS.includes(product)) return send(res, 400, { error: 'Producto inválido' });
    const t = Number(tone);
    if (!Number.isInteger(t) || t < 0 || t > 3) return send(res, 400, { error: 'Tono inválido' });
    if (!KINDS.includes(kind)) return send(res, 400, { error: 'Tipo de foto inválido' });
    if (kind === 'portada' && product !== 'sofa') return send(res, 400, { error: 'La portada es solo del Sofá 2.40' });
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || '');
    if (!m) return send(res, 400, { error: 'Imagen inválida (se espera JPEG/PNG/WebP en base64)' });
    const [, mime, b64] = m;
    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length > 5 * 1024 * 1024) return send(res, 400, { error: 'La imagen pesa más de 5 MB' });
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const path = `${product}-${t}-${kind}.${ext}`;
    try {
      const prev = (await listRows()).find(r => r.product === product && r.tone === t && r.kind === kind);
      await uploadObject(path, buffer, mime);
      await upsertRow(product, t, kind, path);
      if (prev && prev.storage_path !== path) await deleteObject(prev.storage_path);
    } catch (e) {
      return send(res, 502, { error: 'No se pudo guardar la foto: ' + e.message });
    }
    return send(res, 200, { ok: true, url: publicUrl(base, path, new Date().toISOString()) });
  }

  if (req.method === 'DELETE') {
    const { product, tone } = req.query || {}, kind = normKind((req.query || {}).kind);
    const t = Number(tone);
    if (!PRODUCTS.includes(product) || !Number.isInteger(t) || !KINDS.includes(kind)) {
      return send(res, 400, { error: 'Parámetros inválidos' });
    }
    const rows = await listRows();
    const row = rows.find(r => r.product === product && r.tone === t && r.kind === kind);
    try {
      if (row) await deleteObject(row.storage_path);
      await deleteRow(product, t, kind);
    } catch (e) {
      return send(res, 502, { error: 'No se pudo quitar la foto: ' + e.message });
    }
    return send(res, 200, { ok: true });
  }

  send(res, 405, { error: 'Método no permitido' });
};
