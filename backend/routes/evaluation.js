const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticateJWT } = require('./auth');
const { runDebate } = require('../services/debateEngine');

// 1. Start Evaluation Session
router.post('/start', authenticateJWT, async (req, res) => {
  const { tenderName, clientName, budget, timelineMonths, industry, roster } = req.body;

  if (!tenderName || !clientName || !budget || !timelineMonths || !industry || !roster) {
    return res.status(400).json({ error: 'Missing required evaluation parameters.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create session template
    const sessionRes = await client.query(
      `INSERT INTO evaluation_sessions 
       (user_id, tender_name, client_name, budget, timeline_months, industry, roster, final_verdict, final_budget) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.id, tenderName, clientName, budget, timelineMonths, industry, roster, 'PENDING', budget]
    );
    const session = sessionRes.rows[0];

    // Run the boardroom debate simulation
    const debateOutcome = runDebate(session, roster);

    // Save debate messages to DB
    for (const msg of debateOutcome.messages) {
      await client.query(
        `INSERT INTO debate_messages (session_id, sender, message_text, negotiation_round) 
         VALUES ($1, $2, $3, $4)`,
        [session.id, msg.sender, msg.message_text, msg.negotiation_round]
      );
    }

    // Update session with final verdict and budget
    const updatedSessionRes = await client.query(
      `UPDATE evaluation_sessions 
       SET final_verdict = $1, final_budget = $2 
       WHERE id = $3 RETURNING *`,
      [debateOutcome.verdict, debateOutcome.finalBudget, session.id]
    );

    await client.query('COMMIT');
    res.status(201).json(updatedSessionRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to run evaluation:', err);
    res.status(500).json({ error: 'Failed to initiate boardroom debate.' });
  } finally {
    client.release();
  }
});

// 2. Stream Debate Progress via SSE (Server-Sent Events)
router.get('/stream', async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required.' });
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  try {
    // Fetch all messages for the session
    const msgRes = await pool.query(
      'SELECT * FROM debate_messages WHERE session_id = $1 ORDER BY id ASC',
      [sessionId]
    );
    const messages = msgRes.rows;

    const sessionRes = await pool.query(
      'SELECT * FROM evaluation_sessions WHERE id = $1',
      [sessionId]
    );
    const session = sessionRes.rows[0];

    let index = 0;
    const sendNextMessage = () => {
      if (index < messages.length) {
        const msg = messages[index];

        // Send typing indicator first
        res.write(`event: typing\ndata: ${JSON.stringify({ sender: msg.sender })}\n\n`);

        // Simulate typing delay
        setTimeout(() => {
          res.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
          index++;
          // Wait before the next speaker
          setTimeout(sendNextMessage, 1500);
        }, 1200);
      } else {
        // Send final verdict event
        res.write(`event: verdict\ndata: ${JSON.stringify(session)}\n\n`);
        res.write('event: done\ndata: {}\n\n');
        res.end();
      }
    };

    // Start stream sequence
    sendNextMessage();

  } catch (err) {
    console.error('SSE Stream error:', err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }

  req.on('close', () => {
    console.log(`SSE client closed connection for session ${sessionId}`);
  });
});

// 3. Get User Session History
router.get('/history', authenticateJWT, async (req, res) => {
  try {
    const historyRes = await pool.query(
      'SELECT * FROM evaluation_sessions WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(historyRes.rows);
  } catch (err) {
    console.error('Failed to load history:', err);
    res.status(500).json({ error: 'Failed to fetch session history.' });
  }
});

// 4. Get Specific Session Details
router.get('/session/:id', authenticateJWT, async (req, res) => {
  try {
    const sessionRes = await pool.query(
      'SELECT * FROM evaluation_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const messagesRes = await pool.query(
      'SELECT * FROM debate_messages WHERE session_id = $1 ORDER BY id ASC',
      [req.params.id]
    );

    res.json({
      session: sessionRes.rows[0],
      messages: messagesRes.rows
    });
  } catch (err) {
    console.error('Failed to load session details:', err);
    res.status(500).json({ error: 'Failed to load evaluation details.' });
  }
});

module.exports = router;
