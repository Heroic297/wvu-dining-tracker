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
import { callAIChat } from "./ai.js";
import { z } from "zod";

// ─── Helper functions (internal) ─────────────────────────────────────────────

async function parseWithGroq(rawText: string): Promise<any> {
  const data = await callAIChat(
    [
      {
        role: "system",
        content: `You are a training program parser. You receive raw text (often CSV or pasted text) representing a strength/powerlifting/hypertrophy training program. Your job is to extract the structured program data and return ONLY valid JSON — no markdown, no explanation, no code fences.

Output schema:
{
  "name": "Program Name",
  "weeks": [{
    "weekNumber": 0,
    "days": [{
      "label": "Day 1 - Upper",
      "exercises": [{
        "name": "Bench Press",
        "sets": 4,
        "reps": "5",
        "weight": "225",
        "rpe": 8,
        "notes": "pause reps"
      }]
    }]
  }]
}

Rules:
- If the program text uses CSV columns, the first row is usually headers. Parse accordingly.
- If there are no explicit weeks, wrap all days in a single week with weekNumber: 0.
- "reps" should be a string (could be "5", "8-12", "AMRAP", etc.)
- "weight" should be a string (could be absolute like "225", percentage like "75%", or empty string)
- rpe and notes can be null if not present.
- Preserve exercise order as written.
- If a day label is not clear, use "Day 1", "Day 2", etc.`,
      },
      {
        role: "user",
        content: `Parse this training program:\n\n${rawText.slice(0, 12000)}`,
      },
    ],
    { maxTokens: 8192, temperature: 0.05 }
  );
  const content = data.choices?.[0]?.message?.content ?? "{}";

  // Strip markdown code fences if present
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : {};
}

