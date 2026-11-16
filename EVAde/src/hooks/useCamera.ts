import { useEffect, useRef, useState } from 'react';

export type CameraState = 'idle' | 'starting' | 'live' | 'error';

const CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
  audio: false,
};

// Turns a getUserMedia failure into a readable message.
function describeError(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Camera access was blocked. Allow it in your browser settings.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No camera was found on this device.';
  return 'The camera could not be started.';
}

// Manages a front-camera stream bound to a video element.
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => streamRef.current?.getTracks().forEach(track => track.stop()), []);

  // Requests the camera and starts the preview.
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setError('This browser does not support camera access.');
      return;
    }
    setState('starting');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState('live');
    } catch (err) {
      setState('error');
      setError(describeError(err));
    }
  }

  // Stops every track and releases the camera.
  function stop() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState('idle');
  }

  // Grabs the current frame as a mirrored JPEG blob.
  function capture(): Promise<Blob | null> {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return Promise.resolve(null);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return Promise.resolve(null);
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  }

  return { videoRef, state, error, start, stop, capture };
}
