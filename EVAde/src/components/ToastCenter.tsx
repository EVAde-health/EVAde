import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Stack';
import { useToast as useAstryxToast, type ShowToastFn, type ToastOptions } from '@astryxdesign/core/Toast';
import { XMarkIcon } from '@heroicons/react/20/solid';
import { ToastCenterContext } from '../context/ToastCenterContext';
import './css/ToastCenter.css';

// Tracks every open toast so the stack can be closed at once ("Close all").
export default function ToastCenter({ children }: { children: ReactNode }) {
  const showAstryx = useAstryxToast();
  const dismissers = useRef(new Map<number, () => void>());
  const nextId = useRef(0);
  const [openCount, setOpenCount] = useState(0);

  // Shows a toast and remembers how to dismiss it until it hides.
  const show = useCallback<ShowToastFn>((options: ToastOptions) => {
    const id = nextId.current++;
    const dismiss = showAstryx({
      isAutoHide: true,
      autoHideDuration: 6000,
      ...options,
      onHide: reason => {
        dismissers.current.delete(id);
        setOpenCount(dismissers.current.size);
        options.onHide?.(reason);
      },
    });
    dismissers.current.set(id, dismiss);
    setOpenCount(dismissers.current.size);
    return dismiss;
  }, [showAstryx]);

  // Dismisses every toast currently on screen.
  function closeAll() {
    [...dismissers.current.values()].forEach(dismiss => dismiss());
    dismissers.current.clear();
    setOpenCount(0);
  }

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastCenterContext.Provider value={value}>
      {children}
      {openCount >= 2 && (
        <HStack className="toast-center__close-all">
          <Button label={`Close all (${openCount})`} size="sm" variant="secondary" icon={<Icon icon={XMarkIcon} />} onClick={closeAll} />
        </HStack>
      )}
    </ToastCenterContext.Provider>
  );
}