async function fetchGoogleSheets(url: string): Promise<string> {
  const idMatch = url.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!idMatch) throw new Error("Invalid Google Sheets URL");
  const sheetId = idMatch[1];

  const gidMatch = url.match(/gid=(\d+)/);
  const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : "";

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`;
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

interface SpreadsheetResult {
  text: string;
  sheetNames: string[];
  parsedBlocks?: any;
  confidence: "high" | "low";
}

async function extractSpreadsheet(base64: string, ext: string): Promise<SpreadsheetResult> {
  const buffer = Buffer.from(base64, "base64");

  if (ext === "csv") {
    return { text: buffer.toString("utf-8"), sheetNames: ["Sheet1"], confidence: "low" };
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetNames = workbook.SheetNames;

  const sheetTexts = sheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    return `=== Sheet: ${name} ===\n${XLSX.utils.sheet_to_csv(ws)}`;
  });
  const fallbackText = sheetTexts.join("\n\n");

  const weekPattern = /^(week\s*\d+|w\d+|block\s*\d+)$/i;
  const weekNameCount = sheetNames.filter((n) => weekPattern.test(n.trim())).length;
  const isWeekNamed = weekNameCount >= 2;

  const weeks: any[] = [];
  let totalExercises = 0;

  for (let si = 0; si < sheetNames.length; si++) {
    const sheetName = sheetNames[si];
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });

    if (rows.length < 2) continue;

    // Find header row (first row containing a recognisable column name)
    let headerRowIdx = 0;
    for (let r = 0; r < Math.min(5, rows.length); r++) {
      const cells = (rows[r] as any[]).map((c: any) => String(c).toLowerCase().trim());
      if (cells.some((c) => ["exercise", "name", "movement", "lift"].includes(c))) {
        headerRowIdx = r;
        break;
      }
    }

    const headers = (rows[headerRowIdx] as any[]).map((c: any) => String(c).toLowerCase().trim());
    const col = (aliases: string[]) => headers.findIndex((h) => aliases.some(a => h === a || h.startsWith(a + " ") || h.startsWith(a + "(")));

    const exerciseCol = col(["exercise", "name", "movement", "lift"]);
    const setsCol = col(["sets", "set"]);
    const repsCol = col(["reps", "rep"]);
    const weightCol = col(["weight", "load", "intensity", "kg", "lbs"]);
    const rpeCol = col(["rpe"]);
    const notesCol = col(["notes", "note"]);

    if (exerciseCol === -1 || (setsCol === -1 && repsCol === -1)) continue;

    // Detect inline section-based layout: single sheet with "WEEK N" and "Day N" row headers
    const weekHeaderRe = /^WEEK\s+(\d+)/i;
    const dayHeaderRe = /^\s*Day\s+(\d+)\s*[—–\-]/i;
    let hasSectionedLayout = false;
    for (let r = headerRowIdx + 1; r < Math.min(rows.length, 30); r++) {
      if (weekHeaderRe.test(String((rows[r] as any[])[0] ?? "").trim())) {
        hasSectionedLayout = true;
        break;
      }
    }

    if (hasSectionedLayout) {
      let weekNum = 0;
      let dayLabel = "";
      let dayExercises: any[] = [];
      const weekMap = new Map<number, { weekNumber: number; days: any[] }>();

      const flushDay = () => {
        if (weekNum > 0 && dayLabel && dayExercises.length > 0) {
          let w = weekMap.get(weekNum);
          if (!w) { w = { weekNumber: weekNum, days: [] }; weekMap.set(weekNum, w); }
          w.days.push({ label: dayLabel, exercises: [...dayExercises] });
        }
        dayExercises = [];
      };

      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] as any[];
        const firstCell = String(row[0] ?? "").trim();

        const wm = weekHeaderRe.exec(firstCell);
        if (wm) { flushDay(); weekNum = parseInt(wm[1]); dayLabel = ""; continue; }

        const dm = dayHeaderRe.exec(firstCell);
        if (dm) { flushDay(); dayLabel = firstCell.trim(); continue; }

        if (!weekNum || !dayLabel) continue;
        const name = String(row[exerciseCol] ?? "").trim();
        if (!name) continue;

        dayExercises.push({
          name,
          sets: setsCol !== -1 ? Number(row[setsCol]) || 3 : 3,
          reps: repsCol !== -1 ? String(row[repsCol] ?? "") : "",
          weight: weightCol !== -1 ? String(row[weightCol] ?? "") : "",
          rpe: rpeCol !== -1 ? Number(row[rpeCol]) || null : null,
          notes: notesCol !== -1 ? String(row[notesCol] ?? "") : "",
        });
      }
      flushDay();

      if (weekMap.size > 0) {
        const sectionWeeks = Array.from(weekMap.values()).sort((a, b) => a.weekNumber - b.weekNumber);
        const sectionTotal = sectionWeeks.reduce((s, w) => s + w.days.reduce((ds, d) => ds + d.exercises.length, 0), 0);
        if (sectionTotal >= 2) {
          totalExercises += sectionTotal;
          if (isWeekNamed) {
            weeks.push(...sectionWeeks);
          } else {
            weeks.push(...sectionWeeks);
          }
          continue;
        }
      }
    }

    const exercises: any[] = [];
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] as any[];
      const name = String(row[exerciseCol] ?? "").trim();
      if (!name) continue;
      exercises.push({
        name,
        sets: setsCol !== -1 ? Number(row[setsCol]) || 3 : 3,
        reps: repsCol !== -1 ? String(row[repsCol] ?? "") : "",
        weight: weightCol !== -1 ? String(row[weightCol] ?? "") : "",
        rpe: rpeCol !== -1 ? Number(row[rpeCol]) || null : null,
        notes: notesCol !== -1 ? String(row[notesCol] ?? "") : "",
      });
    }

    if (exercises.length === 0) continue;
    totalExercises += exercises.length;

    if (isWeekNamed) {
      weeks.push({ weekNumber: si + 1, days: [{ label: sheetName, exercises }] });
    } else {
      if (weeks.length === 0) weeks.push({ weekNumber: 1, days: [] });
      weeks[0].days.push({ label: sheetName, exercises });
    }
  }

  if (totalExercises >= 2) {
    return { text: fallbackText, sheetNames, parsedBlocks: { weeks }, confidence: "high" };
  }
  return { text: fallbackText, sheetNames, confidence: "low" };
}

async function generateProgram(params: any): Promise<string> {
  const prompt = `Generate a complete ${params.daysPerWeek}-day per week training program.
