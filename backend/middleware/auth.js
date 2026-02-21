const jwt = require('jsonwebtoken');
require('dotenv').config({ path: __dirname + '/../.env' });

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

function generateToken(payload, expiresIn) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '24h' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido.' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

function licenseAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido.' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (decoded.role !== 'license') {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }
    req.license = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

module.exports = { generateToken, verifyToken, adminAuth, licenseAuth };
