const express = require('express');
const rateLimit = require('express-rate-limit');

const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/posts.controller');

const router = express.Router();

const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/', controller.list);
router.get('/search', controller.search);
router.get('/:id', controller.getOne);

router.use(requireAuth);

router.post('/', controller.create);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);
router.get('/:id/export', exportLimiter, controller.exportPdf);
router.get('/:id/export/branded', exportLimiter, controller.exportBranded);

module.exports = router;
