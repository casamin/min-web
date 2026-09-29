// Utilidades compartidas del servidor (Vercel Node functions). Sin dependencias externas.
const crypto = require('crypto');

/* ---------- Catálogo: FUENTE DE VERDAD de precios (mantener en sync con public/js/app.js) ---------- */
const CATALOGO = {
  sofa:   { name: 'Sofá 2.40', price: 9800 },
  sofa2:  { name: 'Sofá 2.00', price: 9200 },
  sillon: { name: 'Sillón',    price: 7800 },
  chaise: { name: 'Chaise',    price: 14800, piezas: 2 },
  cama:   { name: 'Cama',      price: 9800, sizes: { Individual: -2300, Matrimonial: 0, Queen: 0, King: 1700 } }
};
const TONOS = { Nube: 'Beloved', Arena: 'Beloved', Grafito: 'Beloved', Olivo: 'Beloved' }; // tono -> catálogo
const FLETE = { ya: { name: 'Lo quiero YA', price: 3000 }, ruta: { name: 'Ruta Min', price: 1000 }, gratis: { name: 'Flete gratis', price: 0 } };
const PIEZAS_GRATIS = 4;
const ZONAS = ['CDMX', 'Área metropolitana', 'Puebla'];

function cotizar(items, fleteElegido) {
  if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error('Carrito vacío o inválido');
  const out = [];
  for (const it of items) {
    const p = CATALOGO[it.id];
    if (!p) throw new Error('Producto inválido');
    if (!TONOS[it.tone]) throw new Error('Tono inválido');
    const qty = Math.max(1, Math.min(10, parseInt(it.qty, 10) || 1));
    let size = null, unit = p.price;
    if (p.sizes) {
      size = p.sizes[it.size] !== undefined ? it.size : 'Matrimonial';
      unit += p.sizes[size];
    }
    out.push({ id: it.id, name: p.name, cat: TONOS[it.tone], tone: it.tone, size, qty, unitPrice: unit });
  }
  const subtotal = out.reduce((a, i) => a + i.qty * i.unitPrice, 0);
  const piezas = out.reduce((a, i) => a + i.qty * (CATALOGO[i.id].piezas || 1), 0);
  const tipo = piezas >= PIEZAS_GRATIS ? 'gratis' : (fleteElegido === 'ya' ? 'ya' : 'ruta');
  const flete = { tipo, costo: FLETE[tipo].price };
  return { items: out, subtotal, flete, total: subtotal + flete.costo, piezas };
}

/* ---------- Supabase vía REST (service role, solo servidor) ---------- */
const MEM = global.__MIN_MEM || (global.__MIN_MEM = { orders: [], settings: {}, seq: 1000 }); // modo local sin Supabase

async function db(path, { method = 'GET', body, prefer } = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return memDb(path, method, body);
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: prefer || 'return=representation' },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`DB ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}
// Emulación mínima para desarrollo local
function memDb(path, method, body) {
  const [table, qs] = path.split('?');
  const q = new URLSearchParams(qs || '');
  const eq = k => (q.get(k) || '').replace(/^eq\./, '');
  if (table === 'rpc/next_folio') { MEM.seq++; return 'MIN-' + MEM.seq; }
  if (table === 'orders') {
    if (method === 'GET') return q.get('id') ? MEM.orders.filter(o => o.id === eq('id')) : MEM.orders.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (method === 'POST') { const row = Object.assign({ created_at: new Date().toISOString() }, body); MEM.orders.push(row); return [row]; }
    if (method === 'PATCH') { const o = MEM.orders.find(x => x.id === eq('id')); if (o) Object.assign(o, body); return o ? [o] : []; }
  }
  if (table === 'settings') {
    if (method === 'GET') return Object.entries(MEM.settings).map(([key, value]) => ({ key, value }));
    if (method === 'POST') { (Array.isArray(body) ? body : [body]).forEach(r => MEM.settings[r.key] = r.value); return []; }
  }
  return [];
}

async function nextFolio() {
  const r = await db('rpc/next_folio', { method: 'POST', body: {} });
  return typeof r === 'string' ? r : r;
}

/* ---------- conversión fila <-> objeto del ERP ---------- */
const ms = t => (t ? new Date(t).getTime() : null);
const iso = t => (t ? new Date(t).toISOString() : null);
function rowToOrder(r) {
  return {
    id: r.id, createdAt: ms(r.created_at), paidAt: ms(r.paid_at), customer: r.customer, items: r.items,
    subtotal: r.subtotal, flete: r.flete, total: r.total,
    pago: { metodo: 'Mercado Pago', estado: r.pago_estado, mpId: r.mp_payment_id },
    estado: r.estado, notas: r.notas || '', envio: r.envio || {}, produccion: r.produccion || {}
  };
}

/* ---------- auth admin: cookie firmada HMAC ---------- */
const COOKIE = 'min_admin';
function sign(v) { return crypto.createHmac('sha256', secret()).update(v).digest('hex'); }
function secret() { return process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || 'dev-secret'; }
function makeSession() { const exp = String(Date.now() + 12 * 3600e3); return `${exp}.${sign(exp)}`; }
function isAdmin(req) {
  const c = parseCookies(req)[COOKIE]; if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function setSession(res, value, maxAge) {
  // SameSite=None porque, mientras el ERP siga siendo un HTML suelto (no servido desde este mismo
  // dominio), el navegador llama a esta API desde otro origen — con Secure siempre (Vercel es HTTPS).
  // El día que el sitio se sirva desde este mismo dominio, esto puede volver a Strict.
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${maxAge}`);
}

