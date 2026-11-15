import type { MouseEvent } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { useColorModeContext } from '../context/ColorModeContext';

// Sun/moon button that reveals the other theme from the click point.
export default function ThemeToggle({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const { mode, toggleMode } = useColorModeContext();
  const label = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  // Passes the button center so the reveal grows from it.
  function handleClick(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    toggleMode({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }

  return (
    <IconButton
      label={label}
      tooltip={label}
      size={size}
      variant="ghost"
      icon={<Icon icon={mode === 'dark' ? SunIcon : MoonIcon} />}
      onClick={handleClick}
    />
  );
}
