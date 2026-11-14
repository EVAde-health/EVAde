import { Button } from '@astryxdesign/core/Button';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { HStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { Icon } from '@astryxdesign/core/Icon';
import { useToast } from '@astryxdesign/core/Toast';
import { PlayCircleIcon } from '@heroicons/react/24/outline';
import { useMission } from '../context/MissionContext';
import type { MissionTask } from '../data/tasks';
import './css/TaskChecklist.css';

// Checklist of mission tasks that awards XP when checked.
export default function TaskChecklist({ label, tasks }: { label: string; tasks: MissionTask[] }) {
  const { completed, toggleTask } = useMission();
  const showToast = useToast();

  // Toggles a task and shows an XP toast on completion.
  function handleCheck(task: MissionTask) {
    if (toggleTask(task.id, task.xp)) showToast({ body: `✅ ${task.title} · +${task.xp} XP`, uniqueID: 'task-xp' });
  }

  return (
    <CheckboxList label={label} isLabelHidden hasDividers density="spacious">
      {tasks.map(task => {
        const isDone = completed.includes(task.id);
        return (
          <CheckboxListItem
            key={task.id}
            label={
              <HStack gap={2} vAlign="center">
                <Icon icon={task.icon} size="sm" color={isDone ? 'success' : 'secondary'} />
                <Text weight="medium" hasStrikethrough={isDone} className={isDone ? 'task-checklist__done' : undefined}>{task.title}</Text>
              </HStack>
            }
            description={task.window ? `${task.detail} · ${task.window}` : task.detail}
            isChecked={isDone}
            onCheck={() => handleCheck(task)}
            endContent={
              <HStack gap={2} vAlign="center">
                {task.tutorialId && <Button label="How to" size="sm" variant="ghost" href="/tutorials" icon={<Icon icon={PlayCircleIcon} />} />}
                <Token label={`+${task.xp} XP`} size="sm" color={isDone ? 'green' : 'purple'} />
              </HStack>
            }
          />
        );
      })}
    </CheckboxList>
  );
}
