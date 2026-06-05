'use strict';
const express = require('express');
const router = express.Router();
const { EventEmitter } = require('events');
const { pool } = require('../config/db');
const { authenticateJWT } = require('./auth');
const { runDebateAsync } = require('../services/debateEngine');

// Shared in-memory pub/sub for real-time SSE streaming
const debateEmitter = new EventEmitter();
debateEmitter.setMaxListeners(200);

// Tracks session IDs that have been cancelled — checked before each agent call
const cancelledSessions = new Set();

// 1. Start Evaluation Session — creates DB record, triggers async Gemini debate
router.post('/start', authenticateJWT, async (req, res) => {
  const { tenderName, clientName, budget, timelineMonths, industry, roster, missionBriefing } = req.body;

  const trimmedTender = typeof tenderName === 'string' ? tenderName.trim() : '';
  const trimmedClient = typeof clientName === 'string' ? clientName.trim() : '';

  if (!trimmedTender) {
    return res.status(400).json({ error: 'Tender / Project Name is required.' });
  }
  if (trimmedTender.length < 3) {
    return res.status(400).json({ error: 'Tender / Project Name must be at least 3 characters.' });
  }
  if (trimmedTender.length > 100) {
    return res.status(400).json({ error: 'Tender / Project Name cannot exceed 100 characters.' });
  }

  if (!trimmedClient) {
    return res.status(400).json({ error: 'Client Name is required.' });
  }
  if (trimmedClient.length < 3) {
    return res.status(400).json({ error: 'Client Name must be at least 3 characters.' });
  }
  if (trimmedClient.length > 100) {
    return res.status(400).json({ error: 'Client Name cannot exceed 100 characters.' });
  }

  if (budget === undefined || budget === null || budget === '') {
    return res.status(400).json({ error: 'Budget is required.' });
  }
  const budgetNum = Number(budget);
  if (isNaN(budgetNum) || budgetNum <= 0) {
    return res.status(400).json({ error: 'Budget must be a positive number greater than 0.' });
  }

  if (timelineMonths === undefined || timelineMonths === null || timelineMonths === '') {
    return res.status(400).json({ error: 'Timeline is required.' });
  }
  const timelineNum = Number(timelineMonths);
  if (isNaN(timelineNum) || !Number.isInteger(timelineNum) || timelineNum <= 0) {
    return res.status(400).json({ error: 'Timeline must be a positive integer representing months.' });
  }

  const validIndustries = ['Healthcare', 'Financial Services', 'E-Commerce', 'Cybersecurity', 'Logistics'];
  if (!validIndustries.includes(industry)) {
    return res.status(400).json({ error: 'Invalid industry vertical selected.' });
  }

  if (!Array.isArray(roster) || roster.length === 0) {
    return res.status(400).json({ error: 'Roster must select at least one agent.' });
  }

  try {
    const sessionRes = await pool.query(
      `INSERT INTO evaluation_sessions
       (user_id, tender_name, client_name, budget, timeline_months, industry, roster, final_verdict, final_budget)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.id, tenderName, clientName, budget, timelineMonths, industry, roster, 'PENDING', budget]
    );
    const session = sessionRes.rows[0];

    // Fire-and-forget: Gemini debate runs async, events flow via debateEmitter
    const isCancelled = () => cancelledSessions.has(session.id);
    runDebateAsync(session, roster, debateEmitter, pool, missionBriefing || null, req.user.id, isCancelled)
      .finally(() => cancelledSessions.delete(session.id))
      .catch(err => {
        console.error(`Unhandled debate error for session ${session.id}:`, err.message);
      });

    res.status(201).json(session);
  } catch (err) {
    console.error('Failed to create evaluation session:', err);
    res.status(500).json({ error: 'Failed to initiate boardroom debate.' });
  }
});

// 2. Stream Debate Progress via SSE — subscribes to debateEmitter events in real time
router.get('/stream', async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:4200');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) { /* client disconnected */ }
  };

  const onTyping = (data) => sendEvent('typing', data);
  const onMessage = (data) => sendEvent('message', data);

  const onDone = (sessionData) => {
    sendEvent('verdict', sessionData);
    sendEvent('done', {});
    cleanup();
    res.end();
  };

  const onError = (data) => {
    sendEvent('error', data);
    cleanup();
    res.end();
  };

  const cleanup = () => {
    debateEmitter.off(`typing:${sessionId}`, onTyping);
    debateEmitter.off(`message:${sessionId}`, onMessage);
    debateEmitter.off(`done:${sessionId}`, onDone);
    debateEmitter.off(`error:${sessionId}`, onError);
  };

  debateEmitter.on(`typing:${sessionId}`, onTyping);
  debateEmitter.on(`message:${sessionId}`, onMessage);
  debateEmitter.on(`done:${sessionId}`, onDone);
  debateEmitter.on(`error:${sessionId}`, onError);

  req.on('close', cleanup);
});

// 3. Cancel a running evaluation
router.post('/cancel/:id', authenticateJWT, (req, res) => {
  const sessionId = parseInt(req.params.id);
  cancelledSessions.add(sessionId);
  console.log(`[Debate] Session ${sessionId} cancelled by user.`);
  res.json({ success: true });
});

// 4. Get User Session History
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
