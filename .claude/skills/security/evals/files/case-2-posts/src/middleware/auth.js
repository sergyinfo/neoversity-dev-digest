const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(header.slice(7).trim(), SECRET, {
      algorithms: ['HS256'],
    });
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
