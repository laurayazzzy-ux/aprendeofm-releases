const crypto = require('crypto');
const os = require('os');
const { machineIdSync } = require('node-machine-id');

function getFingerprint() {
  const machineId = machineIdSync(true);
  const cpuModel = os.cpus()[0]?.model || 'unknown';
  const totalRAM = os.totalmem().toString();
  const platform = os.platform();
  const arch = os.arch();

  const raw = `${machineId}|${cpuModel}|${totalRAM}|${platform}|${arch}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getHardwareInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model || 'unknown',
    ram: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + ' GB',
    hostname: os.hostname()
  };
}

module.exports = { getFingerprint, getHardwareInfo };
