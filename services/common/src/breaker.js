const CircuitBreaker = require('opossum');
const { HttpError } = require('./app');
const { logger } = require('./logger');
const { circuitOpen } = require('./metrics');

function createBreaker(name, fn, { unavailableMessage, ...options }) {
  const breaker = new CircuitBreaker(fn, {
    name,
    timeout: 3000,
    errorThresholdPercentage: 50,
    // Slow failures (timeouts) arrive seconds apart, split across instances, so the
    // window must be long enough for a few of them to count on one instance.
    rollingCountTimeout: 30000,
    volumeThreshold: 3,
    resetTimeout: 10000,
    errorFilter: (err) => err instanceof HttpError,
    ...options,
  });

  circuitOpen.set({ name }, 0);
  breaker.on('open', () => {
    circuitOpen.set({ name }, 1);
    logger.warn({ breaker: name }, 'circuit opened');
  });
  breaker.on('close', () => {
    circuitOpen.set({ name }, 0);
    logger.info({ breaker: name }, 'circuit closed');
  });

  // An HttpError from fn is a business answer: it passes through untouched.
  return async (...args) => {
    try {
      return await breaker.fire(...args);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(503, unavailableMessage, 'DEPENDENCY_UNAVAILABLE');
    }
  };
}

module.exports = { createBreaker };
