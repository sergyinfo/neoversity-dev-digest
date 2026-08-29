const express = require('express');

const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/posts.controller');

const router = express.Router();

router.get('/', controller.list);
router.get('/:id', controller.getOne);

router.use(requireAuth);

router.post('/', controller.create);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);
router.get('/:id/export', controller.exportPdf);

module.exports = router;
