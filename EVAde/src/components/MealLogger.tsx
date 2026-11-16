import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { Typeahead, TypeaheadItem } from '@astryxdesign/core/Typeahead';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Icon } from '@astryxdesign/core/Icon';
import { useToast } from '../context/ToastCenterContext';
import { CakeIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { createFoodSearchSource, macrosForPortion, type FoodItem } from '../services/foodSearch';
import { useMission } from '../context/MissionContext';
import { MEAL_XP } from '../data/tasks';
import PanelCard from './PanelCard';

const foodSource = createFoodSearchSource();
const DEFAULT_GRAMS = 100;

// One line summarizing a food's macros.
function macroLine(macros: { kcal: number; protein: number; carbs: number; fat: number }) {
  return `${macros.kcal} kcal · ${macros.protein} g protein · ${macros.carbs} g carbs · ${macros.fat} g fat`;
}

// Search foods, choose a portion and log it toward nutrition goals.
export default function MealLogger() {
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [grams, setGrams] = useState(DEFAULT_GRAMS);
  const [saving, setSaving] = useState(false);
  const { meals, addMeal, removeMeal, loading } = useMission();
  const showToast = useToast();
  const portion = selected?.auxiliaryData ? macrosForPortion(selected.auxiliaryData.per100g, grams) : null;

  // Saves the chosen food and portion as a meal entry.
  async function logMeal() {
    if (!selected || !portion || saving) return;
    setSaving(true);
    try {
      const xp = await addMeal({ name: selected.label, grams, macros: portion });
      showToast({ body: xp ? `🍽️ Logged ${selected.label} · +${xp} XP` : `🍽️ Logged ${selected.label}` });
      setSelected(null);
      setGrams(DEFAULT_GRAMS);
    } catch {
      showToast({ body: 'The meal could not be saved. Try again.' });
    } finally {
      setSaving(false);
    }
  }

  // Removes a logged meal, reporting failures with a toast.
  async function deleteMeal(id: string) {
    try {
      await removeMeal(id);
    } catch {
      showToast({ body: 'The meal could not be removed. Try again.' });
    }
  }

  return (
    <PanelCard title="Nutrition log" subtitle="Search foods — macros are calculated per portion" icon={CakeIcon}>
      <Grid columns={{ minWidth: 220, max: 2 }} gap={3}>
        <Typeahead<FoodItem>
          label="Food"
          placeholder="Search e.g. oatmeal, salmon, tortilla"
          searchSource={foodSource}
          value={selected}
          onChange={setSelected}
          startIcon={MagnifyingGlassIcon}
          minQueryLength={2}
          debounceMs={300}
          emptySearchText="No foods found — try a simpler name"
          renderItem={item => (
            <TypeaheadItem
              item={item}
              description={`${item.auxiliaryData?.source}${item.auxiliaryData?.brand ? ` · ${item.auxiliaryData.brand}` : ''} · ${item.auxiliaryData?.per100g.kcal} kcal/100 g`}
            />
          )}
        />
        <NumberInput label="Portion" value={grams} onChange={setGrams} min={1} max={2000} step={10} units="g" hasNumberSteppers />
      </Grid>

      {portion && (
        <HStack gap={3} vAlign="center" wrap="wrap" className="rise-in">
          <StackItem size="fill">
            <Text type="supporting">{macroLine(portion)}</Text>
          </StackItem>
          <Button label={`Log meal · +${MEAL_XP} XP`} variant="primary" icon={<Icon icon={PlusIcon} />} onClick={logMeal} isLoading={saving} isDisabled={loading} />
        </HStack>
      )}

      {meals.length === 0 ? (
        <EmptyState isCompact title="No meals logged yet" description={`Each meal you log earns +${MEAL_XP} XP (up to 6 a day).`} />
      ) : (
        <List hasDividers edge="flush" density="compact">
          {meals.map(meal => (
            <ListItem
              key={meal.id}
              label={meal.name}
              description={
                <VStack gap={0.5}>
                  <Text type="supporting">{macroLine(meal.macros)}</Text>
                  <Timestamp value={meal.loggedAt} />
                </VStack>
              }
              endContent={
                <HStack gap={2} vAlign="center">
                  <Token label={`${meal.grams} g`} size="sm" />
                  <IconButton label={`Remove ${meal.name}`} size="sm" variant="ghost" icon={<Icon icon={TrashIcon} />} onClick={() => deleteMeal(meal.id)} isDisabled={loading} />
                </HStack>
              }
            />
          ))}
        </List>
      )}
    </PanelCard>
  );
}
