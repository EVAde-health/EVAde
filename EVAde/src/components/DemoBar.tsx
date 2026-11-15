import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Stack';
import { ArrowPathIcon, ArrowsRightLeftIcon } from '@heroicons/react/20/solid';
import { useToast } from '../context/ToastCenterContext';
import { demoLoginUrl } from '../services/api';
import { resetDemo } from '../services/healthApi';

type Persona = 'astronaut' | 'surgeon';

const COPY: Record<Persona, { title: string; switchLabel: string; other: Persona }> = {
  astronaut: { title: 'Demo: Cmdr. Vega (astronaut)', switchLabel: 'Switch to flight surgeon', other: 'surgeon' },
  surgeon: { title: 'Demo: Dr. Ortiz (flight surgeon)', switchLabel: 'Switch to astronaut', other: 'astronaut' },
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
    <Banner
      status="info"
      title={copy.title}
      description="Everything you do here is saved to the shared demo crew, AI included. Reset puts the seeded data back."
      endContent={
        <HStack gap={1} wrap="wrap">
          <Button label="Reset demo data" size="sm" variant="secondary" icon={<Icon icon={ArrowPathIcon} />} clickAction={handleReset} />
          <Button label={copy.switchLabel} size="sm" variant="primary" icon={<Icon icon={ArrowsRightLeftIcon} />} href={demoLoginUrl(copy.other)} />
        </HStack>
      }
    />
  );
}
