// GET /api/admin/orders            -> lista todos los pedidos (dashboard, producción, envíos)
// PATCH /api/admin/orders?id=MIN-1001 -> actualiza estado/notas/envio/produccion de un pedido
// Toda la sesión se valida con isAdmin() (cookie HMAC firmada) — nunca con un password plano en el cliente.
const { isAdmin, db, rowToOrder, readBody, send } = require('../_lib');

module.exports = async (req, res) => {
  if (!isAdmin(req)) return send(res, 401, { error: 'No autorizado' });

  if (req.method === 'GET') {
    const rows = await db('orders');
    return send(res, 200, (rows || []).map(rowToOrder));
  }

  if (req.method === 'PATCH') {
    const id = req.query?.id;
    if (!id) return send(res, 400, { error: 'Falta id de pedido' });
    const body = await readBody(req);
    const allowed = ['estado', 'notas', 'envio', 'produccion'];
    const patch = {};
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    if (!Object.keys(patch).length) return send(res, 400, { error: 'Nada que actualizar' });
    const rows = await db(`orders?id=eq.${id}`, { method: 'PATCH', body: patch });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return send(res, 404, { error: 'Pedido no encontrado' });
    return send(res, 200, rowToOrder(row));
  }

  send(res, 405, { error: 'Método no permitido' });
};
