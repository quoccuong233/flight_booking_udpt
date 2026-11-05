const {
  createApp, createPool, createRedis, serve, startMessaging, startOutboxPublisher,
} = require('@flight/common');
const { registerRoutes } = require('./routes');
const { registerConsumers } = require('./consumers');
const { startExpiryJob } = require('./expiryJob');

const pool = createPool();
const redis = createRedis();
const app = createApp({ pool });

registerRoutes(app, { pool, redis });
registerConsumers(pool);

const stopMessaging = startMessaging();
const stopPublisher = startOutboxPublisher(pool);
const stopExpiryJob = startExpiryJob(pool);

serve(app, {
  pool,
  onShutdown: async () => {
    stopExpiryJob();
    stopPublisher();
    await stopMessaging();
  },
});
