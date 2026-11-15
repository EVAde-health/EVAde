import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { PlayCircleIcon, SignalSlashIcon } from '@heroicons/react/24/outline';
import './css/NoReadings.css';

interface NoReadingsProps {
  what: string;
  hint?: string;
  hasTutorialLink?: boolean;
}

// Placeholder shown when a panel has no readings in the database yet.
export default function NoReadings({ what, hint, hasTutorialLink = true }: NoReadingsProps) {
  return (
    <EmptyState
      isCompact
      icon={<Icon icon={SignalSlashIcon} size="lg" color="secondary" />}
      title="No readings yet"
      description={hint ?? `${what} will appear here once your first reading syncs.`}
      actions={hasTutorialLink ? <Button label="How to measure" size="sm" variant="ghost" href="/tutorials" icon={<Icon icon={PlayCircleIcon} />} /> : undefined}
    />
  );
}
