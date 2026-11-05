const os = require('node:os');
const pino = require('pino');

const serviceName = process.env.SERVICE_NAME || 'unknown';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: serviceName, instance: os.hostname() },
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = { logger, serviceName };
