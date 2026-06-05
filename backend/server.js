const express = require('express');
const cors = require('cors');
const passport = require('passport');
const { connectWithRetry } = require('./config/db');
require('dotenv').config();

// Initialize passport configurations
require('./config/passport');

const app = express();
const port = process.env.PORT || 3000;

// Middleware configurations
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(passport.initialize());

// Import routes
const authRoutes = require('./routes/auth').router;
const evaluationRoutes = require('./routes/evaluation');
const employeeRoutes = require('./routes/employees');

// Register routes
app.use('/api/auth', authRoutes);
app.use('/api/evaluation', evaluationRoutes);
app.use('/api/employees', employeeRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Boardroom AI Simulation Engine' });
});

// Wait for DB, run migrations, then listen
const { runMigrations } = require('./migrations/runner');

connectWithRetry()
  .then(() => runMigrations())
  .then(() => {
    app.listen(port, () => {
      console.log(`Backend server running on port ${port}`);
    });
  })
  .catch(err => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
