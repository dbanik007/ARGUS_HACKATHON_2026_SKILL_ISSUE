const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { pool } = require('./db');
require('dotenv').config();

const googleClientId = process.env.GOOGLE_CLIENT_ID || 'mock-client-id';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || 'mock-client-secret';
const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (res.rows.length > 0) {
      done(null, res.rows[0]);
    } else {
      done(new Error('User not found'));
    }
  } catch (err) {
    done(err);
  }
});

// Configure Google Strategy if client credentials are not placeholders
if (googleClientId !== 'mock-google-client-id' && googleClientSecret !== 'mock-google-client-secret') {
  passport.use(new GoogleStrategy({
    clientID: googleClientId,
    clientSecret: googleClientSecret,
    callbackURL: `${backendUrl}/api/auth/google/callback`
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const name = profile.displayName;
      const picture = profile.photos[0] ? profile.photos[0].value : '';
      const googleId = profile.id;

      // Check if user exists
      let userRes = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
      if (userRes.rows.length > 0) {
        return done(null, userRes.rows[0]);
      }

      // Create user
      const insertRes = await pool.query(
        'INSERT INTO users (google_id, email, name, picture) VALUES ($1, $2, $3, $4) RETURNING *',
        [googleId, email, name, picture]
      );
      done(null, insertRes.rows[0]);
    } catch (err) {
      done(err);
    }
  }));
} else {
  console.log("Using Mock Google OAuth authentication strategy (client ID/secret not configured).");
}

module.exports = passport;
