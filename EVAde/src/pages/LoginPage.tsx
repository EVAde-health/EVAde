import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading, Text } from '@astryxdesign/core/Text';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Icon } from '@astryxdesign/core/Icon';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import BrandMark from '../components/BrandMark';
import NebulaCanvas from '../components/NebulaCanvas';
import OrbitalHud from '../components/OrbitalHud';
import ThemeToggle from '../components/ThemeToggle';
import { accessLoginUrl, demoLoginUrl } from '../services/api';
import { fetchAuthProviders, type AuthProviders } from '../services/healthApi';
import './css/LoginPage.css';

type AuthMode = 'signin' | 'signup';

const MAX_ERROR_LENGTH = 160;

// Sign in / sign up screen; both go through Cloudflare Access (passkey or emailed code). Astronauts and flight
// surgeons share the sign-in; the account's role decides which app opens. Locally, /auth/access opens the
// Worker's stand-in for the Access page, and the seeded test accounts are listed under the sign-in button.
export default function LoginPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [config, setConfig] = useState<AuthProviders>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchAuthProviders({ signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) setConfig(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const mode: AuthMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
  const isSignUp = mode === 'signup';
  const hasAccess = config?.providers.includes('cloudflare_access') ?? false;
  // The Worker lists 'dev' only on a loopback host with DEV_LOGIN=true, i.e. exactly where the test accounts work.
  const hasDev = config?.providers.includes('dev') ?? false;
  const hasDemo = config?.providers.includes('demo') ?? false;
  const serverError = searchParams.get('error')?.slice(0, MAX_ERROR_LENGTH);

  // Swaps between sign in and sign up, keeping it in the URL.
  function changeMode(next: string) {
    setSearchParams(next === 'signup' ? { mode: 'signup' } : {}, { replace: true });
  }

  return (
    <Grid columns={{ minWidth: 380, max: 2 }} className="login">
      <VStack className="login__form-side" padding={6}>
        <HStack hAlign="between" vAlign="center">
          <Button label="EVAde home" variant="ghost" href="/" icon={<BrandMark size="sm" />}>EVAde</Button>
          <ThemeToggle />
        </HStack>

        <VStack gap={6} vAlign="center" className="login__form-wrap">
          <VStack gap={2} className="rise-in">
            <Heading level={1}>{isSignUp ? 'Join the crew' : 'Welcome back, crew'}</Heading>
            <Text color="secondary">
              {isSignUp ? 'Create your account to start tracking your mission health.' : 'Sign in to see today’s vitals, missions and journal.'}
            </Text>
          </VStack>

          <SegmentedControl label="Account action" value={mode} onChange={changeMode} layout="fill">
            <SegmentedControlItem value="signin" label="Sign in" />
            <SegmentedControlItem value="signup" label="Sign up" />
          </SegmentedControl>

          <Card padding={6} className="login__card">
            <VStack gap={4}>
              {serverError && <Text role="alert">{serverError}</Text>}
              {failed && <Text role="alert">Sign-in options could not load. Refresh to try again.</Text>}
              {!config && !failed && <Text role="status">Checking sign-in options…</Text>}
              {config && !hasAccess && !hasDemo && <Text>Sign-in is currently unavailable. Please try again later.</Text>}
              {hasAccess && (
                <VStack gap={2}>
                  <Button variant="primary" size="lg" width="100%" label={isSignUp ? 'Create astronaut account' : 'Sign in'} href={accessLoginUrl()} />
                  <Text type="supporting">
                    {isSignUp
                      ? 'Cloudflare Access emails you a one-time code; your crew account is created on first sign-in.'
                      : 'Cloudflare Access emails you a one-time code to confirm it’s you.'}
                  </Text>
                  {hasDev && !isSignUp && (
                    <Text type="supporting" color="secondary" className="login__test-accounts">
                      Local test accounts: vega@demo.evade.local → astronaut test · ortiz@demo.evade.local → flight surgeon test
                    </Text>
                  )}
                </VStack>
              )}
              {hasDemo && <Button variant="ghost" width="100%" label="Try the demo" href={demoLoginUrl()} />}
              {isSignUp && <Button variant="secondary" width="100%" label="Already have an account? Sign in" onClick={() => changeMode('signin')} />}
            </VStack>
          </Card>
          <HStack gap={2} vAlign="center">
            <Icon icon={LockClosedIcon} size="xsm" color="secondary" />
            <Text type="supporting">Sign-in is protected by Cloudflare Access.</Text>
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
