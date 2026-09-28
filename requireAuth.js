const jwt = require('jsonwebtoken');
const db = require('../db');

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'non authentifie' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!user) return res.status(401).json({ error: 'utilisateur introuvable' });
    req.user = user; // { id, eoc_id, email, ... }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'token invalide ou expire' });
  }
};
