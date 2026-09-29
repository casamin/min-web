// POST /api/checkout — crea la orden (pago pendiente) y la preferencia de Mercado Pago.
// Nunca confía en precios del cliente: cotizar() recalcula todo server-side desde CATALOGO.
const { cotizar, db, nextFolio, iso, readBody, send, baseUrl, resumenTxt } = require('./_lib');
const LEGAL_VERSION = '2026-09-26'; // mantener igual a LEGAL.version en public/js/legal.js

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  try {
    const body = await readBody(req);
    const customer = body.customer || {};
    for (const f of ['nombre', 'telefono', 'direccion', 'ciudad', 'cp']) {
      if (!customer[f]) return send(res, 400, { error: `Falta el campo de contacto: ${f}` });
    }
    // Evidencia legal: sin aceptación explícita de términos y de la política de accesos no se crea el pedido.
    if (body.okTerminos !== true || body.okAccesos !== true) {
      return send(res, 400, { error: 'Debes aceptar los términos y confirmar que mediste los accesos' });
    }
    customer.aceptacion = {
      version: LEGAL_VERSION, at: new Date().toISOString(), terminos: true, accesos: true,
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
      ua: String(req.headers['user-agent'] || '').slice(0, 200)
    };
    const cot = cotizar(body.items, body.fleteElegido);
    const id = await nextFolio();

    const row = {
      id, created_at: iso(new Date()), customer,
      items: cot.items, subtotal: cot.subtotal, flete: cot.flete, total: cot.total,
      pago_estado: 'pendiente', estado: 'nuevo'
    };
    await db('orders', { method: 'POST', body: row });

    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      // Modo desarrollo sin Mercado Pago conectado: regresa un link falso que va directo a "gracias"
      return send(res, 200, { orderId: id, initPoint: `${baseUrl(req)}/gracias.html?order=${id}&dev=1`, dev: true });
    }

    const pref = {
      items: [{ title: `Pedido Min ${id}`, quantity: 1, unit_price: cot.total, currency_id: 'MXN' }],
      external_reference: id,
      back_urls: {
        success: `${baseUrl(req)}/gracias.html?order=${id}`,
        pending: `${baseUrl(req)}/gracias.html?order=${id}`,
        failure: `${baseUrl(req)}/carrito.html?pago=fallido`
      },
      auto_return: 'approved',
      notification_url: `${baseUrl(req)}/api/mp-webhook`
    };
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pref)
    });
    const data = await r.json();
    if (!r.ok) throw new Error('Mercado Pago: ' + JSON.stringify(data).slice(0, 300));

    await db(`orders?id=eq.${id}`, { method: 'PATCH', body: { mp_preference_id: data.id } });

    send(res, 200, { orderId: id, initPoint: data.init_point, resumen: resumenTxt(cot) });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
};
