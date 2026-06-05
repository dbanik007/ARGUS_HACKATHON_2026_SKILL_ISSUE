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
  origin: '*', // For hackathon flexibility
  credentials: true
}));
app.use(express.json());
app.use(passport.initialize());

// Import routes
const authRoutes = require('./routes/auth').router;
const evaluationRoutes = require('./routes/evaluation');

// Register routes
app.use('/api/auth', authRoutes);
app.use('/api/evaluation', evaluationRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Boardroom AI Simulation Engine' });
});

// Wait for DB, then listen
connectWithRetry()
  .then(() => {
    app.listen(port, () => {
      console.log(`Backend server running on port ${port}`);
    });
  })
  .catch(err => {
    console.error('Failed to start server due to database connection error:', err.message);
    process.exit(1);
  });
