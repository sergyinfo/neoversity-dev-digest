const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

if (!SECRET || Buffer.byteLength(SECRET) < 32) {
  throw new Error('JWT_SECRET must be set to at least 32 bytes');
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(header.slice(7).trim(), SECRET, {
      algorithms: ['HS256'],
    });
    if (typeof payload.userId !== 'string') {
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

module.exports = { requireAuth };