/* ---------- CORS: la API se llama desde el HTML suelto (otro origen) mientras no comparten dominio ---------- */
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  return false;
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- utilidades HTTP ---------- */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  req.rawBody = raw;
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
function send(res, status, obj) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); }
function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

/* ---------- correo (Resend, opcional) ---------- */
async function mail(to, subject, text) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from || !to) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, text })
  });
  return r.ok;
}
const fmt = n => '$' + Number(n).toLocaleString('es-MX');
function resumenTxt(o) {
  return o.items.map(i => `• ${i.qty} × ${i.name}${i.size ? ' ' + i.size : ''} — Catálogo ${i.cat} · Tono ${i.tone}`).join('\n') +
    `\n\nSubtotal: ${fmt(o.subtotal)}\nFlete (${FLETE[o.flete.tipo].name}): ${o.flete.costo ? fmt(o.flete.costo) : 'Gratis'}\nTotal: ${fmt(o.total)}`;
}


/* ---------- Mercado Pago: reconsulta un pago directo con MP y actualiza el pedido ----------
   Lo usan el webhook y la página de regreso (/api/order-status). Nunca confía en lo que diga el navegador. */
async function syncPayment(paymentId, expectedOrderId) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token || !paymentId) return null;
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) return null;
  const pago = await r.json();
  const orderId = pago.external_reference;
  if (!orderId || !/^MIN-\d+$/.test(orderId)) return null;       // pago de otra marca de Casa Min: no es nuestro
  if (expectedOrderId && orderId !== expectedOrderId) return null;
  const rows = await db(`orders?id=eq.${orderId}`);
  const o = Array.isArray(rows) ? rows[0] : null;
  if (!o) return null;
  if (Number(pago.transaction_amount) + 0.5 < Number(o.total)) return o; // monto no cuadra: no se marca pagado
  const estadoPago = pago.status === 'approved' ? 'aprobado'
    : (pago.status === 'refunded' || pago.status === 'charged_back') ? 'reembolsado'
    : (pago.status === 'rejected' || pago.status === 'cancelled') ? 'rechazado' : 'pendiente';
  if (o.pago_estado === 'aprobado' && estadoPago !== 'reembolsado') return o;  // ya estaba pagado: no retroceder
  const patch = { pago_estado: estadoPago, mp_payment_id: String(pago.id) };
  if (estadoPago === 'aprobado') { patch.paid_at = new Date().toISOString(); if (o.estado === 'pendiente') patch.estado = 'pagado'; }
  const up = await db(`orders?id=eq.${orderId}`, { method: 'PATCH', body: patch });
  const nuevo = Array.isArray(up) ? up[0] : o;
  if (estadoPago === 'aprobado' && o.pago_estado !== 'aprobado' && o.customer && o.customer.email) {
    await mail(o.customer.email, `Confirmación de tu pedido ${orderId} — Min`,
      `¡Gracias por tu compra!\n\n${resumenTxt({ items: o.items, subtotal: o.subtotal, flete: o.flete, total: o.total })}\n\nTu pedido: ${orderId}`).catch(() => false);
  }
  return nuevo;
}

module.exports = { CATALOGO, syncPayment, TONOS, FLETE, ZONAS, cotizar, db, nextFolio, rowToOrder, iso, isAdmin, makeSession, setSession, safeEqual, readBody, send, baseUrl, mail, fmt, resumenTxt, MEM, cors };
