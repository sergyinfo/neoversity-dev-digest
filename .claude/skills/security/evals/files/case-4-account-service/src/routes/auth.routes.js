const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const User = require('../models/user.model');
const PasswordReset = require('../models/password-reset.model');
const { JWT_SECRET, TOKEN_TTL } = require('../config/env');
const { normalizeIdentifier } = require('../lib/identifier');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', loginLimiter, async (req, res, next) => {
  try {
    const email = normalizeIdentifier(String(req.body.email || ''));
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || !name) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    await User.create({ email, password, name });
    return res.status(202).json({ message: 'Check your inbox to finish signing up.' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(202).json({ message: 'Check your inbox to finish signing up.' });
    }
    return next(err);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = normalizeIdentifier(req.body.email);
    const user = await User.findOne({ email, isActive: true }).select('+password');
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await user.comparePassword(String(req.body.password || ''));
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email, role: user.role },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: TOKEN_TTL }
    );

    return res.json({ token });
  } catch (err) {
    return next(err);
  }
});

router.post('/password-reset/confirm', resetLimiter, async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');

    if (token.length !== 64 || password.length < 12) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await PasswordReset.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const user = await User.findById(record.user).select('+password');
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    user.password = password;
    await user.save();

    record.usedAt = new Date();
    await record.save();

    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
