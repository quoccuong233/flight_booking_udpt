const jwt = require('jsonwebtoken');
const { HttpError } = require('./app');

const JWT_ISSUER = 'flight-booking';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.full_name, role: user.role },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', issuer: JWT_ISSUER, expiresIn: '2h' }
  );
}

// Kong verifies tokens at the edge; verifying again here keeps the service safe
// from callers inside the Docker network.
function requireAuth(req, res, next) {
  const token = req.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Bạn chưa đăng nhập');
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
    });
    req.user = { id: claims.sub, email: claims.email, name: claims.name, role: claims.role };
    next();
  } catch {
    throw new HttpError(401, 'Phiên đăng nhập không hợp lệ');
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') throw new HttpError(403, 'Bạn không có quyền');
  next();
}

module.exports = { signToken, requireAuth, requireAdmin };
