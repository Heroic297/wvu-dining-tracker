const express = require('express');
const router = express.Router();

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
// GET /api/training-log?days=7
// Returns training_logs rows for the past N days (default 7).
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  const { pool } = req.app.locals;
  const userId = req.session.userId;
  const days = parseInt(req.query.days, 10) || 7;

  try {
    const result = await pool.query(
      `SELECT * FROM training_logs
       WHERE user_id = $1
         AND timestamp >= NOW() - ($2 || ' days')::INTERVAL
       ORDER BY timestamp DESC`,
      [userId, days]
    );
    return res.json({ logs: result.rows });
  } catch (err) {
    console.error('[trainingLog GET]', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/training-log
// Inserts a new training set log. Required: exercise, sets, reps, weight.
// Optional: rpe (1–10), session_id, notes.
// ---------------------------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  const { pool } = req.app.locals;
  const userId = req.session.userId;
  const { exercise, sets, reps, weight, rpe, session_id, notes } = req.body;

  // Validation
  if (!exercise || exercise.trim() === '') {
    return res.status(400).json({ error: '`exercise` is required' });
  }
  if (sets == null || !Number.isFinite(Number(sets)) || Number(sets) <= 0) {
    return res.status(400).json({ error: '`sets` must be a positive integer' });
  }
  if (reps == null || !Number.isFinite(Number(reps)) || Number(reps) <= 0) {
    return res.status(400).json({ error: '`reps` must be a positive integer' });
  }
  if (weight == null || !Number.isFinite(Number(weight)) || Number(weight) < 0) {
    return res.status(400).json({ error: '`weight` must be a non-negative number' });
  }
  if (rpe != null && (Number(rpe) < 1 || Number(rpe) > 10)) {
    return res.status(400).json({ error: '`rpe` must be between 1 and 10' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO training_logs
         (user_id, exercise, sets, reps, weight, rpe, session_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        exercise.trim(),
        Number(sets),
        Number(reps),
        Number(weight),
        rpe != null ? Number(rpe) : null,
        session_id || null,
        notes || null,
      ]
    );
    return res.status(201).json({ log: result.rows[0] });
  } catch (err) {
    console.error('[trainingLog POST]', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/training-log/:id
// Deletes a training log entry — only if it belongs to the authenticated user.
// ---------------------------------------------------------------------------
router.delete('/:id', requireAuth, async (req, res) => {
  const { pool } = req.app.locals;
  const userId = req.session.userId;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM training_logs
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Log not found or not owned by user' });
    }
    return res.json({ deleted: id });
  } catch (err) {
    console.error('[trainingLog DELETE]', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
