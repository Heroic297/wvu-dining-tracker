const express = require('express');
const router = express.Router();
const { pool } = require('../db'); // node-postgres pool

// Middleware: require session auth
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /?days=7 — fetch training logs for the last N days (default 7)
router.get('/', requireAuth, async (req, res) => {
  const days = parseInt(req.query.days, 10) || 7;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM training_logs
       WHERE user_id = $1
         AND timestamp >= NOW() - ($2 || ' days')::INTERVAL
       ORDER BY timestamp DESC`,
      [req.session.userId, days]
    );
    return res.json({ logs: rows });
  } catch (err) {
    console.error('[trainingLogRoutes] GET /:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — insert a new training log entry
router.post('/', requireAuth, async (req, res) => {
  const { exercise, sets, reps, weight_kg, rpe, notes, session_id } = req.body;

  // Validation
  if (!exercise || sets == null || reps == null || weight_kg == null) {
    return res.status(400).json({ error: 'exercise, sets, reps, and weight_kg are required' });
  }
  if (rpe !== undefined && rpe !== null && (rpe < 1 || rpe > 10)) {
    return res.status(400).json({ error: 'rpe must be between 1 and 10' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO training_logs (user_id, exercise, sets, reps, weight, rpe, session_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.session.userId,
        exercise,
        sets,
        reps,
        weight_kg,
        rpe || null,
        session_id || null,
        notes || null,
      ]
    );
    return res.status(201).json({ log: rows[0] });
  } catch (err) {
    console.error('[trainingLogRoutes] POST /:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — delete a training log by id (must belong to the authenticated user)
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM training_logs WHERE id = $1 AND user_id = $2',
      [id, req.session.userId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Log not found or not owned by user' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[trainingLogRoutes] DELETE /:id:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
