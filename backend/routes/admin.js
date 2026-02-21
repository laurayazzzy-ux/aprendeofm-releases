const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const keyService = require('../services/keyService');
const deviceService = require('../services/deviceService');
const { generateToken, adminAuth } = require('../middleware/auth');
const { adminLoginLimiter } = require('../middleware/rateLimit');

// POST /api/admin/login
router.post('/login', adminLoginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
    }

    const admin = db.prepare(`SELECT * FROM admin_users WHERE username = ?`).get(username);

    if (!admin) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      const ip = req.ip || req.connection.remoteAddress;
      keyService.logAudit('admin_login_failed', { username }, ip);
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const token = generateToken({ role: 'admin', adminId: admin.id, username: admin.username }, '8h');

    const ip = req.ip || req.connection.remoteAddress;
    keyService.logAudit('admin_login', { username }, ip);

    return res.json({ token, username: admin.username });
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// GET /api/admin/keys
router.get('/keys', adminAuth, (req, res) => {
  try {
    const keys = keyService.getAllKeys();
    return res.json(keys);
  } catch (err) {
    console.error('Get keys error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// POST /api/admin/keys - Create new key
router.post('/keys', adminAuth, (req, res) => {
  try {
    const { maxDevices, expiresAt, note } = req.body;
    const rawKey = keyService.createKey({
      maxDevices: maxDevices || 1,
      expiresAt: expiresAt || null,
      note: note || ''
    });

    const ip = req.ip || req.connection.remoteAddress;
    keyService.logAudit('key_created', { note, maxDevices }, ip);

    return res.json({ key: rawKey, message: 'Clave creada. Guárdala, no se puede recuperar.' });
  } catch (err) {
    console.error('Create key error:', err);
    return res.status(500).json({ error: 'Error al crear la clave.' });
  }
});

// PUT /api/admin/keys/:id
router.put('/keys/:id', adminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { maxDevices, expiresAt, note, status } = req.body;

    const key = keyService.getKeyById(id);
    if (!key) return res.status(404).json({ error: 'Clave no encontrada.' });

    keyService.updateKey(id, { maxDevices, expiresAt, note, status });

    const ip = req.ip || req.connection.remoteAddress;
    keyService.logAudit('key_updated', { keyId: id }, ip);

    return res.json({ message: 'Clave actualizada.' });
  } catch (err) {
    console.error('Update key error:', err);
    return res.status(500).json({ error: 'Error al actualizar.' });
  }
});

// DELETE /api/admin/keys/:id
router.delete('/keys/:id', adminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const key = keyService.getKeyById(id);
    if (!key) return res.status(404).json({ error: 'Clave no encontrada.' });

    keyService.deleteKey(id);

    const ip = req.ip || req.connection.remoteAddress;
    keyService.logAudit('key_deleted', { keyId: id }, ip);

    return res.json({ message: 'Clave eliminada.' });
  } catch (err) {
    console.error('Delete key error:', err);
    return res.status(500).json({ error: 'Error al eliminar.' });
  }
});

// PUT /api/admin/keys/:id/status
router.put('/keys/:id/status', adminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended', 'revoked', 'expired'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido.' });
    }

    const key = keyService.getKeyById(id);
    if (!key) return res.status(404).json({ error: 'Clave no encontrada.' });

    keyService.updateKeyStatus(id, status);

    const ip = req.ip || req.connection.remoteAddress;
    keyService.logAudit('key_status_changed', { keyId: id, oldStatus: key.status, newStatus: status }, ip);

    return res.json({ message: `Estado cambiado a "${status}".` });
  } catch (err) {
    console.error('Status change error:', err);
    return res.status(500).json({ error: 'Error al cambiar estado.' });
  }
});

// GET /api/admin/keys/:id/devices
router.get('/keys/:id/devices', adminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const devices = deviceService.getDevicesByLicense(id);
    return res.json(devices);
  } catch (err) {
    console.error('Get devices error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// DELETE /api/admin/devices/:id
router.delete('/devices/:id', adminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const deleted = deviceService.deleteDevice(id);
    if (!deleted) return res.status(404).json({ error: 'Dispositivo no encontrado.' });

    const ip = req.ip || req.connection.remoteAddress;
    keyService.logAudit('device_deleted', { deviceId: id }, ip);

    return res.json({ message: 'Dispositivo eliminado.' });
  } catch (err) {
    console.error('Delete device error:', err);
    return res.status(500).json({ error: 'Error al eliminar dispositivo.' });
  }
});

// GET /api/admin/logs
router.get('/logs', adminAuth, (req, res) => {
  try {
    const { action, limit = 100, offset = 0 } = req.query;

    let query = `SELECT * FROM audit_logs`;
    const params = [];

    if (action) {
      query += ` WHERE action = ?`;
      params.push(action);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const rows = db.prepare(query).all(...params);
    // Parse JSON details
    const parsed = rows.map(r => ({
      ...r,
      details: r.details ? JSON.parse(r.details) : null
    }));
    return res.json(parsed);
  } catch (err) {
    console.error('Get logs error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

module.exports = router;
