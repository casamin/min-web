const { isAdmin, send, cors } = require('../_lib');
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  send(res, 200, { admin: isAdmin(req) });
};
