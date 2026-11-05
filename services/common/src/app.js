const { randomUUID } = require('node:crypto');
const express = require('express');
const { logger } = require('./logger');
const { metrics, httpDuration } = require('./metrics');

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function createApp({ pool }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use((req, res, next) => {
    req.correlationId = req.get('X-Correlation-ID') || randomUUID();
    req.log = logger.child({ correlationId: req.correlationId });
    res.set('X-Correlation-ID', req.correlationId);

    const end = httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      end({ method: req.method, route, status: res.statusCode });
      if (!req.path.startsWith('/health') && req.path !== '/metrics') {
        req.log.info({ method: req.method, path: req.path, status: res.statusCode }, 'request');
      }
    });
    next();
  });

  app.get('/health/live', (req, res) => res.sendStatus(200));

  // Only the database decides readiness: the services keep working correctly
  // without Redis or RabbitMQ, so those must not take an instance out of Kong.
  app.get('/health/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.sendStatus(200);
    } catch {
      res.sendStatus(503);
    }
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.send(await metrics.register.metrics());
  });

  return app;
}

function finishApp(app) {
  app.use((req, res) => res.status(404).json({ message: 'Không tìm thấy' }));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.status) {
      if (err.status >= 500) req.log.warn({ err }, 'request failed');
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    req.log.error({ err }, 'unhandled error');
    return res.status(500).json({ message: 'Lỗi hệ thống' });
  });
}

// Graceful shutdown: finish in-flight requests, then close resources.
function serve(app, { pool, port = 3000, onShutdown }) {
  finishApp(app);
  const server = app.listen(port, () => logger.info({ port }, 'service started'));

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    const forceExit = setTimeout(() => process.exit(1), 10000);
    forceExit.unref();

    server.close(async () => {
      try {
        await onShutdown?.();
        await pool.end();
      } catch (err) {
        logger.error({ err }, 'shutdown error');
      }
      process.exit(0);
    });
    server.closeIdleConnections();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

module.exports = { createApp, serve, HttpError };
