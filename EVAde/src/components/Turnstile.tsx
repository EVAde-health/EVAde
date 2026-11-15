import { useEffect, useRef, useState } from 'react';
import { Text } from '@astryxdesign/core/Text';

interface TurnstileApi {
  render: (container: HTMLElement, options: {
    sitekey: string;
    action: string;
    callback: (value: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
    'response-field': boolean;
  }) => string;
  remove: (widget: string) => void;
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let loader: Promise<TurnstileApi> | undefined;

// Loads Cloudflare's Turnstile script once and shares the client.
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loader ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const failed = () => {
      script.remove();
      loader = undefined;
      reject(new Error('Turnstile could not load'));
    };
    script.onload = () => window.turnstile ? resolve(window.turnstile) : failed();
    script.onerror = failed;
    document.head.append(script);
  });
  return loader;
}

// Renders the Turnstile human check and reports its single-use token.
export default function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const host = useRef<HTMLElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let widget: string | undefined;
    let turnstile: TurnstileApi | undefined;
    loadTurnstile().then(client => {
      if (disposed || !host.current) return;
      turnstile = client;
      widget = client.render(host.current, {
        sitekey: siteKey,
        action: 'login',
        'response-field': false,
        callback: token => {
          onToken(token);
          setFailed(false);
        },
        'expired-callback': () => onToken(null),
        'error-callback': () => {
          onToken(null);
          setFailed(true);
        },
      });
    }).catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      if (widget) turnstile?.remove(widget);
    };
  }, [siteKey, onToken]);

  return (
    <>
      <section ref={host} aria-label="Human verification" />
      {failed && <Text role="alert">Human verification failed to load. Refresh this page to try again.</Text>}
    </>
  );
}
