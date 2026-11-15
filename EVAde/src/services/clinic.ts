// Small shared helpers for role and risk-band labels. Console data types live in ./surgeon.ts.
export function roleLabel(role: string) {
  if (role === 'flight_surgeon') return 'Flight surgeon';
  if (role === 'therapist') return 'Therapist';
  if (role === 'admin') return 'Admin';
  return 'Astronaut';
}

export function bandStatus(band: string | null | undefined) {
  if (band === 'high' || band === 'critical' || band === 'red') return 'critical' as const;
  if (band === 'guarded' || band === 'elevated' || band === 'moderate' || band === 'yellow') return 'caution' as const;
  return 'nominal' as const;
}