Goal: ${params.goal}
Experience level: ${params.experienceLevel}
Equipment: ${params.equipment}
Include: exercise names, sets, reps, weight guidance (% of 1RM or RPE), and progression notes.
Format as a clear weekly program with Day 1, Day 2, etc.`;
  const result = await callAIChat([{ role: "user", content: prompt }], {
    maxTokens: 4096,
    temperature: 0.7,
  });
  return result.choices?.[0]?.message?.content ?? "";
}

// Column aliases so the API returns camelCase keys the client expects
const PROGRAM_COLS = `id, user_id, name, source, is_active AS "isActive", parsed_blocks AS "parsedBlocks", raw_content AS "rawContent", created_at AS "createdAt", updated_at AS "updatedAt", start_date AS "startDate"`;

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
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
        let source: string = body.type;
        let precomputedBlocks: any | null = null;
        let programName: string | undefined;

        if (body.type === "sheets") {
          if (!body.url) {
            return res.status(400).json({ error: "url is required for sheets import" });
          }
          rawText = await fetchGoogleSheets(body.url);
        } else if (body.type === "paste") {
          if (body.file && body.fileName) {
            const ext = body.fileName.toLowerCase();
            if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
              const result = await extractSpreadsheet(body.file, "xlsx");
              rawText = result.text;
              source = "xlsx";
              if (result.confidence === "high" && result.parsedBlocks) {
                precomputedBlocks = result.parsedBlocks;
                programName = body.fileName.replace(/\.[^.]+$/, "");
              }
            } else if (ext.endsWith(".csv")) {
              const result = await extractSpreadsheet(body.file, "csv");
              rawText = result.text;
              source = "csv";
            } else if (ext.endsWith(".pdf")) {
              rawText = await extractPdf(body.file);
            } else if (ext.endsWith(".docx")) {
              rawText = await extractDocx(body.file);
            } else {
              rawText = Buffer.from(body.file, "base64").toString("utf-8");
            }
          } else {
            if (!body.content) {
              return res.status(400).json({ error: "content is required for paste import" });
            }
            rawText = body.content;
          }
        } else {
          if (!body.generateParams) {
            return res.status(400).json({ error: "generateParams is required for generate type" });
          }
          rawText = await generateProgram(body.generateParams);
        }

        const parsed = precomputedBlocks ?? await parseWithGroq(rawText!);

        const result = await pool.query(
          `INSERT INTO training_programs (user_id, name, source, raw_content, parsed_blocks, start_date)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${PROGRAM_COLS}`,
          [
            userId,
            programName || parsed.name || "Imported Program",
            source,
            rawText!,
            JSON.stringify(parsed),
            body.startDate ?? null,
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
           RETURNING ${PROGRAM_COLS}`,
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
          `SELECT ${PROGRAM_COLS} FROM training_programs WHERE user_id = $1 ORDER BY created_at DESC`,
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
          `SELECT ${PROGRAM_COLS} FROM training_programs WHERE id = $1 AND user_id = $2`,
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
           RETURNING ${PROGRAM_COLS}`,
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
          `SELECT id, user_id, program_id, date, week_number, day_label, exercises, notes, logged_at
             FROM workout_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 30`,
          [userId]
        );

        res.json(
          result.rows.map((r) => ({
            id: r.id,
            userId: r.user_id,
            programId: r.program_id,
            date: r.date,
            weekNumber: r.week_number,
            dayLabel: r.day_label,
            exercises: r.exercises,
            notes: r.notes,
            loggedAt: r.logged_at,
          }))
        );
      } catch (err: any) {
        console.error("[programs] workout-logs history error:", err);
        res.status(500).json({ error: "Failed to get workout log history" });
      }
    }
  );

  // ── DELETE /api/workout-logs/:id ─────────────────────────────────────────
  app.delete(
    "/api/workout-logs/:id",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const { id } = req.params;

        const result = await pool.query(
          `DELETE FROM workout_logs WHERE id = $1 AND user_id = $2 RETURNING id`,
          [id, userId]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Workout log not found" });
        }

        res.json({ success: true, id: result.rows[0].id });
      } catch (err: any) {
        console.error("[programs] workout-log delete error:", err);
        res.status(500).json({ error: "Failed to delete workout log" });
      }
    }
  );
}
