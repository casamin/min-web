const { isAdmin, send, cors } = require('../_lib');
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  const admin = isAdmin(req);
  if (!admin) return send(res, 200, { admin: false });
  // Solo para el administrador: qué está conectado (sin revelar ningún valor).
  send(res, 200, {
    admin: true,
    mp: !!process.env.MP_ACCESS_TOKEN,
    db: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    mail: !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM)
  });
};
