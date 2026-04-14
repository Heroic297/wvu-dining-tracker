/**
 * Training Program management routes.
 *
 * POST   /api/programs/import       — import a program from sheets, paste, or generate
 * POST   /api/programs/generate     — generate a program via AI
 * GET    /api/programs              — list user programs
 * GET    /api/programs/:id          — get single program
 * PATCH  /api/programs/:id          — update program
 * DELETE /api/programs/:id          — delete program
 * POST   /api/workout-logs          — create a workout log
 * GET    /api/workout-logs          — get logs for a date
 * GET    /api/workout-logs/history  — last 30 workout logs
 */
import type { Express, Response } from "express";
import { pool } from "./db.js";
import { requireAuth, type AuthRequest } from "./auth.js";
import { z } from "zod";

// ─── Helper functions (internal) ─────────────────────────────────────────────

async function parseWithGroq(rawText: string): Promise<any> {
  const groqKey = process.env.GROQ_API_KEY!;
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: `Parse this training program into structured JSON.
Return a JSON object with this shape:
{
  "name": string,
  "weeks": [{ "weekNumber": number, "days": [{ "dayLabel": string, "exercises": [{ "name": string, "sets": number, "reps": string, "weight": string, "rpe": number | null, "notes": string | null }] }] }]
}
If the program has no week structure, wrap everything in a single week.
Return ONLY the JSON object, no other text.
Program text:
${rawText.slice(0, 8000)}`,
        },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const match = content.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : {};
}

async function fetchGoogleSheets(url: string): Promise<string> {
  const match = url.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw new Error("Invalid Google Sheets URL");
  const csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
  const resp = await fetch(csvUrl);
  if (!resp.ok)
    throw new Error(
      "Could not fetch Google Sheet — make sure it is publicly viewable"
    );
  return resp.text();
}

async function extractPdf(base64: string): Promise<string> {
  const { default: pdfParse } = await import("pdf-parse");
  const buffer = Buffer.from(base64, "base64");
  const result = await pdfParse(buffer);
  return result.text;
}

