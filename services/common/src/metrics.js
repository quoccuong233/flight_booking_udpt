const client = require('prom-client');
const { serviceName } = require('./logger');

client.register.setDefaultLabels({ service: serviceName });
client.collectDefaultMetrics();

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const outboxPending = new client.Gauge({
  name: 'outbox_pending_events',
  help: 'Outbox events not yet published',
});

const circuitOpen = new client.Gauge({
  name: 'circuit_breaker_open',
  help: '1 when the circuit breaker is open',
  labelNames: ['name'],
});

module.exports = { metrics: client, httpDuration, outboxPending, circuitOpen };
