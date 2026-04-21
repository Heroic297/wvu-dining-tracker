#!/usr/bin/env python3
"""
mempalace_bridge.py — Python sidecar for MemPalace coach memory.

Called by memoryBridge.ts via spawn(), same pattern as garmin_sidecar.py.
All output is JSON to stdout. Errors are JSON {"ok": false, "error": "..."}.

Commands:
  search  <user_id> <query>              — semantic search over coaching memories
  store   <user_id> <memory_json>        — store a new coaching memory
  kg_query <user_id> <entity>            — query knowledge graph for an entity
  kg_store <user_id> <triple_json>       — persist a KG triple
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

        else:
            result = {"ok": False, "error": f"Unknown command: {command}"}

    except Exception as e:
        result = {"ok": False, "error": str(e)}

    print(json.dumps(result), flush=True)
