import { useParams } from 'react-router-dom';
import { VStack } from '@astryxdesign/core/Stack';
import Messenger from '../../components/Messenger';
import PageHeader from '../../components/PageHeader';
import { useSurgeon } from '../../context/SurgeonContext';

export default function SurgeonMessagesPage() {
  const { id } = useParams();
  const { user, refreshNotifications } = useSurgeon();
  return (
    <VStack gap={5} padding={6} className="surgeon-page">
      <PageHeader eyebrow="Flight surgeon console" title="Messages" description="Private 1:1 threads with each astronaut. New messages arrive within a few seconds." />
      <Messenger selfId={user.user_id} basePath="/admin/messages" otherId={id} onRead={refreshNotifications} />
    </VStack>
  );
}