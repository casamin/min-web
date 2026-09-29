// POST /api/mp-webhook — notificación asíncrona de Mercado Pago.
// Nunca marca "pagado" solo porque el webhook llegó: siempre reconsulta el pago directo con MP antes de confiar en el estado.
const { db, send, mail, resumenTxt } = require('./_lib');

module.exports = async (req, res) => {
  try {
    const paymentId = req.query?.id || req.body?.data?.id || (await readIdFromBody(req));
    const topic = req.query?.topic || req.body?.type;
    if (!paymentId || (topic && topic !== 'payment')) return send(res, 200, { ok: true, skip: true });

    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return send(res, 200, { ok: true, dev: true });

    const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return send(res, 200, { ok: true, warn: 'no se pudo consultar el pago' });
    const pago = await r.json();
    const orderId = pago.external_reference;
    if (!orderId) return send(res, 200, { ok: true });

    const estadoPago = pago.status === 'approved' ? 'aprobado' : pago.status === 'refunded' ? 'reembolsado' : pago.status === 'rejected' ? 'rechazado' : 'pendiente';
    const patch = { pago_estado: estadoPago, mp_payment_id: String(paymentId) };
    if (estadoPago === 'aprobado') patch.paid_at = new Date().toISOString();
    await db(`orders?id=eq.${orderId}`, { method: 'PATCH', body: patch });

    if (estadoPago === 'aprobado') {
      const rows = await db(`orders?id=eq.${orderId}`);
      const o = Array.isArray(rows) ? rows[0] : null;
      if (o && o.customer?.email) {
        await mail(o.customer.email, `Confirmación de tu pedido ${orderId} — Min`,
          `¡Gracias por tu compra!\n\n${resumenTxt({ items: o.items, subtotal: o.subtotal, flete: o.flete, total: o.total })}\n\nTu pedido: ${orderId}`);
      }
    }
    send(res, 200, { ok: true });
  } catch (e) {
    // Mercado Pago reintenta si no respondemos 200; preferimos loguear y devolver 200 igual.
    console.error('webhook error', e);
    send(res, 200, { ok: true, error: e.message });
  }
};

async function readIdFromBody(req) {
  if (req.body && typeof req.body === 'object') return req.body.data?.id;
  return null;
}
