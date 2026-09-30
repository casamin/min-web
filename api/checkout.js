// POST /api/checkout — crea la orden (pago pendiente) y la preferencia de Mercado Pago.
// Nunca confía en precios del cliente: cotizar() recalcula todo server-side desde CATALOGO.
const { cotizar, db, nextFolio, iso, readBody, send, baseUrl, resumenTxt, ZONAS } = require('./_lib');
const LEGAL_VERSION = '2026-09-30';

const CAMPOS = ['nombre', 'email', 'tel', 'calle', 'colonia', 'cp', 'zona', 'acceso'];
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  try {
    const body = await readBody(req);
    const c = body.customer || {};
    const customer = {};
    for (const f of CAMPOS) {
      customer[f] = clip(c[f], 200);
      if (!customer[f]) return send(res, 400, { error: `Falta el campo: ${f}` });
    }
    customer.piso = clip(c.piso, 100); customer.refs = clip(c.refs, 300);
    if (!ZONAS.includes(customer.zona)) return send(res, 400, { error: 'Zona fuera de cobertura' });
    if (!/^\S+@\S+\.\S+$/.test(customer.email)) return send(res, 400, { error: 'Correo inválido' });
    if (body.okTerminos !== true || body.okAccesos !== true) {
      return send(res, 400, { error: 'Debes aceptar los términos y confirmar que mediste los accesos' });
    }
    customer.aceptacion = {
      version: LEGAL_VERSION, at: Date.now(), terminos: true, accesos: true,
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
      ua: String(req.headers['user-agent'] || '').slice(0, 200)
    };
    const cot = cotizar(body.items, body.fleteElegido);
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return send(res, 503, { error: 'Los pagos en línea no están disponibles en este momento. Escríbenos y te ayudamos con tu compra.' });

    const id = await nextFolio();
    const row = {
      id, created_at: iso(new Date()), customer,
      items: cot.items, subtotal: cot.subtotal, flete: cot.flete, total: cot.total,
      pago_estado: 'pendiente', estado: 'pendiente'
    };
    await db('orders', { method: 'POST', body: row });

    const base = baseUrl(req);
    const back = `${base}/?order=${encodeURIComponent(id)}`;
    const pref = {
      items: cot.items.map(i => ({
        id: i.id, title: `${i.name}${i.size ? ' ' + i.size : ''} · Tono ${i.tone}`, quantity: i.qty,
        unit_price: i.unitPrice, currency_id: 'MXN'
      })).concat(cot.flete.costo ? [{ id: 'flete', title: `Flete · ${cot.flete.tipo === 'ya' ? 'Lo quiero YA' : 'Ruta Min'}`, quantity: 1, unit_price: cot.flete.costo, currency_id: 'MXN' }] : []),
      payer: { name: customer.nombre, email: customer.email },
      external_reference: id,
      statement_descriptor: 'MIN MUEBLES',
      back_urls: { success: back, pending: back, failure: back },
      auto_return: 'approved',
      notification_url: `${base}/api/mp-webhook`
    };
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pref)
    });
    const data = await r.json();
    if (!r.ok) {
      await db(`orders?id=eq.${id}`, { method: 'PATCH', body: { estado: 'cancelado', notas: 'No se pudo crear el pago en Mercado Pago' } }).catch(() => {});
      console.error('MP preference error', r.status, JSON.stringify(data).slice(0, 500));
      return send(res, 502, { error: 'Mercado Pago no respondió. Intenta de nuevo en un momento.' });
    }
    await db(`orders?id=eq.${id}`, { method: 'PATCH', body: { mp_preference_id: data.id } });
    send(res, 200, { orderId: id, total: cot.total, initPoint: data.init_point, resumen: resumenTxt(cot) });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
};
