import type { Metadata } from 'next';
import { DinnerForm } from './DinnerForm';

export const metadata: Metadata = { title: 'Dinner' };

export default function DinnerPage() {
  return (
    <div>
      <h1>Dinner from a photo</h1>
      <p className="muted">
        Snap what&rsquo;s in your fridge or on the counter and get the best dinner you can make
        with it — maximizing taste and nutrition. Not everything in the photo has to be used.
      </p>
      <DinnerForm />
    </div>
  );
}
