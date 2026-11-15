import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { List, ListItem } from '@astryxdesign/core/List';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { useToast } from '@astryxdesign/core/Toast';
import SectionTitle from '../../components/SectionTitle';
import AstronautFrame from './AstronautFrame';
import { api } from '../../services/api';
import type { Goal, GoalChange } from '../../services/clinic';
import { useResource } from '../../services/useResource';

const BOUNDS: Record<string, [number, number]> = {
  kcal_intake: [800, 6000],
  protein_intake_g: [0, 400],
  carbs_intake_g: [0, 800],
  fat_intake_g: [0, 300],
  water_intake_ml: [250, 10000],
  sleep_hours: [4, 12],
};

function GoalCard({ goal, astronautId, onSaved }: { goal: Goal; astronautId: string; onSaved: () => void }) {
  const [target, setTarget] = useState(goal.target);
  const [note, setNote] = useState(goal.note ?? '');
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  const [min, max] = BOUNDS[goal.metric] ?? [0, 1_000_000];

  async function save() {
    setSaving(true);
    try {
      await api(`/admin/astronauts/${astronautId}/goals`, {
        method: 'POST',
        body: { metric: goal.metric, target, note: note.trim() || undefined },
      });
      showToast({ body: `${goal.label} goal saved.` });
      onSaved();
    } catch (error) {
      showToast({ body: error instanceof Error ? error.message : 'The goal could not be saved.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center">
          <Text type="label">{goal.label}</Text>
          <Text type="supporting">{goal.source === 'set' ? 'Set for this astronaut' : 'Mission default'}</Text>
        </HStack>
        <NumberInput label={`${goal.label} target`} value={target} onChange={setTarget} min={min} max={max} units={goal.unit} />
        <TextInput label="Note" isOptional value={note} onChange={setNote} placeholder="Why this target" />
        <Button label="Save goal" variant="primary" onClick={save} isLoading={saving} isDisabled={target === goal.target && (note || '') === (goal.note ?? '')} />
      </VStack>
    </Card>
  );
}

export default function GoalsPage() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useResource<{ goals: Goal[]; history: GoalChange[] }>(`/admin/astronauts/${id}/goals`);
  return (
    <AstronautFrame>
      {loading && !data && <Text role="status">Loading goals…</Text>}
      {error && <Text role="alert">{error}</Text>}
      {data && (
        <VStack gap={6}>
          <SectionTitle title="Daily goals" caption="Each save keeps the previous target in the history below." />
          <Grid columns={{ minWidth: 260, max: 3 }} gap={4}>
            {data.goals.map(goal => (
              <GoalCard key={`${goal.metric}:${goal.effective_at ?? 'default'}`} goal={goal} astronautId={id} onSaved={reload} />
            ))}
          </Grid>
          <SectionTitle title="Goal history" caption="Newest change first." />
          {data.history.length ? (
            <List hasDividers>
              {data.history.map(change => (
                <ListItem
                  key={change.id}
                  label={`${change.label}: ${change.target} ${change.unit}`}
                  description={<HStack gap={2}><Text type="supporting">{change.set_by_name || 'Staff'}{change.note ? ` · ${change.note}` : ''}</Text></HStack>}
                  endContent={change.effective_at ? <Timestamp value={change.effective_at} /> : undefined}
                />
              ))}
            </List>
          ) : <Text type="supporting">No goal has been changed yet. The cards above are the mission defaults.</Text>}
        </VStack>
      )}
    </AstronautFrame>
  );
}
