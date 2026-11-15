import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Heading, Text } from '@astryxdesign/core/Text';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useToast } from '@astryxdesign/core/Toast';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { api } from '../services/api';
import type { Emergency } from '../services/clinic';
import { useResource } from '../services/useResource';
import './css/Clinic.css';

export function EmergencyBanner() {
  const { data } = useResource<{ emergencies: Emergency[] }>('/emergencies/mine');
  const open = data?.emergencies.find(item => item.status !== 'resolved');
  if (!open) return null;
  return (
    <Banner
      status={open.status === 'open' ? 'error' : 'warning'}
      title={open.status === 'open' ? 'Flight surgeons have your emergency' : 'A flight surgeon acknowledged your emergency'}
      description={open.message || 'Stay on the link. Help is being coordinated.'}
    />
  );
}

export default function EmergencyButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const showToast = useToast();

  async function send() {
    setSending(true);
    try {
      const result = await api<{ already: boolean }>('/emergencies', {
        method: 'POST',
        body: { message: message.trim() || undefined },
      });
      showToast({ body: result.already ? 'The flight surgeon already has your open emergency.' : 'Emergency sent to the flight surgeon team.' });
      setOpen(false);
      setMessage('');
    } catch (error) {
      showToast({ body: error instanceof Error ? error.message : 'The emergency could not be sent.' });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        label="Emergency"
        variant="destructive"
        icon={<Icon icon={ExclamationTriangleIcon} />}
        className="emergency-launch"
        onClick={() => setOpen(true)}
      />
      <Dialog isOpen={open} onOpenChange={setOpen} purpose="form" width={480}>
        <VStack gap={4} padding={2}>
          <VStack gap={1}>
            <Heading level={2}>Contact the flight surgeon</Heading>
            <Text color="secondary">This alerts every flight surgeon, therapist, and admin on console. Use it for a medical emergency.</Text>
          </VStack>
          <TextArea label="What is happening?" description="Optional. A short note helps the team respond." isOptional value={message} onChange={setMessage} />
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="secondary" onClick={() => setOpen(false)} isDisabled={sending} />
            <Button label="Send emergency" variant="destructive" onClick={send} isLoading={sending} />
          </HStack>
        </VStack>
      </Dialog>
    </>
  );
}
