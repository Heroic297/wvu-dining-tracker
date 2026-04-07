#!/usr/bin/env python3
"""
mempalace_bridge.py — Python sidecar for MemPalace coach memory.

Called by memoryBridge.ts via spawn(), same pattern as garmin_sidecar.py.
All output is JSON to stdout. Errors are JSON {"ok": false, "error": "..."}.

Commands:
  search           <user_id> <query>         — semantic search over coaching memories
  store            <user_id> <memory_json>   — store a new coaching memory
  kg_query         <user_id> <entity>        — query knowledge graph for an entity
  kg_store         <user_id> <triple_json>   — persist a KG triple
  context_snapshot <user_id> <snapshot_json> — build a formatted context block from
                                               daily macro data + mempalace memories
                                               and return it as {ok, block}
"""

import json
import os
import sys
from pathlib import Path
from datetime import date

# ---------------------------------------------------------------------------
# Resolve palace path — per-user directories under /tmp/mempalace (ephemeral)
# or a persistent path if MEMPALACE_DIR env var is set
# ---------------------------------------------------------------------------

BASE_DIR = os.environ.get("MEMPALACE_DIR", "/tmp/mempalace")


def palace_path(user_id: str) -> str:
    p = Path(BASE_DIR) / user_id / "palace"
    p.mkdir(parents=True, exist_ok=True)
    return str(p)


def kg_path(user_id: str) -> str:
    p = Path(BASE_DIR) / user_id
    p.mkdir(parents=True, exist_ok=True)
    return str(p / "knowledge_graph.sqlite3")


# ---------------------------------------------------------------------------
# Lazy imports — chromadb is optional; fail gracefully
# ---------------------------------------------------------------------------

def _import_chromadb():
    try:
        import chromadb
        return chromadb
    except ImportError:
        return None


def _get_collection(user_id: str):
    """Return (client, collection) or raise if chromadb unavailable."""
    chromadb = _import_chromadb()
    if chromadb is None:
        raise ImportError("chromadb not installed — run: pip install chromadb")
    path = palace_path(user_id)
    client = chromadb.PersistentClient(path=path)
    try:
        col = client.get_collection("mempalace_drawers")
    except Exception:
        col = client.create_collection("mempalace_drawers")
    return client, col


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_search(user_id: str, query: str, n_results: int = 5) -> dict:
    """
    Semantic search over the user's coaching memories.
    Returns top-N results with text + metadata.
    """
    try:
        _, col = _get_collection(user_id)
    except ImportError as e:
        return {"ok": False, "error": str(e), "results": []}
    except Exception:
        # No palace yet — return empty rather than error
        return {"ok": True, "results": []}

    try:
        results = col.query(
            query_texts=[query],
            n_results=n_results,
            include=["documents", "metadatas", "distances"],
        )
        docs = results["documents"][0]
        metas = results["metadatas"][0]
        dists = results["distances"][0]

        hits = []
        for doc, meta, dist in zip(docs, metas, dists):
            hits.append({
                "text": doc,
                "memory_type": meta.get("memory_type", "general"),
                "wing": meta.get("wing", "coach"),
                "similarity": round(1 - dist, 3),
                "filed_at": meta.get("filed_at", ""),
            })

        return {"ok": True, "results": hits}

    except Exception as e:
        return {"ok": False, "error": str(e), "results": []}


def cmd_store(user_id: str, memory: dict) -> dict:
    """
    Store a coaching memory in the palace.
    memory: {text, memory_type, source}
    """
    try:
        _, col = _get_collection(user_id)
    except ImportError as e:
        return {"ok": False, "error": str(e)}

    import hashlib
    from datetime import datetime

    text = str(memory.get("text", "")).strip()
    if not text:
        return {"ok": False, "error": "empty text"}

    memory_type = str(memory.get("memory_type", "general"))
    source = str(memory.get("source", "coach_conversation"))
    wing = f"user_{user_id}"

    drawer_id = f"drawer_{wing}_{memory_type}_{hashlib.md5(text.encode()).hexdigest()[:16]}"

    try:
        col.add(
            documents=[text],
            ids=[drawer_id],
            metadatas=[{
                "wing": wing,
                "room": memory_type,
                "memory_type": memory_type,
                "source_file": source,
                "chunk_index": 0,
                "added_by": "macro_coach",
                "filed_at": datetime.now().isoformat(),
                "ingest_mode": "coach",
            }],
        )
        return {"ok": True, "id": drawer_id}
    except Exception as e:
        if "already exists" in str(e).lower():
            return {"ok": True, "id": drawer_id, "note": "already stored"}
        return {"ok": False, "error": str(e)}


