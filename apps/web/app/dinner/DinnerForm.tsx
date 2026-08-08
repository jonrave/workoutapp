'use client';

import { useRef, useState } from 'react';

interface DinnerResult {
  ingredients: string[];
  suggestion: {
    title: string;
    why: string;
    usedIngredients: string[];
    pantryStaplesAssumed: string[];
    steps: string[];
    totalTimeMinutes: number;
    nutritionNotes: string;
  };
  alternatives: { title: string; summary: string }[];
}

/** Longest edge sent to the API; enough detail to identify ingredients, small upload. */
const MAX_EDGE = 1568;

async function resizeToJpegBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable in this browser');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

export function DinnerForm() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [preferences, setPreferences] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DinnerResult | null>(null);

  function onPick(file: File | undefined) {
    setResult(null);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  async function suggest() {
    const file = fileInput.current?.files?.[0];
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const image = await resizeToJpegBase64(file);
      const res = await fetch('/api/dinner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          image,
          mediaType: 'image/jpeg',
          preferences: preferences.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? `Request failed (${res.status})`);
      } else {
        setResult(json.result as DinnerResult);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void suggest();
          }}
        >
          <label>
            Photo of your ingredients
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => onPick(e.target.files?.[0])}
            />
          </label>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Your ingredients"
              style={{ maxWidth: '100%', maxHeight: '20rem', borderRadius: 8, objectFit: 'contain', justifySelf: 'start' }}
            />
          )}
          <label>
            Preferences or constraints (optional)
            <input
              type="text"
              value={preferences}
              placeholder="e.g. vegetarian, no dairy, 30 minutes max"
              maxLength={500}
              onChange={(e) => setPreferences(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !previewUrl}>
            {busy ? 'Thinking…' : 'Suggest dinner'}
          </button>
        </form>
        {busy && (
          <p className="muted">Identifying ingredients and picking the best meal — this can take a minute.</p>
        )}
        {error && <div className="notice error">{error}</div>}
      </div>

      {result && (
        <>
          <div className="card headline">
            <h2>Tonight&rsquo;s pick</h2>
            <p className="big">{result.suggestion.title}</p>
            <p>
              <span className="pill ok">~{Math.round(result.suggestion.totalTimeMinutes)} min</span>
            </p>
            <p>{result.suggestion.why}</p>
            <ol>
              {result.suggestion.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <p className="muted">
              Uses: {result.suggestion.usedIngredients.join(', ') || '—'}
              {result.suggestion.pantryStaplesAssumed.length > 0 &&
                ` · assumes on hand: ${result.suggestion.pantryStaplesAssumed.join(', ')}`}
            </p>
            <p className="muted">Nutrition: {result.suggestion.nutritionNotes}</p>
          </div>

          <div className="card">
            <h2>What I saw in the photo</h2>
            <p>
              {result.ingredients.length > 0
                ? result.ingredients.map((ing) => (
                    <span key={ing} className="pill">
                      {ing}
                    </span>
                  ))
                : 'No recognizable ingredients.'}
            </p>
          </div>

          {result.alternatives.length > 0 && (
            <div className="card">
              <h2>Also worth considering</h2>
              <ul>
                {result.alternatives.map((alt) => (
                  <li key={alt.title}>
                    <strong>{alt.title}</strong> — {alt.summary}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
