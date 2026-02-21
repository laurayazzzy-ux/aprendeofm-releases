const db = require('../config/db');

function getDevicesByLicense(licenseId) {
  const rows = db.prepare(
    `SELECT * FROM devices WHERE license_id = ? ORDER BY last_seen DESC`
  ).all(licenseId);
  // Parse hardware_info JSON
  return rows.map(r => ({
    ...r,
    hardware_info: r.hardware_info ? JSON.parse(r.hardware_info) : null
  }));
}

function deleteDevice(deviceId) {
  const result = db.prepare(`DELETE FROM devices WHERE id = ?`).run(deviceId);
  return result.changes > 0;
}

function updateHeartbeat(licenseId, fingerprint) {
  const result = db.prepare(
    `UPDATE devices SET last_seen = datetime('now') WHERE license_id = ? AND fingerprint = ?`
  ).run(licenseId, fingerprint);
  return result.changes > 0;
}

module.exports = {
  getDevicesByLicense,
  deleteDevice,
  updateHeartbeat
};
