import { Token } from '@astryxdesign/core/Token';
import type { Evidence } from '../data/research';

const EVIDENCE_STYLE: Record<Evidence, { label: string; color: 'green' | 'blue' | 'gray' | 'orange'; description: string }> = {
  measured: { label: 'Measured', color: 'green', description: 'Instrument or crew data from a published study' },
  modelled: { label: 'Modelled', color: 'blue', description: 'Simulation or transport-code estimate' },
  derived: { label: 'Derived', color: 'gray', description: 'Our arithmetic on a published value' },
  preprint: { label: 'Preprint', color: 'orange', description: 'Not yet peer reviewed' },
};

// Small tag saying how a research value was obtained.
export default function EvidenceToken({ evidence }: { evidence: Evidence }) {
  const style = EVIDENCE_STYLE[evidence];
  return <Token label={style.label} color={style.color} size="sm" description={style.description} />;
}
