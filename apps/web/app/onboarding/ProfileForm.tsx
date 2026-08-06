'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MODALITY_LABELS, modalityLabel } from '../../lib/labels';

const today = () => new Date().toISOString().slice(0, 10);

export interface ProfileFormValues {
  age: number;
  trainingAgeYears: number;
  weeklyBudgetMinutes: number;
  vo2CapableModalities: string[];
  equipment: string[];
  hardConstraints: string[];
}

/** Modalities on which Z5/threshold work is physiologically prescribable (I9). */
const VO2_CANDIDATES = ['run', 'airBike', 'row', 'swim', 'spinBike', 'hike'];

export function ProfileForm({ initial }: { initial: ProfileFormValues }) {
  const router = useRouter();
  const [age, setAge] = useState(initial.age);
  const [trainingAge, setTrainingAge] = useState(initial.trainingAgeYears);
  const [budget, setBudget] = useState(initial.weeklyBudgetMinutes);
  const [vo2, setVo2] = useState<string[]>(initial.vo2CapableModalities);
  const [equipment, setEquipment] = useState(initial.equipment.join(', '));
  const [constraints, setConstraints] = useState(initial.hardConstraints.join(', '));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function toggleVo2(m: string) {
    setVo2((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  const splitList = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'profile-update',
          occurredAt: `${today()}T09:00:00Z`,
          fields: {
            age,
            trainingAgeYears: trainingAge,
            weeklyBudgetMinutes: budget,
            vo2CapableModalities: vo2,
            equipment: splitList(equipment),
            hardConstraints: splitList(constraints),
          },
        }),
      });
      const body = await res.json();
      if (body.error) setNotice({ kind: 'error', text: body.error });
      else {
        setNotice({ kind: 'ok', text: 'Profile updated — recorded as a declared-fact event.' });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Age
        <input type="number" min={10} max={110} value={age} onChange={(e) => setAge(Number(e.target.value))} />
      </label>
      <label>
        Training age (years)
        <input
          type="number"
          min={0}
          max={90}
          value={trainingAge}
          onChange={(e) => setTrainingAge(Number(e.target.value))}
        />
      </label>
      <label>
        Weekly training budget (minutes)
        <input type="number" min={30} max={2400} step={15} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
      </label>
      <fieldset className="checkgroup">
        <legend>
          VO₂-capable modalities — interval work is only ever prescribed on these (I9)
        </legend>
        {VO2_CANDIDATES.map((m) => (
          <label key={m} className="check">
            <input type="checkbox" checked={vo2.includes(m)} onChange={() => toggleVo2(m)} />
            {MODALITY_LABELS[m] ?? modalityLabel(m)}
          </label>
        ))}
      </fieldset>
      <label>
        Equipment (comma-separated)
        <input value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder="barbell, rack, airBike" />
      </label>
      <label>
        Hard constraints (comma-separated)
        <input
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          placeholder="e.g. no barbell overhead pressing"
        />
      </label>
      <button type="submit" disabled={busy || vo2.length === 0}>
        {busy ? 'Saving…' : 'Save profile'}
      </button>
      {vo2.length === 0 && (
        <span className="muted">At least one VO₂-capable modality is required — the engine refuses to prescribe intervals with none.</span>
      )}
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    </form>
  );
}
