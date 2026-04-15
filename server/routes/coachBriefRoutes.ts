import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../auth.js';
import { pool } from '../../db.js';

const router = Router();

// GET / — most recent coach brief for the authenticated user
router.get('/', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM coach_briefs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user!.id]
    );
    return res.json({ brief: rows[0] ?? null });
  } catch (err) {
    console.error('[coachBriefRoutes] GET /:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — fire Weft webhook to generate a live brief
router.post('/', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const webhookUrl = process.env.WEFT_WEBHOOK_URL;
    if (!webhookUrl) return res.status(500).json({ error: 'WEFT_WEBHOOK_URL not configured' });
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: req.user!.id, live_query: true }),
    });
    return res.status(202).json({ message: 'Brief generation triggered' });
  } catch (err) {
    console.error('[coachBriefRoutes] POST /:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /poll?since=<ISO> — poll for briefs newer than the given timestamp
router.get('/poll', requireAuth as any, async (req: AuthRequest, res) => {
  const { since } = req.query;
  if (!since) return res.status(400).json({ error: 'Missing required query param: since' });
  try {
    const { rows } = await pool.query(
      `SELECT * FROM coach_briefs
       WHERE user_id = $1 AND created_at > $2
       ORDER BY created_at DESC LIMIT 1`,
      [req.user!.id, since]
    );
    return res.json({ newBrief: rows.length > 0, row: rows[0] ?? null });
  } catch (err) {
    console.error('[coachBriefRoutes] GET /poll:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export function registerCoachBriefRoutes(app: import('express').Express) {
  app.use('/api/coach-brief', router);
}
