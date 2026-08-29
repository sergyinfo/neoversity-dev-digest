const jwt = require('jsonwebtoken');

const { JWT_SECRET } = require('../config/env');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    };
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }

  return next();
}

function requireRole(...roles) {
  return function guard(req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole, extractToken };
