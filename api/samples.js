// POST /api/samples — guarda una solicitud de muestras de tela gratis (sin pago).
// Pide la aceptación del Aviso de privacidad y guarda su evidencia, igual que el checkout.
const { db, readBody, send, mail, ZONAS } = require('./_lib');
const AVISOS = process.env.AVISOS_EMAIL || 'infominmx@gmail.com';    // a quién le llega el aviso de cada solicitud
const PRIVACIDAD_VERSION = '2026-09-29';

const CAMPOS = ['nombre', 'email', 'tel', 'calle', 'colonia', 'cp', 'zona'];
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  try {
    const body = await readBody(req);
    if (body.web) return send(res, 200, { ok: true });          // campo trampa: solo lo llenan los bots
    const c = body.customer || {};
    const customer = {};
    for (const f of CAMPOS) {
      customer[f] = clip(c[f], 200);
      if (!customer[f]) return send(res, 400, { error: `Falta el campo: ${f}` });
    }
    customer.refs = clip(c.refs, 300);
    if (!ZONAS.includes(customer.zona)) return send(res, 400, { error: 'Zona fuera de cobertura' });
    if (!/^\S+@\S+\.\S+$/.test(customer.email)) return send(res, 400, { error: 'Correo inválido' });
    if (!/^\d{5}$/.test(customer.cp)) return send(res, 400, { error: 'El código postal debe tener 5 dígitos' });
    if (body.okPrivacidad !== true) return send(res, 400, { error: 'Debes aceptar el Aviso de privacidad' });
    const aceptacion = {
      version: PRIVACIDAD_VERSION, at: Date.now(), privacidad: true,
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
      ua: String(req.headers['user-agent'] || '').slice(0, 200)
    };
    await db('sample_requests', { method: 'POST', body: { customer, aceptacion }, prefer: 'return=minimal' });
    await mail(AVISOS, `Nueva solicitud de muestras — ${customer.nombre}`,
      `Alguien pidió muestras de tela.\n\n${customer.nombre}\nCorreo: ${customer.email}\nWhatsApp: ${customer.tel} (https://wa.me/52${customer.tel.replace(/\D/g, '').slice(-10)})\n\n` +
      `${customer.calle}, ${customer.colonia}\nC.P. ${customer.cp} · ${customer.zona}${customer.refs ? '\nReferencias: ' + customer.refs : ''}\n\nMárcala como enviada en el ERP → Muestras.`).catch(() => false);
    send(res, 200, { ok: true });
  } catch (e) {
    console.error('samples error', e.message);
    send(res, 500, { error: 'No pudimos guardar tu solicitud. Intenta de nuevo en un momento.' });
  }
};
