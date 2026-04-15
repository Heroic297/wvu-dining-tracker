import React, { useEffect, useRef, useState } from 'react';

interface CoachBrief {
  id: string;
  user_id: string;
  created_at: string;
  brief_text: string | null;
  nutrition_score: number | null;
  training_score: number | null;
  recovery_flag: boolean;
  trigger_source: 'scheduled' | 'live' | null;
}

function ScoreRing({ score, label }: { score: number | null; label: string }) {
  const value = score ?? 0;
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 70 ? '#22c55e' : value >= 40 ? '#eab308' : '#ef4444';

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={radius} fill="none" stroke="#374151" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
        <text x="36" y="40" textAnchor="middle" fontSize="14" fontWeight="bold" fill="white">
          {score !== null ? score : '--'}
        </text>
      </svg>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

export default function CoachBriefCard() {
  const [brief, setBrief] = useState<CoachBrief | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  const fetchBrief = async () => {
    try {
      const res = await fetch('/api/coach-brief');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBrief(data.brief ?? null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load brief');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBrief();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollCountRef.current = 0;
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    const since = new Date().toISOString();

    try {
      const res = await fetch('/api/coach-brief', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      setError(e.message ?? 'Failed to trigger brief');
      setGenerating(false);
      return;
    }

    pollCountRef.current = 0;
    pollRef.current = setInterval(async () => {
      pollCountRef.current++;
      if (pollCountRef.current > 45) {
        stopPolling();
        setGenerating(false);
        setError('Brief generation timed out. Try again.');
        return;
      }
      try {
        const pollRes = await fetch(`/api/coach-brief/poll?since=${encodeURIComponent(since)}`);
        if (!pollRes.ok) return;
        const pollData = await pollRes.json();
        if (pollData.newBrief) {
          stopPolling();
          setGenerating(false);
          await fetchBrief();
        }
      } catch {
        // silently retry
      }
    }, 4000);
  };

  if (loading) {
    return (
      <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6 space-y-4 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-1/3" />
        <div className="flex gap-6">
          <div className="h-20 w-20 bg-gray-700 rounded-full" />
          <div className="h-20 w-20 bg-gray-700 rounded-full" />
        </div>
        <div className="h-4 bg-gray-700 rounded" />
        <div className="h-4 bg-gray-700 rounded w-5/6" />
        <div className="h-4 bg-gray-700 rounded w-4/6" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Macro Coach Brief</h2>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
        >
          {generating ? 'Generating…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">{error}</p>
      )}

      {!brief ? (
        <div className="flex flex-col items-center gap-4 py-8">
          <p className="text-gray-400 text-sm">No brief yet. Generate your first one!</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium transition-colors"
          >
            {generating ? 'Generating…' : 'Generate Now'}
          </button>
        </div>
      ) : (
        <>
          {/* Score rings */}
          <div className="flex gap-6">
            <ScoreRing score={brief.nutrition_score} label="Nutrition" />
            <ScoreRing score={brief.training_score} label="Training" />
          </div>

          {/* Recovery flag */}
          {brief.recovery_flag && (
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-300 bg-red-950 border border-red-700 rounded-full px-3 py-1">
              <span>⚠️</span> Recovery Alert
            </div>
          )}

          {/* Brief text */}
          {brief.brief_text && (
            <pre
              style={{ whiteSpace: 'pre-wrap' }}
              className="text-sm text-gray-200 font-sans leading-relaxed"
            >
              {brief.brief_text}
            </pre>
          )}

          {/* Footer metadata */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-800">
            <span className="text-xs text-gray-500">
              {new Date(brief.created_at).toLocaleString()}
            </span>
            {brief.trigger_source && (
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  brief.trigger_source === 'live'
                    ? 'bg-indigo-900 text-indigo-300'
                    : 'bg-gray-800 text-gray-400'
                }`}
              >
                {brief.trigger_source}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
