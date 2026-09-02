const express = require('express');

const User = require('../models/user.model');
const { requireAuth, requireRole } = require('../middleware/auth');
const { pick } = require('../lib/identifier');
const {
  PUBLIC_PROFILE_FIELDS,
  ALLOWED_PROFILE_FIELDS,
} = require('../config/fields');

const router = express.Router();

router.use(requireAuth);

router.get('/:id', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select(
      PUBLIC_PROFILE_FIELDS.join(' ')
    );
    if (!user) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(user);
  } catch (err) {
    return next(err);
  }
});

router.patch('/me', async (req, res, next) => {
  try {
    const updates = pick(req.body, ALLOWED_PROFILE_FIELDS);
    const user = await User.findByIdAndUpdate(req.user.userId, updates, {
      new: true,
      runValidators: true,
    });
    if (!user) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(user);
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const updates = pick(req.body, ALLOWED_PROFILE_FIELDS);
    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!user) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(user);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
