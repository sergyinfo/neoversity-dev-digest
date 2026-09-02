const express = require('express');

const router = express.Router();

router.get('/:id', (req, res) => {
  res.status(501).json({ error: 'Wired up in the posts service' });
});

module.exports = router;
