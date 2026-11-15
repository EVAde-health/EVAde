import { useEffect, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { usePoll } from '../hooks/usePoll';
import { markNotificationsRead, type Emergency, type UserNotification } from '../services/surgeon';
import './surgeon/surgeon.css';

// Top-of-page notices for the astronaut: emergency status ("A flight surgeon is responding")
// and unread notes from flight surgeons (goal changes, corrected readings, resolved emergencies).
export default function AstronautNotices({ readOnly }: { readOnly: boolean }) {
  const emergencies = usePoll<{ emergencies: Emergency[] }>(readOnly ? null : '/emergencies/mine', 5000);
  const notes = usePoll<{ notifications: UserNotification[]; unread: number }>('/me/notifications?unread=1', 10000);
  const [hidden, setHidden] = useState<number[]>([]);
  const { reload } = emergencies;

  useEffect(() => {
    window.addEventListener('evade:emergency-sent', reload);
    return () => window.removeEventListener('evade:emergency-sent', reload);
  }, [reload]);

  const active = emergencies.data?.emergencies.find(item => item.status !== 'resolved');
  const unread = (notes.data?.notifications ?? []).filter(item => !hidden.includes(item.id) && item.kind !== 'emergency_acknowledged').slice(0, 3);

  function dismiss(id: number) {
    setHidden(previous => [...previous, id]);
    if (!readOnly) markNotificationsRead([id]).then(notes.reload, () => undefined);
  }

  if (!active && !unread.length) return null;
  return (
    <div className="notice-stack">
      {active && (
        <Banner
          status={active.status === 'open' ? 'error' : 'warning'}
          title={active.status === 'open' ? 'Emergency sent. Waiting for a flight surgeon…' : 'A flight surgeon is responding'}
          description={active.status === 'open'
            ? 'Every flight surgeon on duty can see your alert. Stay where you are if it is safe; use your backup channel if you need to.'
            : `${active.acknowledged_by_name ?? 'Your flight surgeon'} acknowledged your emergency${active.acknowledged_at ? ` at ${new Date(active.acknowledged_at).toLocaleTimeString()}` : ''}.`}
        />
      )}
      {unread.map(item => (
        <Banner
          key={item.id}
          status={item.kind === 'emergency_resolved' ? 'success' : 'info'}
          title={item.title}
          description={item.body}
          isDismissable
          dismissLabel="Mark as read"
          onDismiss={() => dismiss(item.id)}
        />
      ))}
    </div>
  );
}