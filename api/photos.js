// GET /api/photos — lista pública de fotos reales de producto (solo lectura, sin sesión).
// Las usa la tienda (index.html / producto.html) para mostrar la foto real cuando ya existe,
// y dejar el placeholder cuando el producto/tono/tipo todavía no tiene foto subida en el ERP.
const { send, cors } = require('./_lib');

const BUCKET = 'product-photos';

function supa() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}
function publicUrl(base, path) {
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { error: 'Método no permitido' });
  const s = supa();
  if (!s) return send(res, 200, []); // sin Supabase configurado: la tienda usa sus placeholders
  try {
    const r = await fetch(`${s.url}/rest/v1/product_photos?select=product,tone,kind,storage_path`, {
      headers: { apikey: s.key, Authorization: `Bearer ${s.key}` }
    });
    if (!r.ok) return send(res, 200, []);
    const rows = await r.json();
    res.setHeader('Cache-Control', 'public, max-age=60');
    return send(res, 200, rows.map(row => ({ product: row.product, tone: row.tone, kind: row.kind, url: publicUrl(s.url, row.storage_path) })));
  } catch (e) {
    return send(res, 200, []);
  }
};
