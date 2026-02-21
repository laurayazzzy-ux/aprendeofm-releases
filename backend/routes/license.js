const express = require('express');
const router = express.Router();
const keyService = require('../services/keyService');
const deviceService = require('../services/deviceService');
const { generateToken, licenseAuth } = require('../middleware/auth');
const { validateLimiter } = require('../middleware/rateLimit');

// POST /api/license/validate
router.post('/validate', validateLimiter, (req, res) => {
  try {
    const { key, fingerprint, hardwareInfo } = req.body;

    if (!key || !fingerprint) {
      return res.status(400).json({ error: 'Clave y fingerprint son requeridos.' });
    }

    const ip = req.ip || req.connection.remoteAddress;
    const result = keyService.validateKey(key, fingerprint, hardwareInfo, ip);

    if (!result.valid) {
      return res.status(403).json({ valid: false, error: result.error });
    }

    const token = generateToken({
      role: 'license',
      licenseId: result.licenseId,
      fingerprint
    });

    return res.json({ valid: true, token });
  } catch (err) {
    console.error('Validation error:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/license/heartbeat
router.post('/heartbeat', licenseAuth, (req, res) => {
  try {
    const { licenseId, fingerprint } = req.license;

    const key = keyService.getKeyById(licenseId);
    if (!key || key.status !== 'active') {
      return res.status(403).json({ valid: false, error: 'Licencia ya no está activa.' });
    }

    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      keyService.updateKeyStatus(licenseId, 'expired');
      return res.status(403).json({ valid: false, error: 'La licencia ha expirado.' });
    }

    deviceService.updateHeartbeat(licenseId, fingerprint);

    return res.json({ valid: true });
  } catch (err) {
    console.error('Heartbeat error:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
