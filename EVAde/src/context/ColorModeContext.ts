import { createContext, useContext } from 'react';
import type { ColorMode } from '../hooks/useColorMode';

export interface ColorModeValue {
  mode: ColorMode;
  toggleMode: (origin?: { x: number; y: number }) => void;
}

export const ColorModeContext = createContext<ColorModeValue>({ mode: 'dark', toggleMode: () => {} });

// Reads the current color mode and its toggle.
export function useColorModeContext() {
  return useContext(ColorModeContext);
}
