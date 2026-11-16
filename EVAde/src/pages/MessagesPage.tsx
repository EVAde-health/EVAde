import { useParams } from 'react-router-dom';
import { VStack } from '@astryxdesign/core/Stack';
import Messenger from '../components/Messenger';
import PageHeader from '../components/PageHeader';
import { useMission } from '../context/MissionContext';

// Astronaut side: 1:1 threads with the flight surgeons.
export default function MessagesPage() {
  const { id } = useParams();
  const { user } = useMission();
  return (
    <VStack gap={5} padding={6} className="page">
      <PageHeader eyebrow="Ground link" title="Messages" description="Private 1:1 messages with your flight surgeons." />
      <Messenger selfId={user.user_id} basePath="/messages" otherId={id} onRead={() => window.dispatchEvent(new Event('evade:messages-read'))} />
    </VStack>
  );
}