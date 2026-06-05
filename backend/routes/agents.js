'use strict';
const express = require('express');
const router = express.Router();
const { getConfigs, updateConfigs } = require('../services/agentConfigs');
const { authenticateJWT } = require('./auth');

// Get current agent configurations
router.get('/config', authenticateJWT, (req, res) => {
  res.json(getConfigs());
});

// Update agent configurations
router.put('/config', authenticateJWT, (req, res) => {
  try {
    const newConfigs = req.body;
    updateConfigs(newConfigs);
    res.json({ success: true, configs: getConfigs() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update configurations' });
  }
});

module.exports = router;
