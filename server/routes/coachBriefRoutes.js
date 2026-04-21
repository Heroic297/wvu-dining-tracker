const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------------------------------------------------------------------------
// GET /api/coach-brief
// Returns the most recent coach brief for the authenticated user.
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  const { pool } = req.app.locals;
  const userId = req.session.userId;
  try {
    const result = await pool.query(
      `SELECT * FROM coach_briefs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return res.json({ brief: result.rows[0] || null });
  } catch (err) {
    console.error('[coachBrief GET]', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/coach-brief
// Fires the Weft webhook to trigger async brief generation.
// Returns 202 immediately — client should poll /poll until a new brief lands.
// ---------------------------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const webhookUrl = process.env.WEFT_WEBHOOK_URL;

  if (!webhookUrl) {
    return res.status(503).json({ error: 'WEFT_WEBHOOK_URL not configured' });
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, live_query: true }),
    });
    return res.status(202).json({ queued: true });
  } catch (err) {
    console.error('[coachBrief POST]', err);
    return res.status(502).json({ error: 'Webhook delivery failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/coach-brief/poll?since=<ISO timestamp>
// Returns { newBrief: bool, row: CoachBriefRow | null }
// Used by the frontend to detect when a newly-generated brief has landed.
// ---------------------------------------------------------------------------
router.get('/poll', requireAuth, async (req, res) => {
  const { pool } = req.app.locals;
  const userId = req.session.userId;
  const { since } = req.query;

  if (!since) {
    return res.status(400).json({ error: 'Query param `since` (ISO timestamp) is required' });
  }

  let sinceDate;
  try {
    sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) throw new Error('Invalid date');
  } catch {
    return res.status(400).json({ error: 'Invalid `since` timestamp' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM coach_briefs
       WHERE user_id = $1 AND created_at > $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, sinceDate.toISOString()]
    );
    const row = result.rows[0] || null;
    return res.json({ newBrief: !!row, row });
  } catch (err) {
    console.error('[coachBrief POLL]', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
