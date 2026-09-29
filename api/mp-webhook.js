// POST /api/mp-webhook — notificación asíncrona de Mercado Pago.
// Nunca marca "pagado" solo porque el webhook llegó: syncPayment() reconsulta el pago directo con MP.
const { send, readBody, syncPayment } = require('./_lib');

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const body = await readBody(req);
    const topic = q.topic || q.type || body.type || body.topic;
    const paymentId = q['data.id'] || (body.data && body.data.id) || (topic === 'payment' ? q.id : null);
    if (!paymentId || (topic && topic !== 'payment')) return send(res, 200, { ok: true, skip: true });
    await syncPayment(paymentId);
    send(res, 200, { ok: true });
  } catch (e) {
    // Mercado Pago reintenta si no respondemos 200; preferimos loguear y devolver 200 igual.
    console.error('webhook error', e);
    send(res, 200, { ok: true });
  }
};
