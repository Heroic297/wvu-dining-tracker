import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../auth.js';
import { pool } from '../../db.js';

const router = Router();

// GET /?days=7 — fetch training logs for the last N days (default 7)
router.get('/', requireAuth as any, async (req: AuthRequest, res) => {
  const days = parseInt(req.query.days as string, 10) || 7;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM training_logs
       WHERE user_id = $1
         AND timestamp >= NOW() - ($2 || ' days')::INTERVAL
       ORDER BY timestamp DESC`,
      [req.user!.id, days]
    );
    return res.json({ logs: rows });
  } catch (err) {
    console.error('[trainingLogRoutes] GET /:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — insert a new training log entry
router.post('/', requireAuth as any, async (req: AuthRequest, res) => {
  const { exercise, sets, reps, weight_kg, rpe, notes, session_id } = req.body;
  if (!exercise || sets == null || reps == null || weight_kg == null) {
    return res.status(400).json({ error: 'exercise, sets, reps, and weight_kg are required' });
  }
  if (rpe !== undefined && rpe !== null && (Number(rpe) < 1 || Number(rpe) > 10)) {
    return res.status(400).json({ error: 'rpe must be between 1 and 10' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO training_logs (user_id, exercise, sets, reps, weight, rpe, session_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.user!.id, exercise, sets, reps, weight_kg, rpe ?? null, session_id ?? null, notes ?? null]
    );
    return res.status(201).json({ log: rows[0] });
  } catch (err) {
    console.error('[trainingLogRoutes] POST /:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — delete a training log owned by the authenticated user
router.delete('/:id', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM training_logs WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user!.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Log not found or not owned by user' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[trainingLogRoutes] DELETE /:id:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export function registerTrainingLogRoutes(app: import('express').Express) {
  app.use('/api/training-log', router);
}
