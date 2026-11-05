const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const {
  addEvent, createApp, createPool, serve, signToken, requireAuth, HttpError, logger,
  startMessaging, startOutboxPublisher, withTx,
} = require('@flight/common');

const pool = createPool();
const app = createApp({ pool });

const MIN_PASSWORD_LENGTH = 6;
const MAX_NAME_LENGTH = 100;
const MAX_AVATAR_LENGTH = 90000; // stays under the 100kb body limit
const AVATAR_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  fullName: user.full_name,
  role: user.role,
  avatar: user.avatar,
  createdAt: user.created_at,
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, fullName } = req.body ?? {};
  const normalizedEmail = String(email ?? '').trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new HttpError(400, 'Email không hợp lệ');
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, 'Mật khẩu cần ít nhất 6 ký tự');
  }
  if (!fullName?.trim()) throw new HttpError(400, 'Vui lòng nhập họ tên');

  const hash = await bcrypt.hash(password, 10);
  // The welcome email goes through the outbox, so a mail outage never blocks sign-up.
  const user = await withTx(pool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (id, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING *`,
      [randomUUID(), normalizedEmail, hash, fullName.trim()]
    );
    if (rows.length === 0) throw new HttpError(409, 'Email đã được đăng ký');

    await addEvent(client, 'user.registered', {
      user_id: rows[0].id,
      user_email: rows[0].email,
      full_name: rows[0].full_name,
    }, req.correlationId);
    return rows[0];
  });

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [
    String(email ?? '').trim().toLowerCase(),
  ]);
  const user = rows[0];
  const matches = user && (await bcrypt.compare(String(password ?? ''), user.password_hash));
  if (!matches) throw new HttpError(401, 'Sai email hoặc mật khẩu');

  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (rows.length === 0) throw new HttpError(404, 'Không tìm thấy người dùng');
  res.json({ user: publicUser(rows[0]) });
});

// The token carries the name, so a new one is issued with the change.
app.patch('/api/auth/me', requireAuth, async (req, res) => {
  const fullName = String(req.body?.fullName ?? '').trim();
  if (!fullName) throw new HttpError(400, 'Vui lòng nhập họ tên');
  if (fullName.length > MAX_NAME_LENGTH) throw new HttpError(400, 'Họ tên quá dài');

  const { rows } = await pool.query(
    'UPDATE users SET full_name = $2 WHERE id = $1 RETURNING *',
    [req.user.id, fullName]
  );
  if (rows.length === 0) throw new HttpError(404, 'Không tìm thấy người dùng');
  res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
});

async function saveAvatar(userId, avatar) {
  const { rows } = await pool.query(
    'UPDATE users SET avatar = $2 WHERE id = $1 RETURNING *',
    [userId, avatar]
  );
  if (rows.length === 0) throw new HttpError(404, 'Không tìm thấy người dùng');
  return { user: publicUser(rows[0]) };
}

// The browser resizes the picture first, so only a small JPEG data URL is accepted.
app.put('/api/auth/me/avatar', requireAuth, async (req, res) => {
  const image = req.body?.image;
  if (typeof image !== 'string' || !AVATAR_PATTERN.test(image)) {
    throw new HttpError(400, 'Ảnh đại diện không hợp lệ');
  }
  if (image.length > MAX_AVATAR_LENGTH) throw new HttpError(400, 'Ảnh đại diện quá lớn');
  res.json(await saveAvatar(req.user.id, image));
});

app.delete('/api/auth/me/avatar', requireAuth, async (req, res) => {
  res.json(await saveAvatar(req.user.id, null));
});

app.post('/api/auth/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, 'Mật khẩu mới cần ít nhất 6 ký tự');
  }
  if (newPassword === currentPassword) {
    throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại');
  }

  await withTx(pool, async (client) => {
    const { rows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const user = rows[0];
    if (!user) throw new HttpError(404, 'Không tìm thấy người dùng');
    if (!(await bcrypt.compare(String(currentPassword ?? ''), user.password_hash))) {
      throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
    }

    await client.query(
      'UPDATE users SET password_hash = $2 WHERE id = $1',
      [user.id, await bcrypt.hash(newPassword, 10)]
    );
    await addEvent(client, 'user.password_changed', {
      user_id: user.id,
      user_email: user.email,
      full_name: user.full_name,
    }, req.correlationId);
  });

  res.sendStatus(204);
});

async function seedAdmin() {
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, role)
     VALUES ($1, $2, $3, 'Quản trị viên', 'admin')
     ON CONFLICT (email) DO NOTHING`,
    [randomUUID(), process.env.ADMIN_EMAIL || 'admin@flight.local', hash]
  );
}

const stopMessaging = startMessaging();
const stopPublisher = startOutboxPublisher(pool);
seedAdmin().catch((err) => logger.error({ err }, 'admin seed failed'));

serve(app, {
  pool,
  onShutdown: async () => {
    stopPublisher();
    await stopMessaging();
  },
});
