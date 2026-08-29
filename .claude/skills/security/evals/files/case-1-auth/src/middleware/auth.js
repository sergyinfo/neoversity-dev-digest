const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'blogapp-dev-secret';

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.decode(token);
    if (!payload || !payload.userId) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return function guard(req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole, extractToken, SECRET };
