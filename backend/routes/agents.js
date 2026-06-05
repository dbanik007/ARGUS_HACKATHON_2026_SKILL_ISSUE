'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { getConfigsForUser, updateConfigsForUser } = require('../services/agentConfigs');
const { authenticateJWT } = require('./auth');

router.get('/config', authenticateJWT, async (req, res) => {
  try {
    const configs = await getConfigsForUser(pool, req.user.id);
    res.json(configs);
  } catch (err) {
    console.error('Failed to get agent configs:', err);
    res.status(500).json({ error: 'Failed to retrieve agent configurations.' });
  }
});

router.put('/config', authenticateJWT, async (req, res) => {
  try {
    const configs = await updateConfigsForUser(pool, req.user.id, req.body);
    res.json({ success: true, configs });
  } catch (err) {
    console.error('Failed to update agent configs:', err);
    res.status(500).json({ error: 'Failed to update agent configurations.' });
  }
});

module.exports = router;
