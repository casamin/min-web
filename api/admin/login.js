// POST /api/admin/login — reemplaza el password hardcodeado en erp.js del mockup.
// Ni la contraseña ni la comparación viven en el cliente: todo pasa por aquí, sobre HTTPS.
const { readBody, send, safeEqual, makeSession, setSession, cors } = require('../_lib');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  const { password } = await readBody(req);
  const real = process.env.ADMIN_PASSWORD;
  if (!real) return send(res, 500, { error: 'ADMIN_PASSWORD no configurada en Vercel' });
  if (!password || !safeEqual(password, real)) return send(res, 401, { error: 'Contraseña incorrecta' });
  setSession(res, makeSession(), 12 * 3600);
  send(res, 200, { ok: true });
};
