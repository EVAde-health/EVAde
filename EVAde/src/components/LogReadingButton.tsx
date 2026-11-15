import { useState, type ComponentProps } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { PlusCircleIcon } from '@heroicons/react/24/outline';
import LogReadingDialog from './LogReadingDialog';

type ButtonProps = ComponentProps<typeof Button>;

interface LogReadingButtonProps {
  metric?: string;
  label?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}

// Button that opens the log-a-reading dialog, optionally with a metric preselected.
export default function LogReadingButton({ metric, label = 'Log reading', variant = 'ghost', size = 'sm' }: LogReadingButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button label={label} variant={variant} size={size} icon={<Icon icon={PlusCircleIcon} />} onClick={() => setIsOpen(true)} />
      {isOpen && <LogReadingDialog initialMetric={metric} onClose={() => setIsOpen(false)} />}
    </>
  );
}
