import { useDeferredValue, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Token } from '@astryxdesign/core/Token';
import { Icon } from '@astryxdesign/core/Icon';
import { CheckBadgeIcon, ClockIcon, MagnifyingGlassIcon, PlayIcon } from '@heroicons/react/24/solid';
import PageHeader from '../components/PageHeader';
import PageLoader from '../components/PageLoader';
import TutorialPlayer from '../components/TutorialPlayer';
import { useMission } from '../context/MissionContext';
import { CATEGORY_COLORS, TUTORIAL_CATEGORIES, toTutorial, type Tutorial } from '../data/tutorials';
import { fetchTutorials } from '../services/healthApi';
import { stagger } from '../utils/style';
import './css/TutorialsPage.css';

const ALL = 'All';

// Filters tutorials by category tab and free-text search.
function filterTutorials(tutorials: Tutorial[], category: string, query: string) {
  const needle = query.trim().toLowerCase();
  return tutorials.filter(
    t => (category === ALL || t.category === category) && (!needle || `${t.title} ${t.summary}`.toLowerCase().includes(needle)),
  );
}

// Library of self-measurement video tutorials, loaded from D1.
export default function TutorialsPage() {
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<Tutorial | null>(null);
  const [tutorials, setTutorials] = useState<Tutorial[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const deferredQuery = useDeferredValue(query);
  const { watchedTutorials } = useMission();

  useEffect(() => {
    const controller = new AbortController();
    fetchTutorials({ signal: controller.signal })
      .then(rows => {
        if (!controller.signal.aborted) setTutorials(rows.map(toTutorial));
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [attempt]);

  const library = tutorials ?? [];
  const visible = filterTutorials(library, category, deferredQuery);
  const watchedCount = library.filter(t => watchedTutorials.includes(t.id)).length;
  const requested = searchParams.get('open');
  const linked = requested ? library.find(t => t.id === requested) ?? null : null;
  const shown = active ?? linked;

  // Retries loading the tutorial library after a failure.
  function retry() {
    setFailed(false);
    setAttempt(previous => previous + 1);
  }

  // Closes the player and clears any ?open= deep link.
  function closePlayer() {
    setActive(null);
    if (requested) setSearchParams({}, { replace: true });
  }

  if (!tutorials && !failed) return <PageLoader />;

  return (
    <VStack gap={6} padding={6} className="page">
      <PageHeader
        eyebrow="Training library"
        title="Measurement tutorials"
        description="Short guided videos for taking accurate readings on yourself — no flight surgeon required."
        actions={
          <VStack gap={1} className="tutorials__progress">
            <Text type="supporting" hasTabularNumbers>{watchedCount} of {library.length} completed</Text>
            <ProgressBar label="Tutorials completed" isLabelHidden value={watchedCount} max={Math.max(1, library.length)} variant="success" />
          </VStack>
        }
      />

      <HStack gap={4} wrap="wrap" vAlign="end" hAlign="between">
        <TabList role="tablist" value={category} onChange={setCategory}>
          {[ALL, ...TUTORIAL_CATEGORIES].map(c => (
            <Tab key={c} value={c} label={c} />
          ))}
        </TabList>
        <TextInput label="Search tutorials" isLabelHidden placeholder="Search tutorials" value={query} onChange={setQuery} startIcon={MagnifyingGlassIcon} hasClear width={280} />
      </HStack>

      {failed ? (
        <EmptyState title="Tutorials could not load" description="The EVAde API did not respond." actions={<Button label="Try again" onClick={retry} />} />
      ) : library.length === 0 ? (
        <EmptyState title="No tutorials yet" description="Your mission’s training library hasn’t been published yet." />
      ) : visible.length === 0 ? (
        <EmptyState title="No tutorials match" description="Try another category or search term." />
      ) : (
        <Grid columns={{ minWidth: 260, max: 4 }} gap={4}>
          {visible.map((tutorial, i) => {
            const isWatched = watchedTutorials.includes(tutorial.id);
            return (
              <ClickableCard
                key={tutorial.id}
                label={`Open tutorial: ${tutorial.title}`}
                onClick={() => setActive(tutorial)}
                padding={0}
                className="tutorial-card rise-in hover-lift"
                style={stagger(i)}>
                <Stack className={`tutorial-card__poster tutorial-card__poster--${CATEGORY_COLORS[tutorial.category]}`}>
                  <HStack className="tutorial-card__play" hAlign="center" vAlign="center">
                    <Icon icon={PlayIcon} size="md" />
                  </HStack>
                  <HStack gap={1} vAlign="center" className="tutorial-card__duration">
                    <Icon icon={ClockIcon} size="xsm" />
                    <Text type="supporting">{tutorial.minutes} min</Text>
                  </HStack>
                </Stack>
                <VStack gap={2} padding={4}>
                  <HStack gap={2} hAlign="between" vAlign="center">
                    <Token label={tutorial.category} color={CATEGORY_COLORS[tutorial.category]} size="sm" />
                    {isWatched ? (
                      <HStack gap={1} vAlign="center">
                        <Icon icon={CheckBadgeIcon} size="sm" color="success" />
                        <Text type="supporting">Done</Text>
                      </HStack>
                    ) : (
                      <Text type="supporting">+{tutorial.xp} XP</Text>
                    )}
                  </HStack>
                  <Heading level={3}>{tutorial.title}</Heading>
                  <Text type="supporting" maxLines={2}>{tutorial.summary}</Text>
                </VStack>
              </ClickableCard>
            );
          })}
        </Grid>
      )}

      <TutorialPlayer tutorial={shown} onClose={closePlayer} />
    </VStack>
  );
}
