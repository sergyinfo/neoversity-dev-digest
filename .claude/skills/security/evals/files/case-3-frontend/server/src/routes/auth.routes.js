const express = require('express');

const router = express.Router();

router.post('/login', (req, res) => {
  res.status(501).json({ error: 'Moved to the auth service' });
});

module.exports = router;
