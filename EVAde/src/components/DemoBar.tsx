import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Stack';
import { ArrowPathIcon, ArrowsRightLeftIcon } from '@heroicons/react/20/solid';
import { useToast } from '../context/ToastCenterContext';
import { demoLoginUrl } from '../services/api';
import { resetDemo } from '../services/healthApi';

type Persona = 'astronaut' | 'surgeon';

const COPY: Record<Persona, { title: string; other: Persona }> = {
  astronaut: { title: 'Demo Astronaut', other: 'surgeon' },
  surgeon: { title: 'Demo Flight Surgeon', other: 'astronaut' },
};

// Shared-demo controls on every page: reset the demo crew or switch persona.
export default function DemoBar({ persona }: { persona: Persona }) {
  const showToast = useToast();
  const copy = COPY[persona];

  // Restores the seeded demo crew, then reloads so every panel refetches.
  async function handleReset() {
    try {
      await resetDemo();
    } catch {
      showToast({ body: 'The demo could not be reset. Try again in a minute.' });
      return;
    }
    showToast({ body: 'Demo data reset.' });
    window.location.reload();
  }

  return (
    <HStack className="demo-bar">
      <Banner
        status="info"
        title={copy.title}
        description="Changes stay on this shared demo until you reset. Switch users to see the other role. Nothing is checked until you check it."
        endContent={
          <HStack gap={1} wrap="wrap">
            <Button label="Reset database" size="sm" variant="secondary" icon={<Icon icon={ArrowPathIcon} />} clickAction={handleReset} />
            <Button label="Switch users" size="sm" variant="primary" icon={<Icon icon={ArrowsRightLeftIcon} />} href={demoLoginUrl(copy.other)} />
          </HStack>
        }
      />
    </HStack>
  );
}
