import { useEffect, useState } from 'react';
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

export function EmergencyBanner() {
  const { data, reload } = useResource<{ emergencies: Emergency[] }>('/emergencies/mine');
  useEffect(() => {
    const timer = window.setInterval(reload, 12000);
    return () => window.clearInterval(timer);
  }, [reload]);
  const open = data?.emergencies.find(item => item.status !== 'resolved');
  if (!open) return null;
  return (
    <Banner
      status={open.status === 'open' ? 'error' : 'warning'}
      title={open.status === 'open' ? 'Emergency sent to the staff console' : 'A flight surgeon acknowledged your emergency'}
      description={open.message || 'The console will show when a staff member acknowledges it.'}
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
      showToast({ body: result.already ? 'An emergency is already open in the staff console.' : 'Emergency sent to the flight surgeon team.' });
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
        onClick={() => setOpen(true)}
      />
      <Dialog isOpen={open} onOpenChange={setOpen} purpose="form" width={480}>
        <VStack gap={4} padding={2}>
          <VStack gap={1}>
            <Heading level={2}>Contact the flight surgeon</Heading>
            <Text color="secondary">This sends an alert to the EVAde staff console. For urgent help, use your established emergency channel.</Text>
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
