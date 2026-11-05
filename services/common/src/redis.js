const { createClient } = require('redis');
const { logger } = require('./logger');

// Commands fail fast while Redis is down, so callers can fall back immediately
// instead of queueing until it returns.
function createRedis() {
  const client = createClient({
    url: process.env.REDIS_URL,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (retries) => Math.min(retries * 200, 3000),
    },
  });

  let lastLogged = 0;
  client.on('error', (err) => {
    if (Date.now() - lastLogged > 10000) {
      lastLogged = Date.now();
      logger.warn({ err: err.message }, 'redis unavailable');
    }
  });

  client.connect().catch((err) => logger.warn({ err: err.message }, 'redis connect failed'));
  return client;
}

module.exports = { createRedis };
