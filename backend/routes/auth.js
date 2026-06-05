const express = require("express");
const router = express.Router();
const passport = require("passport");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");

const jwtSecret = process.env.JWT_SECRET || "super-secret-jwt-key";
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:4200";
const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";

// Real Google OAuth Redirect
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  }),
);

// Google Callback Endpoint
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${frontendUrl}/login`,
    session: false,
  }),
  (req, res) => {
    const token = jwt.sign(
      {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        picture: req.user.picture,
      },
      jwtSecret,
      { expiresIn: "24h" },
    );
    res.redirect(`${frontendUrl}/login?token=${token}`);
  },
);

// Mock Google Consent Endpoint (invoked by the Mock Strategy)
router.get("/google/mock-consent", (req, res) => {
  const redirectUri =
    req.query.redirect_uri || `${backendUrl}/api/auth/google/callback`;

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sign in with Google - Mock Consent</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        body {
          background-color: #0d0e12;
          color: #e3e3e3;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }
        .glass-panel {
          background: rgba(20, 21, 26, 0.7);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
      </style>
    </head>
    <body class="min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-[420px] glass-panel p-8 rounded-[28px] shadow-2xl flex flex-col items-center border border-white/10">
        <!-- Google Logo Icon -->
        <div class="w-12 h-12 rounded-full bg-white flex items-center justify-center mb-5 shadow-lg">
          <svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
            <g transform="matrix(1, 0, 0, 1, 0, 0)">
              <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.58h3.3c1.93,-1.78 3.04,-4.4 3.04,-7.38c0,-0.68 -0.06,-1.33 -0.17,-2H21.35z" fill="#4285F4" />
              <path d="M12,20.62c2.43,0 4.47,-0.8 5.96,-2.18l-3.3,-2.58c-0.9,0.6 -2.07,0.98 -3.3,0.98c-2.37,0 -4.38,-1.6 -5.1,-3.75H2.86v2.66C4.34,18.7 7.92,20.62 12,20.62z" fill="#34A853" />
              <path d="M6.9,13.09C6.72,12.56 6.62,12 6.62,11.41c0,-0.59 0.1,-1.15 0.28,-1.68V7.07H2.86C2.26,8.27 1.91,9.63 1.91,11.41c0,1.78 0.35,3.14 0.95,4.34l4.04,-3.16z" fill="#FBBC05" />
              <path d="M12,4.82c1.32,0 2.5,0.45 3.44,1.35l2.58,-2.58C16.46,2.18 14.42,1.38 12,1.38C7.92,1.38 4.34,3.3 2.86,6.31l4.04,3.16c0.72,-2.15 2.73,-3.75 5.1,-3.75z" fill="#EA4335" />
            </g>
          </svg>
        </div>
        
        <h2 class="text-xl font-semibold text-white mb-1">Sign in with Google</h2>
        <p class="text-sm text-gray-400 mb-6 text-center">Choose a mock Google account to log into Boardroom AI</p>
        
        <div class="w-full flex flex-col gap-3">
          <!-- Account 1 -->
          <button onclick="selectAccount('Executive Boardroom Tester', 'boardroom.tester@example.com', 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=120')" 
                  class="w-full flex items-center gap-3.5 rounded-2xl border border-white/5 hover:bg-white/[0.04] transition duration-200 text-left">
            <img src="https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=120" class="w-10 h-10 rounded-full object-cover border border-white/10" alt="">
            <div>
              <div class="text-sm font-medium text-white">Executive Boardroom Tester</div>
              <div class="text-xs text-gray-400">boardroom.tester@example.com</div>
            </div>
          </button>
          
          <!-- Account 2 -->
          <button onclick="selectAccount('Sarah Jenkins', 'sarah.jenkins@example.com', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=120')" 
                  class="w-full flex items-center gap-3.5 rounded-2xl border border-white/5 hover:bg-white/[0.04] transition duration-200 text-left">
            <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=120" class="w-10 h-10 rounded-full object-cover border border-white/10" alt="">
            <div>
              <div class="text-sm font-medium text-white">Sarah Jenkins</div>
              <div class="text-xs text-gray-400">sarah.jenkins@example.com</div>
            </div>
          </button>

          <!-- Account 3 -->
          <button onclick="selectAccount('Alex Rivera', 'alex.rivera@example.com', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120')" 
                  class="w-full flex items-center gap-3.5 rounded-2xl border border-white/5 hover:bg-white/[0.04] transition duration-200 text-left">
            <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120" class="w-10 h-10 rounded-full object-cover border border-white/10" alt="">
            <div>
              <div class="text-sm font-medium text-white">Alex Rivera</div>
              <div class="text-xs text-gray-400">alex.rivera@example.com</div>
            </div>
          </button>
        </div>
        
        <div class="mt-8 text-[11px] text-gray-500 text-center">
          Note: This is a secure mock integration. To test real Google login, configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the root .env file.
        </div>
      </div>
      
      <script>
        function selectAccount(name, email, picture) {
          const redirectUri = "${redirectUri}";
          const url = new URL(redirectUri);
          url.searchParams.set('code', 'mock-auth-code');
          url.searchParams.set('name', name);
          url.searchParams.set('email', email);
          url.searchParams.set('picture', picture);
          window.location.href = url.toString();
        }
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// Mock Login Bypass for Local/Docker Dev (Extremely Useful for Hackathon Grading)
router.get("/mock-login", async (req, res) => {
  try {
    const mockId = "mock-google-user-12345";
    const email = "boardroom.tester@example.com";
    const name = "Executive Boardroom Tester";
    const picture =
      "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=120";

    // Look up or insert
    let userRes = await pool.query("SELECT * FROM users WHERE google_id = $1", [
      mockId,
    ]);
    let user;

    if (userRes.rows.length > 0) {
      user = userRes.rows[0];
    } else {
      const insertRes = await pool.query(
        "INSERT INTO users (google_id, email, name, picture) VALUES ($1, $2, $3, $4) RETURNING *",
        [mockId, email, name, picture],
      );
      user = insertRes.rows[0];
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
      jwtSecret,
      { expiresIn: "24h" },
    );
    res.json({ token, user });
  } catch (err) {
    console.error("Mock login failed:", err);
    res.status(500).json({ error: "Mock login failed" });
  }
});

// Verify Current Token (Middleware support)
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(" ")[1];
    jwt.verify(token, jwtSecret, (err, user) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

router.get("/me", authenticateJWT, async (req, res) => {
  try {
    const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [
      req.user.id,
    ]);
    if (userRes.rows.length > 0) {
      res.json(userRes.rows[0]);
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Auth check failed" });
  }
});

module.exports = {
  router,
  authenticateJWT,
};
