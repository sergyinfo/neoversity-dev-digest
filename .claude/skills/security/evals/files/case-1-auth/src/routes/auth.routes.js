const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const User = require('../models/user.model');
const { SECRET } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', async (req, res, next) => {
  try {
    const email = String(req.body.email || '');
    const password = String(req.body.password || '');
    const name = String(req.body.name || '');

    if (!email || password.length < 12 || !name) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const user = await User.create({ email, password, name });
    return res.status(201).json(user);
  } catch (err) {
    return next(err);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email, isActive: true });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await user.comparePassword(String(req.body.password || ''));
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        userId: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      },
      SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    return res.json({ token });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
