const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { pool } = require('./db');
require('dotenv').config();

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
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

const isMock = !googleClientId || googleClientId === 'mock-google-client-id' || googleClientId === 'mock-client-id';

if (!isMock) {
  // Register Real Google Strategy
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

      // Check if user exists by google_id
      let userRes = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
      if (userRes.rows.length > 0) {
        return done(null, userRes.rows[0]);
      }

      // Check if user exists by email (account linking)
      let emailRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (emailRes.rows.length > 0) {
        const updateRes = await pool.query(
          'UPDATE users SET google_id = $1, name = COALESCE(name, $2), picture = COALESCE(picture, $3) WHERE email = $4 RETURNING *',
          [googleId, name, picture, email]
        );
        return done(null, updateRes.rows[0]);
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
  console.log("Real Google OAuth Passport Strategy registered.");
} else {
  // Register Custom Mock Google Strategy
  const Strategy = require('passport-strategy');
  class MockGoogleStrategy extends Strategy {
    constructor(options, verify) {
      super();
      this.name = 'google';
      this.verify = verify;
      this.callbackURL = options.callbackURL;
    }
    authenticate(req, options) {
      if (req.query.code === 'mock-auth-code') {
        const profile = {
          id: req.query.email ? `mock-google-${req.query.email}` : 'mock-google-user-12345',
          displayName: req.query.name || 'Executive Boardroom Tester',
          emails: [{ value: req.query.email || 'boardroom.tester@example.com' }],
          photos: [{ value: req.query.picture || 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=120' }]
        };
        this.verify('mock-access-token', 'mock-refresh-token', profile, (err, user) => {
          if (err) return this.error(err);
          this.success(user);
        });
      } else {
        const redirectUrl = `${backendUrl}/api/auth/google/mock-consent?redirect_uri=${encodeURIComponent(this.callbackURL)}`;
        this.redirect(redirectUrl);
      }
    }
  }

  passport.use(new MockGoogleStrategy({
    callbackURL: `${backendUrl}/api/auth/google/callback`
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const name = profile.displayName;
      const picture = profile.photos[0] ? profile.photos[0].value : '';
      const googleId = profile.id;

      // Check if user exists by google_id
      let userRes = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
      if (userRes.rows.length > 0) {
        return done(null, userRes.rows[0]);
      }

      // Check if user exists by email (account linking)
      let emailRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (emailRes.rows.length > 0) {
        const updateRes = await pool.query(
          'UPDATE users SET google_id = $1, name = COALESCE(name, $2), picture = COALESCE(picture, $3) WHERE email = $4 RETURNING *',
          [googleId, name, picture, email]
        );
        return done(null, updateRes.rows[0]);
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
  console.log("Mock Google OAuth Passport Strategy registered (local consent screen fallback).");
}

module.exports = passport;
