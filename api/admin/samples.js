// GET   /api/admin/samples          -> lista las solicitudes de muestras (más recientes primero)
// PATCH /api/admin/samples?id=12    -> cambia estado ('pendiente' | 'enviada' | 'cancelada') y/o notas
const { isAdmin, db, readBody, send } = require('../_lib');
const ESTADOS = ['pendiente', 'enviada', 'cancelada'];

module.exports = async (req, res) => {
  if (!isAdmin(req)) return send(res, 401, { error: 'No autorizado' });

  if (req.method === 'GET') {
    const rows = await db('sample_requests?select=*&order=created_at.desc&limit=500');
    return send(res, 200, rows || []);
  }

  if (req.method === 'PATCH') {
    const id = parseInt(req.query?.id, 10);
    if (!id) return send(res, 400, { error: 'Falta id de solicitud' });
    const body = await readBody(req);
    const patch = {};
    if (body.estado !== undefined) {
      if (!ESTADOS.includes(body.estado)) return send(res, 400, { error: 'Estado inválido' });
      patch.estado = body.estado;
      patch.enviada_at = body.estado === 'enviada' ? new Date().toISOString() : null;
    }
    if (body.notas !== undefined) patch.notas = String(body.notas).slice(0, 500);
    if (!Object.keys(patch).length) return send(res, 400, { error: 'Nada que actualizar' });
    const rows = await db(`sample_requests?id=eq.${id}`, { method: 'PATCH', body: patch });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return send(res, 404, { error: 'Solicitud no encontrada' });
    return send(res, 200, row);
  }

  send(res, 405, { error: 'Método no permitido' });
};
