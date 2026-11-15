import { useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
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
  const [shownTutorial, setShownTutorial] = useState(tutorial);
  const [saving, setSaving] = useState(false);
  const { watchedTutorials, completeTutorial } = useMission();
  const showToast = useToast();
  if (tutorial && tutorial !== shownTutorial) setShownTutorial(tutorial);
  const isWatched = shownTutorial ? watchedTutorials.includes(shownTutorial.id) : false;
  const allChecked = shownTutorial ? checkedSteps.length === shownTutorial.steps.length : false;

  // Closes the dialog and resets the checklist.
  function handleOpenChange(isOpen: boolean) {
    if (isOpen) return;
    setCheckedSteps([]);
    onClose();
  }

  // Records completion and celebrates with an XP toast.
  async function handleComplete() {
    if (!shownTutorial) return;
    if (isWatched) return handleOpenChange(false);
    setSaving(true);
    try {
      const xp = await completeTutorial(shownTutorial.id);
      showToast({ body: xp ? `🚀 Tutorial complete · +${xp} XP` : '🚀 Tutorial complete' });
      handleOpenChange(false);
    } catch {
      showToast({ body: 'Progress could not be saved. Try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog isOpen={tutorial !== null} onOpenChange={handleOpenChange} width={880} maxHeight="90dvh" purpose="form" className="tutorial-player">
      {shownTutorial && (
        <Layout
          header={<DialogHeader title={shownTutorial.title} subtitle={`${shownTutorial.minutes} min · +${shownTutorial.xp} XP`} onOpenChange={handleOpenChange} />}
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <Button label="Close" variant="ghost" onClick={() => handleOpenChange(false)} />
                <Button
                  label={isWatched ? 'Done' : `Mark complete · +${shownTutorial.xp} XP`}
                  variant="primary"
                  isLoading={saving}
                  isDisabled={!allChecked && !isWatched}
                  tooltip={!allChecked && !isWatched ? 'Check off every step first' : undefined}
                  onClick={handleComplete}
                />
              </HStack>
            </LayoutFooter>
          }>
          <LayoutContent>
            <VStack gap={5} className="tutorial-player__body">
              {shownTutorial.videoSrc ? (
                <video className="tutorial-player__video" src={shownTutorial.videoSrc} poster={shownTutorial.posterSrc || undefined} controls preload="metadata" playsInline />
              ) : (
                <Center className={`tutorial-player__placeholder tutorial-player__placeholder--${CATEGORY_COLORS[shownTutorial.category]}`}>
                  <VStack gap={2} hAlign="center">
                    <Icon icon={FilmIcon} size="lg" />
                    <Text type="large" weight="semibold">Video coming soon</Text>
                    <Text type="supporting">Follow the steps below in the meantime.</Text>
                  </VStack>
                </Center>
              )}
              <HStack gap={2} wrap="wrap">
                <Token label={shownTutorial.category} color={CATEGORY_COLORS[shownTutorial.category]} />
                {isWatched && <Token label="Completed" color="green" />}
              </HStack>
              <Text color="secondary">{shownTutorial.summary}</Text>
              <CheckboxList label="Steps" value={checkedSteps} onChange={setCheckedSteps} hasDividers>
                {shownTutorial.steps.map((step, i) => (
                  <CheckboxListItem key={step} value={step} label={`${i + 1}. ${step}`} />
                ))}
              </CheckboxList>
            </VStack>
          </LayoutContent>
        </Layout>
      )}
    </Dialog>
  );
}
