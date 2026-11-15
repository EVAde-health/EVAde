import { Selector } from '@astryxdesign/core/Selector';
import { useResource } from '../../services/useResource';
import { personName, responseRows, type AstronautOption } from '../../services/surgeon';

// Searchable drop-down of every astronaut (scales to any crew size; type to filter).
export default function AstronautPicker({ value, onChange, label = 'Astronaut' }: {
  value: string | undefined; onChange: (userId: string) => void; label?: string;
}) {
  const { data, error } = useResource<AstronautOption[]>('/admin/astronauts');
  const options = responseRows(data).filter(row => typeof row.user_id === 'string' && row.user_id).map(row => ({
    value: row.user_id,
    label: personName(row),
    description: [row.crew_role ?? 'Astronaut', row.display_name !== personName(row) ? row.display_name : null,
      row.emergency_status === 'open' ? 'EMERGENCY OPEN' : row.emergency_status === 'acknowledged' ? 'emergency in progress' : null]
      .filter(Boolean).join(' · '),
  }));
  return (
    <Selector
      label={label}
      isLabelHidden
      options={options}
      value={value}
      onChange={next => { if (next) onChange(next); }}
      hasSearch
      searchPlaceholder="Search astronauts"
      placeholder={data ? `Choose an astronaut (${options.length})` : 'Loading crew…'}
      emptySearchText="No astronaut matches"
      isDisabled={!data}
      status={error ? { type: 'error', message: error } : undefined}
    />
  );
}
