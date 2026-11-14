import { useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { Icon } from '@astryxdesign/core/Icon';
import { useToast } from '@astryxdesign/core/Toast';
import { FilmIcon } from '@heroicons/react/24/outline';
import { CATEGORY_COLORS, type Tutorial } from '../data/tutorials';
import { useMission } from '../context/MissionContext';
import './css/TutorialPlayer.css';

interface TutorialPlayerProps {
  tutorial: Tutorial | null;
  onClose: () => void;
}

// Video plus step checklist; finishing every step awards XP.
export default function TutorialPlayer({ tutorial, onClose }: TutorialPlayerProps) {
  const [checkedSteps, setCheckedSteps] = useState<string[]>([]);
  const { watchedTutorials, completeTutorial } = useMission();
  const showToast = useToast();
  const isWatched = tutorial ? watchedTutorials.includes(tutorial.id) : false;
  const allChecked = tutorial ? checkedSteps.length === tutorial.steps.length : false;

  // Closes the dialog and resets the checklist.
  function handleOpenChange(isOpen: boolean) {
    if (isOpen) return;
    setCheckedSteps([]);
    onClose();
  }

  // Records completion and celebrates with an XP toast.
  function handleComplete() {
    if (!tutorial) return;
    if (completeTutorial(tutorial.id, tutorial.xp)) showToast({ body: `🚀 Tutorial complete · +${tutorial.xp} XP` });
    handleOpenChange(false);
  }

  return (
    <Dialog isOpen={tutorial !== null} onOpenChange={handleOpenChange} width={880} maxHeight="90dvh" purpose="form">
      {tutorial && (
        <VStack gap={0}>
          <DialogHeader title={tutorial.title} subtitle={`${tutorial.minutes} min · +${tutorial.xp} XP`} onOpenChange={handleOpenChange} />
          <VStack gap={5} padding={5}>
            {tutorial.videoSrc ? (
              <video className="tutorial-player__video" src={tutorial.videoSrc} poster={tutorial.posterSrc || undefined} controls preload="metadata" playsInline />
            ) : (
              <Center className={`tutorial-player__placeholder tutorial-player__placeholder--${CATEGORY_COLORS[tutorial.category]}`}>
                <VStack gap={2} hAlign="center">
                  <Icon icon={FilmIcon} size="lg" />
                  <Text type="large" weight="semibold">Video coming soon</Text>
                  <Text type="supporting">Follow the steps below in the meantime.</Text>
                </VStack>
              </Center>
            )}
            <HStack gap={2} wrap="wrap">
              <Token label={tutorial.category} color={CATEGORY_COLORS[tutorial.category]} />
              {isWatched && <Token label="Completed" color="green" />}
            </HStack>
            <Text color="secondary">{tutorial.summary}</Text>
            <CheckboxList label="Steps" value={checkedSteps} onChange={setCheckedSteps} hasDividers>
              {tutorial.steps.map((step, i) => (
                <CheckboxListItem key={step} value={step} label={`${i + 1}. ${step}`} />
              ))}
            </CheckboxList>
            <HStack gap={2} hAlign="end">
              <Button label="Close" variant="ghost" onClick={() => handleOpenChange(false)} />
              <Button
                label={isWatched ? 'Done' : `Mark complete · +${tutorial.xp} XP`}
                variant="primary"
                isDisabled={!allChecked && !isWatched}
                tooltip={!allChecked && !isWatched ? 'Check off every step first' : undefined}
                onClick={handleComplete}
              />
            </HStack>
          </VStack>
        </VStack>
      )}
    </Dialog>
  );
}
