export const AXIS_TICK = { fontSize: 11, fill: 'var(--color-text-secondary)' };
export const GRID_STROKE = 'var(--color-border)';
export const CHART_MARGIN = { top: 8, right: 12, left: 0, bottom: 0 };
export const Y_AXIS_WIDTH = 44;

export const SERIES = {
  primary: 'var(--color-data-categorical-blue)',
  secondary: 'var(--color-data-categorical-orange)',
  tertiary: 'var(--color-data-categorical-teal)',
  quaternary: 'var(--color-data-categorical-purple)',
  baseline: 'var(--color-data-neutral)',
};

export const MOOD_RAMP = [
  'var(--color-data-purple-1)',
  'var(--color-data-purple-2)',
  'var(--color-data-purple-3)',
  'var(--color-data-purple-4)',
  'var(--color-data-purple-5)',
];

// Soft translucent accent band behind hovered bars (replaces the harsh tint).
export const BAR_CURSOR = { fill: 'var(--color-accent)', fillOpacity: 0.1, radius: 6, className: 'chart-bar-cursor' };
