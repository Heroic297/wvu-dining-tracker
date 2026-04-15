const express = require('express');
const router = express.Router();
const { pool } = require('../db'); // node-postgres pool

// Middleware: require session auth (express-session + connect-pg-simple)
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET / — fetch most recent coach brief for the authenticated user
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM coach_briefs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.session.userId]
    );
    return res.json({ brief: rows[0] || null });
  } catch (err) {
    console.error('[coachBriefRoutes] GET /:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — trigger Weft webhook to generate a live brief
router.post('/', requireAuth, async (req, res) => {
  try {
    const webhookUrl = process.env.WEFT_WEBHOOK_URL;
    if (!webhookUrl) {
      return res.status(500).json({ error: 'WEFT_WEBHOOK_URL not configured' });
    }
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: req.session.userId, live_query: true }),
    });
    return res.status(202).json({ message: 'Brief generation triggered' });
  } catch (err) {
    console.error('[coachBriefRoutes] POST /:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /poll?since=<ISO> — poll for a brief newer than the given timestamp
router.get('/poll', requireAuth, async (req, res) => {
  const { since } = req.query;
  if (!since) {
    return res.status(400).json({ error: 'Missing required query param: since' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT * FROM coach_briefs
       WHERE user_id = $1 AND created_at > $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.session.userId, since]
    );
    return res.json({ newBrief: rows.length > 0, row: rows[0] || null });
  } catch (err) {
    console.error('[coachBriefRoutes] GET /poll:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
