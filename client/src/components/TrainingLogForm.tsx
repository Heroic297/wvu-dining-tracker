import React, { useRef, useState } from 'react';

const EXERCISE_LIST = [
  'Squat',
  'Bench Press',
  'Deadlift',
  'Low Bar Squat',
  'High Bar Squat',
  'Pause Squat',
  'Close Grip Bench',
  'Pause Bench',
  'Sumo Deadlift',
  'Romanian Deadlift',
  'Deficit Deadlift',
  'Overhead Press',
  'Barbell Row',
  'Pull-Up',
  'Lat Pulldown',
  'Hip Thrust',
];

interface TrainingLogFormProps {
  onLogSaved?: (log: any) => void;
}

export default function TrainingLogForm({ onLogSaved }: TrainingLogFormProps) {
  const [exercise, setExercise] = useState('');
  const [sets, setSets] = useState('');
  const [reps, setReps] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [rpe, setRpe] = useState('');
  const [notes, setNotes] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [submitState, setSubmitState] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const exerciseRef = useRef<HTMLDivElement>(null);

  const filtered = exercise.trim()
    ? EXERCISE_LIST.filter((e) => e.toLowerCase().includes(exercise.toLowerCase()))
    : EXERCISE_LIST;

  const handleExerciseChange = (val: string) => {
    setExercise(val);
    setShowSuggestions(true);
    setSubmitState('idle');
  };

  const selectExercise = (name: string) => {
    setExercise(name);
    setShowSuggestions(false);
  };

  const resetForm = () => {
    setExercise('');
    setSets('');
    setReps('');
    setWeightKg('');
    setRpe('');
    setNotes('');
    setShowSuggestions(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitState('idle');
    setErrorMsg('');

    try {
      const body: Record<string, any> = {
        exercise: exercise.trim(),
        sets: parseInt(sets, 10),
        reps: parseInt(reps, 10),
        weight_kg: parseFloat(weightKg),
      };
      if (rpe.trim()) body.rpe = parseFloat(rpe);
      if (notes.trim()) body.notes = notes.trim();

      const res = await fetch('/api/training-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setSubmitState('success');
      onLogSaved?.(data.log);
      resetForm();
    } catch (err: any) {
      setSubmitState('error');
      setErrorMsg(err.message ?? 'Failed to save log');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl bg-gray-900 border border-gray-800 p-6 space-y-4"
    >
      <h2 className="text-lg font-semibold text-white">Log Training Set</h2>

      {/* Exercise autocomplete */}
      <div className="relative" ref={exerciseRef}>
        <label className="block text-xs text-gray-400 mb-1">Exercise *</label>
        <input
          type="text"
          value={exercise}
          onChange={(e) => handleExerciseChange(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="e.g. Squat"
          required
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {showSuggestions && filtered.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {filtered.map((name) => (
              <li
                key={name}
                onMouseDown={() => selectExercise(name)}
                className="px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 cursor-pointer"
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sets / Reps / Weight row */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Sets *</label>
          <input
            type="number"
            min="1"
            value={sets}
            onChange={(e) => setSets(e.target.value)}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Reps *</label>
          <input
            type="number"
            min="1"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Weight (kg) *</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* RPE */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">RPE (1–10, optional)</label>
        <input
          type="number"
          min="1"
          max="10"
          step="0.5"
          value={rpe}
          onChange={(e) => setRpe(e.target.value)}
          placeholder="e.g. 8.5"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Paused reps, belt, sleeves…"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Feedback messages */}
      {submitState === 'success' && (
        <p className="text-sm text-green-400 font-medium">✓ Logged!</p>
      )}
      {submitState === 'error' && (
        <p className="text-sm text-red-400">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
      >
        {submitting ? 'Saving…' : 'Log Set'}
      </button>
    </form>
  );
}