async function extractDocx(base64: string): Promise<string> {
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(base64, "base64");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function generateProgram(params: any): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY!;
  const prompt = `Generate a complete ${params.daysPerWeek}-day per week training program.
Goal: ${params.goal}
Experience level: ${params.experienceLevel}
Equipment: ${params.equipment}
Include: exercise names, sets, reps, weight guidance (% of 1RM or RPE), and progression notes.
Format as a clear weekly program with Day 1, Day 2, etc.`;
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ─── Route registration ──────────────────────────────────────────────────────

export function registerProgramRoutes(app: Express): void {
  // ── POST /api/programs/import ────────────────────────────────────────────
  app.post(
    "/api/programs/import",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const schema = z.object({
          type: z.enum(["sheets", "paste", "generate"]),
          content: z.string().optional(),
          url: z.string().optional(),
          file: z.string().optional(),
          fileName: z.string().optional(),
          generateParams: z
            .object({
              goal: z.string(),
              daysPerWeek: z.coerce.number(),
              experienceLevel: z.string(),
              equipment: z.string(),
            })
            .optional(),
        });

        const body = schema.parse(req.body);
        const userId = req.user!.id;
        let rawText: string;
        let source = body.type;

        if (body.type === "sheets") {
          if (!body.url) {
            return res.status(400).json({ error: "url is required for sheets import" });
          }
          const csvText = await fetchGoogleSheets(body.url);
          rawText = csvText;
        } else if (body.type === "paste") {
          // Check for file uploads (PDF / DOCX)
          if (body.file && body.fileName) {
            const ext = body.fileName.toLowerCase();
            if (ext.endsWith(".pdf")) {
              rawText = await extractPdf(body.file);
            } else if (ext.endsWith(".docx")) {
              rawText = await extractDocx(body.file);
            } else {
              // Treat as plain text
              rawText = Buffer.from(body.file, "base64").toString("utf-8");
            }
          } else {
            if (!body.content) {
              return res
                .status(400)
                .json({ error: "content is required for paste import" });
            }
            rawText = body.content;
          }
        } else {
          // generate
          if (!body.generateParams) {
            return res
              .status(400)
              .json({ error: "generateParams is required for generate type" });
          }
          rawText = await generateProgram(body.generateParams);
        }

        const parsed = await parseWithGroq(rawText);

        const result = await pool.query(
          `INSERT INTO training_programs (user_id, name, source, raw_content, parsed_blocks)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            userId,
            parsed.name || "Imported Program",
            source,
            rawText,
            JSON.stringify(parsed),
          ]
        );

        res.json(result.rows[0]);
      } catch (err: any) {
        console.error("[programs] import error:", err);
        res.status(500).json({ error: err.message || "Failed to import program" });
      }
    }
  );

  // ── POST /api/programs/generate ──────────────────────────────────────────
  app.post(
    "/api/programs/generate",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const schema = z.object({
          goal: z.string(),
          daysPerWeek: z.coerce.number(),
          experienceLevel: z.string(),
          equipment: z.string(),
        });

        const params = schema.parse(req.body);
        const userId = req.user!.id;

        const rawText = await generateProgram(params);
        const parsed = await parseWithGroq(rawText);

        const result = await pool.query(
          `INSERT INTO training_programs (user_id, name, source, raw_content, parsed_blocks)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            userId,
            parsed.name || "Generated Program",
            "generate",
            rawText,
            JSON.stringify(parsed),
          ]
        );

        res.json(result.rows[0]);
      } catch (err: any) {
        console.error("[programs] generate error:", err);
        res
          .status(500)
          .json({ error: err.message || "Failed to generate program" });
      }
    }
  );

  // ── GET /api/programs ────────────────────────────────────────────────────
  app.get(
    "/api/programs",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const result = await pool.query(
          `SELECT * FROM training_programs WHERE user_id = $1 ORDER BY created_at DESC`,
          [userId]
        );
        res.json(result.rows);
      } catch (err: any) {
        console.error("[programs] list error:", err);
        res.status(500).json({ error: "Failed to list programs" });
      }
    }
  );

  // ── GET /api/programs/:id ────────────────────────────────────────────────
  app.get(
    "/api/programs/:id",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const { id } = req.params;
        const result = await pool.query(
          `SELECT * FROM training_programs WHERE id = $1 AND user_id = $2`,
          [id, userId]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Program not found" });
        }
        res.json(result.rows[0]);
      } catch (err: any) {
        console.error("[programs] get error:", err);
        res.status(500).json({ error: "Failed to get program" });
      }
    }
  );

  // ── PATCH /api/programs/:id ──────────────────────────────────────────────
  app.patch(
    "/api/programs/:id",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const { id } = req.params;

        const schema = z.object({
          name: z.string().optional(),
          is_active: z.boolean().optional(),
          parsed_blocks: z.any().optional(),
        });

        const body = schema.parse(req.body);

        // Verify ownership
        const existing = await pool.query(
          `SELECT id FROM training_programs WHERE id = $1 AND user_id = $2`,
          [id, userId]
        );
        if (existing.rows.length === 0) {
          return res.status(404).json({ error: "Program not found" });
        }

        // If setting is_active = true, deactivate all other programs first
        if (body.is_active === true) {
          await pool.query(
            `UPDATE training_programs SET is_active = false WHERE user_id = $1 AND id != $2`,
            [userId, id]
          );
        }

        const setClauses: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (body.name !== undefined) {
          setClauses.push(`name = $${idx++}`);
          values.push(body.name);
        }
        if (body.is_active !== undefined) {
          setClauses.push(`is_active = $${idx++}`);
          values.push(body.is_active);
        }
        if (body.parsed_blocks !== undefined) {
          setClauses.push(`parsed_blocks = $${idx++}`);
          values.push(JSON.stringify(body.parsed_blocks));
        }

        setClauses.push(`updated_at = now()`);

        values.push(id);
        values.push(userId);

        const result = await pool.query(
          `UPDATE training_programs
           SET ${setClauses.join(", ")}
           WHERE id = $${idx++} AND user_id = $${idx++}
           RETURNING *`,
          values
        );

        res.json(result.rows[0]);
      } catch (err: any) {
        console.error("[programs] update error:", err);
        res.status(500).json({ error: "Failed to update program" });
      }
    }
  );

  // ── DELETE /api/programs/:id ─────────────────────────────────────────────
  app.delete(
    "/api/programs/:id",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const { id } = req.params;

        const result = await pool.query(
          `DELETE FROM training_programs WHERE id = $1 AND user_id = $2 RETURNING id`,
          [id, userId]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Program not found" });
        }

        res.json({ success: true, id: result.rows[0].id });
      } catch (err: any) {
        console.error("[programs] delete error:", err);
        res.status(500).json({ error: "Failed to delete program" });
      }
    }
  );

  // ── POST /api/workout-logs ───────────────────────────────────────────────
  app.post(
    "/api/workout-logs",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const schema = z.object({
          programId: z.string().uuid().optional(),
          date: z.string(),
          weekNumber: z.coerce.number().optional(),
          dayLabel: z.string().optional(),
          exercises: z.any(),
          notes: z.string().optional(),
        });

        const body = schema.parse(req.body);
        const userId = req.user!.id;

        const result = await pool.query(
          `INSERT INTO workout_logs (user_id, program_id, date, week_number, day_label, exercises, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            userId,
            body.programId || null,
            body.date,
            body.weekNumber || null,
            body.dayLabel || null,
            JSON.stringify(body.exercises),
            body.notes || null,
          ]
        );

        res.json(result.rows[0]);
      } catch (err: any) {
        console.error("[programs] workout-log create error:", err);
        res.status(500).json({ error: "Failed to create workout log" });
      }
    }
  );

  // ── GET /api/workout-logs ────────────────────────────────────────────────
  app.get(
    "/api/workout-logs",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const date = req.query.date as string | undefined;

        if (!date) {
          return res
            .status(400)
            .json({ error: "date query parameter is required (YYYY-MM-DD)" });
        }

        const result = await pool.query(
          `SELECT * FROM workout_logs WHERE user_id = $1 AND date = $2 ORDER BY created_at DESC`,
          [userId, date]
        );

        res.json(result.rows);
      } catch (err: any) {
        console.error("[programs] workout-logs get error:", err);
        res.status(500).json({ error: "Failed to get workout logs" });
      }
    }
  );

  // ── GET /api/workout-logs/history ────────────────────────────────────────
  app.get(
    "/api/workout-logs/history",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;

        const result = await pool.query(
          `SELECT * FROM workout_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 30`,
          [userId]
        );

        res.json(result.rows);
      } catch (err: any) {
        console.error("[programs] workout-logs history error:", err);
        res.status(500).json({ error: "Failed to get workout log history" });
      }
    }
  );
}
