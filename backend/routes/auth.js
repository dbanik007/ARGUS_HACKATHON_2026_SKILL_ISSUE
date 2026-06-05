const express = require('express');
const router = express.Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const jwtSecret = process.env.JWT_SECRET || 'super-secret-jwt-key';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';

// Real Google OAuth Redirect
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Google Callback Endpoint
router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
  const token = jwt.sign({ id: req.user.id, email: req.user.email, name: req.user.name }, jwtSecret, { expiresIn: '24h' });
  res.redirect(`${frontendUrl}/login?token=${token}`);
});

// Mock Login Bypass for Local/Docker Dev (Extremely Useful for Hackathon Grading)
router.get('/mock-login', async (req, res) => {
  try {
    const mockId = 'mock-google-user-12345';
    const email = 'boardroom.tester@example.com';
    const name = 'Executive Boardroom Tester';
    const picture = 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=120';

    // Look up or insert
    let userRes = await pool.query('SELECT * FROM users WHERE google_id = $1', [mockId]);
    let user;

    if (userRes.rows.length > 0) {
      user = userRes.rows[0];
    } else {
      const insertRes = await pool.query(
        'INSERT INTO users (google_id, email, name, picture) VALUES ($1, $2, $3, $4) RETURNING *',
        [mockId, email, name, picture]
      );
      user = insertRes.rows[0];
    }

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, picture: user.picture }, jwtSecret, { expiresIn: '24h' });
    res.json({ token, user });
  } catch (err) {
    console.error('Mock login failed:', err);
    res.status(500).json({ error: 'Mock login failed' });
  }
});

// Verify Current Token (Middleware support)
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, jwtSecret, (err, user) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

router.get('/me', authenticateJWT, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length > 0) {
      res.json(userRes.rows[0]);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Auth check failed' });
  }
});

module.exports = {
  router,
  authenticateJWT
};
