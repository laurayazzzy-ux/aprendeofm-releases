const { net } = require('electron');

let heartbeatInterval = null;
let failCount = 0;
const MAX_FAILS = 3;
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function startHeartbeat(serverUrl, token, fingerprint, onFail) {
  stopHeartbeat();
  failCount = 0;

  heartbeatInterval = setInterval(async () => {
    try {
      const response = await netFetch(serverUrl + '/api/license/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ fingerprint })
      });

      if (response.ok) {
        failCount = 0;
      } else {
        failCount++;
        console.log(`Heartbeat failed (${failCount}/${MAX_FAILS})`);
        if (failCount >= MAX_FAILS && onFail) {
          stopHeartbeat();
          onFail('La licencia ya no es válida.');
        }
      }
    } catch (err) {
      failCount++;
      console.log(`Heartbeat error (${failCount}/${MAX_FAILS}):`, err.message);
      if (failCount >= MAX_FAILS && onFail) {
        stopHeartbeat();
        onFail('No se puede conectar al servidor de licencias.');
      }
    }
  }, INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

async function netFetch(url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const request = net.request({
      method: options.method || 'GET',
      url: url
    });

    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        request.setHeader(key, value);
      }
    }

    request.on('response', (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          json: () => JSON.parse(data),
          text: () => data
        });
      });
    });

    request.on('error', reject);

    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

module.exports = { startHeartbeat, stopHeartbeat };
