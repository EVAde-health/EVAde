import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading, Text } from '@astryxdesign/core/Text';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { Icon } from '@astryxdesign/core/Icon';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import BrandMark from '../components/BrandMark';
import NebulaCanvas from '../components/NebulaCanvas';
import OrbitalHud from '../components/OrbitalHud';
import ThemeToggle from '../components/ThemeToggle';
import Turnstile from '../components/Turnstile';
import { api, API_ORIGIN, DASHBOARD_REDIRECT } from '../services/api';
import './css/LoginPage.css';

const PROVIDERS = [
  { value: 'google', label: 'Continue with Google' },
  { value: 'github', label: 'Continue with GitHub' },
] as const;

export default function LoginPage() {
  const [config, setConfig] = useState<{ providers: string[]; turnstile_site_key: string | null }>();
  const [failed, setFailed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<{ providers: string[]; turnstile_site_key: string | null }>('/auth/providers', { signal: controller.signal })
      .then(setConfig)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  const enabled = PROVIDERS.filter(provider => config?.providers.includes(provider.value));

  return (
    <Grid columns={{ minWidth: 380, max: 2 }} className="login">
      <VStack className="login__form-side" padding={6}>
        <HStack hAlign="between" vAlign="center">
          <Button label="EVAde home" variant="ghost" href="/" icon={<BrandMark size="sm" />}>EVAde</Button>
          <ThemeToggle />
        </HStack>

        <VStack gap={6} vAlign="center" className="login__form-wrap">
          <VStack gap={2} className="rise-in">
            <Heading level={1}>Welcome back, crew</Heading>
            <Text color="secondary">Sign in to see today’s vitals, missions and journal.</Text>
          </VStack>

          <Card padding={6} className="login__card">
            <VStack gap={4}>
              {failed && <Text role="alert">Sign-in options could not load. Refresh to try again.</Text>}
              {!config && !failed && <Text role="status">Checking sign-in options…</Text>}
              {config && (!enabled.length || !config.turnstile_site_key) && <Text>Sign-in is currently unavailable.</Text>}
              {!!enabled.length && config?.turnstile_site_key && (
                <>
                  <Turnstile siteKey={config.turnstile_site_key} onToken={setToken} />
                  {enabled.map(provider => (
                    <form key={provider.value} method="post" action={API_ORIGIN + '/auth/start'} onSubmit={event => { if (!token) event.preventDefault(); }}>
                      <input type="hidden" name="provider" value={provider.value} />
                      <input type="hidden" name="redirect" value={DASHBOARD_REDIRECT} />
                      <input type="hidden" name="cf-turnstile-response" value={token ?? ''} />
                      <Button type="submit" variant="primary" size="lg" width="100%" label={provider.label} isDisabled={!token} />
                    </form>
                  ))}
                </>
              )}
            </VStack>
          </Card>
          <HStack gap={2} vAlign="center">
            <Icon icon={LockClosedIcon} size="xsm" color="secondary" />
            <Text type="supporting">Sign-in is protected by Cloudflare Turnstile.</Text>
          </HStack>
        </VStack>
      </VStack>

      <Stack className="login__visual-side" aria-hidden="true">
        <NebulaCanvas />
        <VStack gap={6} className="login__visual-content" padding={8} vAlign="center">
          <OrbitalHud />
          <VStack gap={2} hAlign="center">
            <Heading level={2} type="display-3" justify="center">Your body, in orbit.</Heading>
            <Text color="secondary" justify="center">Twelve signals, one calm view — synced from your sensors every minute.</Text>
          </VStack>
        </VStack>
      </Stack>
    </Grid>
  );
}
