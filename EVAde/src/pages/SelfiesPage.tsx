import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Center } from '@astryxdesign/core/Center';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Lightbox } from '@astryxdesign/core/Lightbox';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { Switch } from '@astryxdesign/core/Switch';
import { Icon } from '@astryxdesign/core/Icon';
import { useToast } from '@astryxdesign/core/Toast';
import { ArrowPathIcon, CameraIcon, CheckIcon, PhotoIcon, VideoCameraSlashIcon } from '@heroicons/react/24/outline';
import PageHeader from '../components/PageHeader';
import { useCamera } from '../hooks/useCamera';
import { useMission } from '../context/MissionContext';
import { deleteSelfie, listSelfies, saveSelfie, type Selfie } from '../services/selfieStore';
import { stagger } from '../utils/style';
import './css/SelfiesPage.css';

const COUNTDOWN_SECONDS = 3;
const SELFIE_XP = 15;

interface GalleryItem extends Selfie {
  url: string;
}

// Wraps stored selfies with object URLs for display.
function toGallery(selfies: Selfie[]): GalleryItem[] {
  return selfies.map(s => ({ ...s, url: URL.createObjectURL(s.blob) }));
}

// Waits for the given number of milliseconds.
function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Daily selfie check-ins captured from the camera and stored locally.
export default function SelfiesPage() {
  const { videoRef, state: cameraState, error: cameraError, start: startCamera, stop: stopCamera, capture } = useCamera();
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null);
  const [note, setNote] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [hasTimer, setHasTimer] = useState(true);
  const [isFlashing, setIsFlashing] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const galleryRef = useRef<GalleryItem[]>([]);
  const { user, awardSelfie } = useMission();
  const userId = user.user_id;
  const showToast = useToast();
  const lightboxMedia = useMemo(
    () => gallery.map(g => ({ src: g.url, alt: `Selfie from ${new Date(g.createdAt).toLocaleString()}`, caption: g.note || new Date(g.createdAt).toLocaleString() })),
    [gallery],
  );

  useEffect(() => {
    let isActive = true;
    listSelfies(userId)
      .then(selfies => isActive && setGallery(toGallery(selfies)))
      .catch(() => isActive && setGallery([]));
    return () => {
      isActive = false;
    };
  }, [userId]);

  useEffect(() => {
    galleryRef.current = gallery;
  }, [gallery]);

  useEffect(() => () => galleryRef.current.forEach(g => URL.revokeObjectURL(g.url)), []);

  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.url);
    };
  }, [pending]);

  // Counts down (optionally), flashes, then captures a frame.
  async function takeSelfie() {
    if (hasTimer) {
      for (let s = COUNTDOWN_SECONDS; s > 0; s--) {
        setCountdown(s);
        await wait(1000);
      }
      setCountdown(null);
    }
    setIsFlashing(true);
    const blob = await capture();
    setTimeout(() => setIsFlashing(false), 450);
    if (blob) setPending({ blob, url: URL.createObjectURL(blob) });
  }

  // Persists the pending shot and awards the daily XP once.
  async function keepSelfie() {
    if (!pending) return;
    const saved = await saveSelfie(userId, pending.blob, note.trim());
    setGallery(current => [{ ...saved, url: URL.createObjectURL(saved.blob) }, ...current]);
    setPending(null);
    setNote('');
    const isFirstToday = awardSelfie(SELFIE_XP);
    showToast({ body: isFirstToday ? `📸 Selfie saved · +${SELFIE_XP} XP` : '📸 Selfie saved' });
  }

  // Deletes a selfie from storage and the gallery.
  async function removeSelfie(id: string) {
    await deleteSelfie(userId, id);
    const removed = gallery.find(g => g.id === id);
    if (removed) URL.revokeObjectURL(removed.url);
    setGallery(current => current.filter(g => g.id !== id));
  }

  return (
    <VStack gap={6} padding={6} className="page">
      <PageHeader
        eyebrow="Visual check-in"
        title="Daily selfie"
        description="A consistent daily photo helps track facial fluid shift, fatigue and wellbeing across the mission."
        actions={<Text type="supporting" hasTabularNumbers>{gallery.length} photos stored on this device</Text>}
      />

      {cameraError && <Banner status="error" title="Camera unavailable" description={cameraError} />}

      <Grid columns={{ minWidth: 340, max: 2 }} gap={6}>
        <Card padding={4} className="selfie__stage-card rise-in">
          <VStack gap={4}>
            <Stack className={`selfie__stage ${isFlashing ? 'selfie__stage--flash' : ''}`}>
              <video ref={videoRef} className="selfie__video" muted playsInline hidden={cameraState !== 'live' || pending !== null} />
              {pending && <img src={pending.url} alt="Captured selfie preview" className="selfie__video selfie__preview" />}
              {cameraState !== 'live' && !pending && (
                <Center className="selfie__placeholder">
                  <VStack gap={3} hAlign="center">
                    <Icon icon={CameraIcon} size="lg" />
                    <Text color="secondary">Camera is off</Text>
                    <Button label="Start camera" variant="primary" onClick={startCamera} isLoading={cameraState === 'starting'} />
                  </VStack>
                </Center>
              )}
              {cameraState === 'live' && !pending && <Stack className="selfie__guide" aria-hidden="true" />}
              {countdown !== null && (
                <Center className="selfie__countdown" key={countdown} aria-live="assertive">
                  <Text type="display-1">{countdown}</Text>
                </Center>
              )}
            </Stack>

            {pending ? (
              <VStack gap={3}>
                <TextInput label="Note (optional)" placeholder="e.g. Puffy face after sleep" value={note} onChange={setNote} />
                <HStack gap={2} hAlign="end">
                  <Button label="Retake" icon={<Icon icon={ArrowPathIcon} />} onClick={() => setPending(null)} />
                  <Button label="Save selfie" variant="primary" icon={<Icon icon={CheckIcon} />} clickAction={keepSelfie} />
                </HStack>
              </VStack>
            ) : (
              <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
                <Switch label={`${COUNTDOWN_SECONDS}s timer`} value={hasTimer} onChange={setHasTimer} />
                <HStack gap={2}>
                  {cameraState === 'live' && <Button label="Stop camera" variant="ghost" icon={<Icon icon={VideoCameraSlashIcon} />} onClick={stopCamera} />}
                  <Button label="Take selfie" variant="primary" size="lg" icon={<Icon icon={CameraIcon} />} onClick={takeSelfie} isDisabled={cameraState !== 'live' || countdown !== null} />
                </HStack>
              </HStack>
            )}
          </VStack>
        </Card>

        <VStack gap={4}>
          <Heading level={2}>Gallery</Heading>
          {gallery.length === 0 ? (
            <EmptyState icon={<Icon icon={PhotoIcon} size="lg" />} title="No selfies yet" description="Your first check-in starts your visual health timeline." />
          ) : (
            <Grid columns={{ minWidth: 120, max: 4 }} gap={3}>
              {gallery.map((item, i) => (
                <VStack key={item.id} gap={1} className="selfie__thumb rise-in" style={stagger(i)}>
                  <Thumbnail
                    src={item.url}
                    alt={item.note || `Selfie ${i + 1}`}
                    label={new Date(item.createdAt).toLocaleDateString()}
                    onClick={() => setLightboxIndex(i)}
                    onRemove={() => removeSelfie(item.id)}
                    className="selfie__thumbnail"
                  />
                  <Text type="supporting" maxLines={1}>{new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
                </VStack>
              ))}
            </Grid>
          )}
        </VStack>
      </Grid>

      {lightboxIndex !== null && (
        <Lightbox isOpen onOpenChange={isOpen => !isOpen && setLightboxIndex(null)} media={lightboxMedia} index={lightboxIndex} onIndexChange={setLightboxIndex} hasZoom />
      )}
    </VStack>
  );
}
