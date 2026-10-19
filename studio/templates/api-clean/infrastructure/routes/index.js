const express = require('express');

const router = express.Router();

router.get('/healthcheck', (req, res) => {
  res.status(200).json({ status: 'ok', service: '{{name}}' });
});

module.exports = router;
