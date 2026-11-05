const { randomUUID } = require('node:crypto');
const amqp = require('amqplib');
const { logger } = require('./logger');
const { outboxPending } = require('./metrics');
const { withTx } = require('./db');

const EXCHANGE = 'events';
const DEAD_LETTER_EXCHANGE = 'events.dlx';
const MAX_ATTEMPTS = 3;
const PUBLISH_INTERVAL_MS = 500;
const RECONNECT_DELAY_MS = 3000;

// ---------- Transactional outbox ----------

// Must run on the same client as the business write, inside its transaction.
function addEvent(client, type, data, correlationId) {
  return client.query(
    'INSERT INTO outbox (id, type, payload, correlation_id) VALUES ($1, $2, $3, $4)',
    [randomUUID(), type, JSON.stringify(data), correlationId || null]
  );
}

// ---------- RabbitMQ connection ----------

class Rabbit {
  constructor() {
    this.channel = null; // confirm channel, null while disconnected
    this.consumers = [];
    this.stopped = false;
  }

  async start() {
    while (!this.stopped) {
      try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL);
        const reconnect = () => {
          this.channel = null;
          if (!this.stopped) setTimeout(() => this.start(), RECONNECT_DELAY_MS);
        };
        connection.once('close', reconnect);
        connection.on('error', (err) => logger.warn({ err: err.message }, 'rabbitmq error'));
        this.connection = connection;

        const channel = await connection.createConfirmChannel();
        await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
        await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
        await channel.prefetch(10);
        for (const consumer of this.consumers) await this.attach(channel, consumer);
        this.channel = channel;
        logger.info('rabbitmq connected');
        return;
      } catch (err) {
        logger.warn({ err: err.message }, 'rabbitmq connect failed, retrying');
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
      }
    }
  }

  async attach(channel, { queue, routingKeys, onMessage }) {
    await channel.assertQueue(queue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
        'x-dead-letter-routing-key': queue,
      },
    });
    await channel.assertQueue(`${queue}.dlq`, { durable: true });
    await channel.bindQueue(`${queue}.dlq`, DEAD_LETTER_EXCHANGE, queue);
    for (const key of routingKeys) await channel.bindQueue(queue, EXCHANGE, key);
    await channel.consume(queue, (message) => message && onMessage(channel, message));
  }

  async stop() {
    this.stopped = true;
    await this.connection?.close().catch(() => {});
  }
}

const rabbit = new Rabbit();

// ---------- Publisher ----------

// SKIP LOCKED lets several instances of a service publish without sending a row twice.
async function publishBatch(pool) {
  const channel = rabbit.channel;
  if (!channel) return;

  await withTx(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT id, type, payload, correlation_id, created_at FROM outbox
       WHERE published_at IS NULL
       ORDER BY created_at
       LIMIT 50
       FOR UPDATE SKIP LOCKED`
    );
    if (rows.length === 0) return;

    for (const row of rows) {
      const envelope = {
        event_id: row.id,
        type: row.type,
        occurred_at: row.created_at,
        correlation_id: row.correlation_id,
        data: row.payload,
      };
      channel.publish(EXCHANGE, row.type, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
        contentType: 'application/json',
        messageId: row.id,
        correlationId: row.correlation_id || undefined,
      });
    }
    await channel.waitForConfirms();
    await client.query('UPDATE outbox SET published_at = now() WHERE id = ANY($1)', [
      rows.map((row) => row.id),
    ]);
  });
}

function startOutboxPublisher(pool) {
  let timer;
  let stopped = false;

  const tick = async () => {
    try {
      await publishBatch(pool);
      const { rows } = await pool.query(
        'SELECT count(*)::int AS pending FROM outbox WHERE published_at IS NULL'
      );
      outboxPending.set(rows[0].pending);
    } catch (err) {
      logger.warn({ err: err.message }, 'outbox publish failed, will retry');
    }
    if (!stopped) timer = setTimeout(tick, PUBLISH_INTERVAL_MS);
  };
  tick();

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// ---------- Consumer ----------

// Delivery is at-least-once: processed_events makes the handler effectively once,
// because the handler's writes commit together with the event id.
function consume(pool, { queue, routingKeys, handler }) {
  const onMessage = async (channel, message) => {
    let event;
    try {
      event = JSON.parse(message.content.toString());
    } catch (err) {
      logger.error({ err: err.message }, 'malformed message sent to dead letter queue');
      channel.nack(message, false, false);
      return;
    }
    const log = logger.child({ correlationId: event.correlation_id, eventType: event.type });

    try {
      await withTx(pool, async (client) => {
        const { rowCount } = await client.query(
          'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
          [event.event_id]
        );
        if (rowCount === 0) {
          log.info('duplicate event skipped');
          return;
        }
        await handler(client, event, log);
      });
      channel.ack(message);
    } catch (err) {
      const attempts = (message.properties.headers?.['x-attempts'] || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        log.error({ err: err.message, attempts }, 'event sent to dead letter queue');
        channel.nack(message, false, false);
        return;
      }
      log.warn({ err: err.message, attempts }, 'event failed, retrying');
      await new Promise((resolve) => setTimeout(resolve, 500 * attempts));
      channel.sendToQueue(queue, message.content, {
        ...message.properties,
        headers: { ...message.properties.headers, 'x-attempts': attempts },
      });
      channel.ack(message);
    }
  };

  rabbit.consumers.push({ queue, routingKeys, onMessage });
}

function startMessaging() {
  rabbit.start();
  return () => rabbit.stop();
}

module.exports = { addEvent, consume, startMessaging, startOutboxPublisher };
