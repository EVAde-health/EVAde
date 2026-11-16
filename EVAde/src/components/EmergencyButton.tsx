import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/Stack';
import { useToast } from '../context/ToastCenterContext';
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid';
import { raiseEmergency } from '../services/surgeon';
import './surgeon/surgeon.css';

const HOLD_MS = 1750;

// Press and hold (about 1.75 s, mouse, touch or Space/Enter) to alert every flight surgeon.
// Letting go early cancels. An optional note can be added first.
export default function EmergencyButton({ onSent }: { onSent?: () => void }) {
  const [fill, setFill] = useState(0);
  const [holding, setHolding] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const frame = useRef<number | null>(null);
  const started = useRef(0);
  const showToast = useToast();

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  async function fire() {
    setSending(true);
    try {
      const result = await raiseEmergency(note);
      setSent(true);
      setNote('');
      setNoteOpen(false);
      showToast({ body: result.already ? 'Your emergency is already open. The flight surgeons can see it.' : 'Emergency sent. Every flight surgeon on duty has been alerted.' });
      onSent?.();
      window.dispatchEvent(new Event('evade:emergency-sent'));
      window.setTimeout(() => setSent(false), 4000);
    } catch (error) {
      showToast({ body: error instanceof Error ? error.message : 'The emergency could not be sent. Use your backup channel.' });
    } finally {
      setSending(false);
      setFill(0);
    }
  }

  function start() {
    if (sending || holding) return;
    setHolding(true);
    started.current = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started.current) / HOLD_MS);
      setFill(progress);
      if (progress >= 1) {
        frame.current = null;
        setHolding(false);
        void fire();
        return;
      }
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }

  function cancel() {
    if (!frame.current) return;
    cancelAnimationFrame(frame.current);
    frame.current = null;
    setHolding(false);
    setFill(0);
  }

  const label = sending ? 'Sending…' : sent ? 'Emergency sent' : holding ? 'Keep holding…' : 'Hold for emergency';
  return (
    <VStack gap={1.5}>
      {noteOpen && (
        <TextArea label="What is happening? (optional)" value={note} onChange={setNote} maxLength={500} rows={2} size="sm" />
      )}
      <button
        type="button"
        className="hold-button"
        data-holding={holding}
        data-done={sent || sending}
        style={{ '--fill': sent || sending ? 1 : fill } as CSSProperties}
        aria-label="Emergency: press and hold for about two seconds to alert the flight surgeons"
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); start(); }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); start(); } }}
        onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') cancel(); }}
        onBlur={cancel}
        onContextMenu={event => event.preventDefault()}
      >
        <span className="hold-button__fill" aria-hidden="true" />
        <span className="hold-button__label"><Icon icon={ExclamationTriangleIcon} size="sm" /> {label}</span>
      </button>
      {!noteOpen
        ? <Button label="Add a note first" size="sm" variant="ghost" onClick={() => setNoteOpen(true)} />
        : <Text type="supporting">The note is sent with the alert.</Text>}
    </VStack>
  );
}