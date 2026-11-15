import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import { useSurgeon } from '../../context/SurgeonContext';
import { acknowledgeEmergency, ago, personName, resolveEmergency, responseRows, type Emergency } from '../../services/surgeon';

// Red drop-down on every surgeon page while any emergency is open or being handled.
// Open: anyone can acknowledge (the first click claims it). Acknowledged: everyone sees who is on it.
export default function EmergencyDropdown() {
  const { notifications, refreshNotifications, user } = useSurgeon();
  const active = responseRows(notifications?.emergencies).filter(item => Number.isInteger(item.id) && (item.status === 'open' || item.status === 'acknowledged'));
  if (!active.length) return null;
  const anyOpen = active.some(item => item.status === 'open');
  return (
    <div className={`emergency-drop${anyOpen ? '' : ' emergency-drop--calm'}`} role={anyOpen ? 'alert' : 'status'} aria-live="assertive">
      {active.map((item, index) => (
        <EmergencyRow key={item.id} item={item} index={index} selfId={user.user_id} onChange={refreshNotifications} />
      ))}
    </div>
  );
}

function EmergencyRow({ item, index, selfId, onChange }: { item: Emergency; index: number; selfId: string; onChange: () => void }) {
  const [busy, setBusy] = useState<'ack' | 'resolve' | null>(null);
  const showToast = useToast();
  const name = personName({ display_name: item.display_name ?? 'An astronaut', full_name: item.full_name });
  const mine = item.acknowledged_by === selfId;

  async function run(kind: 'ack' | 'resolve') {
    setBusy(kind);
    try {
      if (kind === 'ack') {
        const result = await acknowledgeEmergency(item.id);
        showToast({ body: result.claimed ? `You are responding to ${name}.` : result.emergency?.acknowledged_by_name
          ? `${result.emergency.acknowledged_by_name} is already on it.` : 'Emergency updated. Check the queue for the current status.' });
      } else {
        await resolveEmergency(item.id);
        showToast({ body: `Emergency for ${name} resolved.` });
      }
      onChange();
    } catch (error) {
      showToast({ body: error instanceof Error ? error.message : 'That did not go through. Try again.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`emergency-drop__row${item.status === 'open' ? ' emergency-drop__row--open' : ''}`} style={{ '--i': index } as CSSProperties}>
      <span className="emergency-drop__siren" aria-hidden="true" />
      <div className="emergency-drop__text">
        <Text weight="bold">
          {item.status === 'open' ? `EMERGENCY · ${name}` : `${name} · ${mine ? 'you are responding' : `${item.acknowledged_by_name ?? 'A flight surgeon'} is responding`}`}
        </Text>
        <Text type="supporting">{item.message || 'Emergency button pressed (no note).'} · {ago(item.created_at)}</Text>
      </div>
      <Button label="Open record" size="sm" variant="secondary" href={`/admin/astronauts/${item.user_id}/vitals`} />
      <Button label="Message" size="sm" variant="secondary" href={`/admin/messages/${item.user_id}`} />
      {item.status === 'open'
        ? <Button label="Acknowledge" size="sm" variant="primary" onClick={() => run('ack')} isLoading={busy === 'ack'} />
        : <Button label="Resolve" size="sm" variant="primary" onClick={() => run('resolve')} isLoading={busy === 'resolve'} />}
    </div>
  );
}