def cmd_kg_query(user_id: str, entity: str) -> dict:
    """
    Query the knowledge graph for all current facts about an entity.
    """
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from mempalace.knowledge_graph import KnowledgeGraph
    except ImportError:
        return {"ok": True, "triples": [], "note": "mempalace package not in path"}

    try:
        kg = KnowledgeGraph(db_path=kg_path(user_id))
        today = date.today().isoformat()
        triples = kg.query_entity(entity, as_of=today, direction="outgoing")
        # Keep only currently valid facts
        current = [t for t in triples if t.get("current", True)]
        return {"ok": True, "entity": entity, "triples": current}
    except Exception as e:
        return {"ok": False, "error": str(e), "triples": []}


def cmd_kg_store(user_id: str, triple: dict) -> dict:
    """
    Persist a knowledge graph triple.
    triple: {subject, predicate, object, valid_from?}
    """
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from mempalace.knowledge_graph import KnowledgeGraph
    except ImportError:
        return {"ok": True, "note": "mempalace not in path — skipped"}

    try:
        kg = KnowledgeGraph(db_path=kg_path(user_id))
        triple_id = kg.add_triple(
            subject=str(triple.get("subject", "")),
            predicate=str(triple.get("predicate", "")),
            obj=str(triple.get("object", "")),
            valid_from=triple.get("valid_from", date.today().isoformat()),
        )
        return {"ok": True, "id": triple_id}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def cmd_context_snapshot(user_id: str, snapshot: dict) -> dict:
    """
    Build a formatted context block that combines:
      1. Daily macro aggregate + meal-level rows (passed in from Node/Postgres)
      2. The top coaching memories from the mempalace palace (L1 wake-up)

    snapshot schema (all fields optional — missing fields are skipped gracefully):
    {
      today:        "YYYY-MM-DD",
      totals: {
        kcal, protein, carbs, fat   -- today's logged aggregates (numbers)
      },
      targets: {
        calories, proteinG, carbsG, fatG, waterTargetMl, tdee  -- plan targets
      },
      meals: [
        { meal_name, logged_at, total_calories, total_protein,
          total_carbs, total_fat }  -- per-meal rows for today
      ],
      water_ml:  number,
      weight: {
        weight_kg, weight_lbs, date  -- most recent weigh-in
      }
    }

    Returns {ok: true, block: "<formatted string>", memory_hits: [...]}
    """

    today     = snapshot.get("today", date.today().isoformat())
    totals    = snapshot.get("totals") or {}
    targets   = snapshot.get("targets") or {}
    meals     = snapshot.get("meals") or []
    water_ml  = snapshot.get("water_ml", 0)
    weight    = snapshot.get("weight") or {}

    lines = []

    # ── Daily aggregate ───────────────────────────────────────────────────────
    lines.append(f"--- MACRO CONTEXT SNAPSHOT ({today}) ---")

    if weight:
        w_lbs = weight.get("weight_lbs") or (weight["weight_kg"] * 2.20462 if weight.get("weight_kg") else None)
        w_kg  = weight.get("weight_kg", "?")
        w_date = weight.get("date", "?")
        if w_lbs:
            lines.append(f"Weight: {w_lbs:.1f} lbs ({w_kg} kg) — logged {w_date}")

    if targets:
        cal_t = targets.get("calories", 0)
        pro_t = targets.get("proteinG", 0)
        carb_t = targets.get("carbsG", 0)
        fat_t  = targets.get("fatG", 0)
        water_t_ml = targets.get("waterTargetMl", 0)
        tdee   = targets.get("tdee", 0)
        lines.append(
            f"Plan targets: {cal_t} kcal | P {pro_t}g C {carb_t}g F {fat_t}g"
            + (f" | Water {water_t_ml/1000:.1f}L" if water_t_ml else "")
            + (f" | TDEE {tdee} kcal" if tdee else "")
        )

    kcal_in  = round(totals.get("kcal", 0))
    pro_in   = round(totals.get("protein", 0))
    carb_in  = round(totals.get("carbs", 0))
    fat_in   = round(totals.get("fat", 0))
    lines.append(
        f"Today's logged intake: {kcal_in} kcal | P {pro_in}g C {carb_in}g F {fat_in}g"
    )

    if targets:
        cal_t = targets.get("calories", 0) or 0
        pro_t = targets.get("proteinG", 0) or 0
        carb_t = targets.get("carbsG", 0) or 0
        fat_t  = targets.get("fatG", 0) or 0
        rem_kcal = max(0, cal_t - kcal_in)
        rem_pro  = max(0, pro_t - pro_in)
        rem_carb = max(0, carb_t - carb_in)
        rem_fat  = max(0, fat_t - fat_in)
        lines.append(
            f"Remaining: {rem_kcal} kcal | P {rem_pro}g C {rem_carb}g F {rem_fat}g"
        )

    if water_ml is not None:
        water_str = f"{water_ml/1000:.1f}L" if water_ml >= 1000 else f"{water_ml}ml"
        water_t_ml = (targets.get("waterTargetMl") or 0) if targets else 0
        target_str = f" / {water_t_ml/1000:.1f}L target" if water_t_ml else ""
        lines.append(f"Water: {water_str}{target_str}")

    # ── Meal-level detail ─────────────────────────────────────────────────────
    if meals:
        lines.append("\nMeals logged today:")
        for m in meals:
            name     = m.get("meal_name") or m.get("name") or "Meal"
            m_kcal   = round(m.get("total_calories") or 0)
            m_pro    = round(m.get("total_protein") or 0)
            m_carb   = round(m.get("total_carbs") or 0)
            m_fat    = round(m.get("total_fat") or 0)
            logged_at = m.get("logged_at", "")
            time_str  = f" @ {logged_at[:16]}" if logged_at else ""
            lines.append(
                f"  • {name}{time_str}: {m_kcal} kcal | P {m_pro}g C {m_carb}g F {m_fat}g"
            )

    # ── Mempalace coaching memories (L1 wake-up) ──────────────────────────────
    memory_hits = []
    memory_block = ""
    try:
        _, col = _get_collection(user_id)
        # Pull top 8 highest-importance coaching memories
        results = col.get(
            include=["documents", "metadatas"],
            limit=50,
        )
        docs  = results.get("documents") or []
        metas = results.get("metadatas") or []

        scored = []
        for doc, meta in zip(docs, metas):
            imp = 3
            for key in ("importance", "emotional_weight", "weight"):
                val = meta.get(key)
                if val is not None:
                    try:
                        imp = float(val)
                    except (ValueError, TypeError):
                        pass
                    break
            scored.append((imp, meta, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[:8]

        if top:
            lines.append("\n--- COACHING MEMORY (what the coach knows about this user) ---")
            for imp, meta, doc in top:
                snippet = doc.strip().replace("\n", " ")
                if len(snippet) > 220:
                    snippet = snippet[:217] + "..."
                mem_type = meta.get("memory_type") or meta.get("room") or "general"
                lines.append(f"  [{mem_type}] {snippet}")
                memory_hits.append({"text": doc, "memory_type": mem_type, "similarity": 1.0})

    except Exception:
        # No palace or chromadb unavailable — skip gracefully
        pass

    lines.append("--- END SNAPSHOT ---")
    block = "\n".join(lines)
    return {"ok": True, "block": block, "memory_hits": memory_hits}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: mempalace_bridge.py <command> <user_id> [args...]"}), flush=True)
        sys.exit(1)

    command = sys.argv[1]
    user_id = sys.argv[2]

    try:
        if command == "search":
            query = sys.argv[3] if len(sys.argv) > 3 else ""
            n = int(sys.argv[4]) if len(sys.argv) > 4 else 5
            result = cmd_search(user_id, query, n)

        elif command == "store":
            raw = sys.argv[3] if len(sys.argv) > 3 else "{}"
            memory = json.loads(raw)
            result = cmd_store(user_id, memory)

        elif command == "kg_query":
            entity = sys.argv[3] if len(sys.argv) > 3 else ""
            result = cmd_kg_query(user_id, entity)

        elif command == "kg_store":
            raw = sys.argv[3] if len(sys.argv) > 3 else "{}"
            triple = json.loads(raw)
            result = cmd_kg_store(user_id, triple)

        elif command == "context_snapshot":
            raw = sys.argv[3] if len(sys.argv) > 3 else "{}"
            snapshot = json.loads(raw)
            result = cmd_context_snapshot(user_id, snapshot)

        else:
            result = {"ok": False, "error": f"Unknown command: {command}"}

    except Exception as e:
        result = {"ok": False, "error": str(e)}

    print(json.dumps(result), flush=True)
