const crypto = require('crypto');
const db = require('../config/db');

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O/1/I to avoid confusion
const KEY_LENGTH = 16;

function generateKey() {
  let key = '';
  const bytes = crypto.randomBytes(KEY_LENGTH);
  for (let i = 0; i < KEY_LENGTH; i++) {
    key += CHARSET[bytes[i] % CHARSET.length];
  }
  return key.match(/.{4}/g).join('-');
}

function hashKey(key, salt) {
  const normalized = key.replace(/-/g, '').toUpperCase();
  return crypto.createHash('sha256').update(normalized + salt).digest('hex');
}

function generateSalt() {
  return crypto.randomBytes(32).toString('hex');
}

function createKey(options = {}) {
  const { maxDevices = 1, expiresAt = null, note = '' } = options;
  const rawKey = generateKey();
  const salt = generateSalt();
  const keyHash = hashKey(rawKey, salt);
  const displayHint = rawKey.replace(/-/g, '').slice(0, 4) + '...';

  db.prepare(
    `INSERT INTO license_keys (key_hash, salt, display_hint, max_devices, expires_at, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(keyHash, salt, displayHint, maxDevices, expiresAt, note);

  return rawKey;
}

function validateKey(rawKey, fingerprint, hardwareInfo, ip) {
  const normalized = rawKey.replace(/-/g, '').toUpperCase();

  const keys = db.prepare(
    `SELECT id, key_hash, salt, status, max_devices, expires_at FROM license_keys`
  ).all();

  let matchedKey = null;
  for (const k of keys) {
    const hash = hashKey(normalized, k.salt);
    if (hash === k.key_hash) {
      matchedKey = k;
      break;
    }
  }

  if (!matchedKey) {
    logAudit('validate_failed', { reason: 'invalid_key' }, ip);
    return { valid: false, error: 'Clave de licencia inválida.' };
  }

  if (matchedKey.status !== 'active') {
    logAudit('validate_failed', { reason: 'key_' + matchedKey.status, keyId: matchedKey.id }, ip);
    return { valid: false, error: `Licencia ${matchedKey.status === 'suspended' ? 'suspendida' : matchedKey.status === 'revoked' ? 'revocada' : 'expirada'}.` };
  }

  if (matchedKey.expires_at && new Date(matchedKey.expires_at) < new Date()) {
    db.prepare(`UPDATE license_keys SET status = 'expired' WHERE id = ?`).run(matchedKey.id);
    logAudit('key_expired', { keyId: matchedKey.id }, ip);
    return { valid: false, error: 'La licencia ha expirado.' };
  }

  const existingDevices = db.prepare(
    `SELECT id, fingerprint FROM devices WHERE license_id = ?`
  ).all(matchedKey.id);

  const deviceExists = existingDevices.some(d => d.fingerprint === fingerprint);

  if (!deviceExists && existingDevices.length >= matchedKey.max_devices) {
    logAudit('validate_failed', { reason: 'max_devices', keyId: matchedKey.id }, ip);
    return { valid: false, error: `Límite de dispositivos alcanzado (${matchedKey.max_devices}).` };
  }

  const hwJson = JSON.stringify(hardwareInfo || {});
  if (deviceExists) {
    db.prepare(
      `UPDATE devices SET last_seen = datetime('now'), hardware_info = ? WHERE license_id = ? AND fingerprint = ?`
    ).run(hwJson, matchedKey.id, fingerprint);
  } else {
    db.prepare(
      `INSERT INTO devices (license_id, fingerprint, hardware_info) VALUES (?, ?, ?)`
    ).run(matchedKey.id, fingerprint, hwJson);
  }

  db.prepare(`UPDATE license_keys SET updated_at = datetime('now') WHERE id = ?`).run(matchedKey.id);
  logAudit('validate_success', { keyId: matchedKey.id, fingerprint }, ip);

  return { valid: true, licenseId: matchedKey.id };
}

function logAudit(action, details, ip) {
  try {
    db.prepare(
      `INSERT INTO audit_logs (action, details, ip_address) VALUES (?, ?, ?)`
    ).run(action, JSON.stringify(details), ip);
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

function getAllKeys() {
  return db.prepare(
    `SELECT lk.*,
      (SELECT COUNT(*) FROM devices d WHERE d.license_id = lk.id) as device_count
     FROM license_keys lk ORDER BY lk.created_at DESC`
  ).all();
}

function getKeyById(id) {
  return db.prepare(`SELECT * FROM license_keys WHERE id = ?`).get(id) || null;
}

function updateKey(id, updates) {
  const fields = [];
  const values = [];

  if (updates.maxDevices !== undefined) { fields.push('max_devices = ?'); values.push(updates.maxDevices); }
  if (updates.expiresAt !== undefined) { fields.push('expires_at = ?'); values.push(updates.expiresAt); }
  if (updates.note !== undefined) { fields.push('note = ?'); values.push(updates.note); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE license_keys SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function deleteKey(id) {
  db.prepare(`DELETE FROM license_keys WHERE id = ?`).run(id);
}

function updateKeyStatus(id, status) {
  db.prepare(
    `UPDATE license_keys SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, id);
}

module.exports = {
  generateKey,
  createKey,
  validateKey,
  getAllKeys,
  getKeyById,
  updateKey,
  deleteKey,
  updateKeyStatus,
  logAudit
};
