import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { PauseCircleIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { setReducedMotion, useReducedMotion } from '../hooks/useReducedMotion';

// Toggles EVAde's in-app "reduce motion" preference.
export default function MotionToggle({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const reduced = useReducedMotion();
  const label = reduced ? 'Turn animations on' : 'Reduce motion';

  return (
    <IconButton
      label={label}
      tooltip={label}
      size={size}
      variant="ghost"
      icon={<Icon icon={reduced ? SparklesIcon : PauseCircleIcon} />}
      onClick={() => setReducedMotion(!reduced)}
    />
  );
}
