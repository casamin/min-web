const { send, setSession, cors } = require('../_lib');
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  setSession(res, '', 0);
  send(res, 200, { ok: true });
};
