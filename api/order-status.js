// GET /api/order-status?id=MIN-2001&payment_id=123 — la usa la página de regreso de Mercado Pago.
// Si viene payment_id, reconsulta el pago con MP (por si el webhook todavía no llega).
// Solo regresa estado y total: nada de datos personales.
const { db, send, syncPayment } = require('./_lib');

module.exports = async (req, res) => {
  const id = String((req.query || {}).id || '');
  const pid = String((req.query || {}).payment_id || (req.query || {}).collection_id || '');
  if (!/^MIN-\d+$/.test(id)) return send(res, 400, { error: 'Pedido inválido' });
  try {
    let o = null;
    if (/^\d+$/.test(pid)) o = await syncPayment(pid, id).catch(() => null);
    if (!o) { const rows = await db(`orders?id=eq.${id}&select=id,pago_estado,estado,total,flete`); o = Array.isArray(rows) ? rows[0] : null; }
    if (!o) return send(res, 404, { error: 'Pedido no encontrado' });
    send(res, 200, { id: o.id, pago: o.pago_estado, estado: o.estado, total: o.total, flete: o.flete });
  } catch (e) {
    send(res, 500, { error: 'No se pudo consultar el pedido' });
  }
};
