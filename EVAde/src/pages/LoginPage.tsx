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
import { accessLoginUrl, demoLoginUrl, staffLoginUrl } from '../services/api';
import { fetchAuthProviders, signOut, type AuthProviders } from '../services/healthApi';
import './css/LoginPage.css';

type AuthMode = 'signin' | 'signup';

const MAX_ERROR_LENGTH = 160;

// Sign in / sign up screen; both go through Cloudflare Access.
export default function LoginPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [config, setConfig] = useState<AuthProviders>();
  const [failed, setFailed] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(false);

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
  const serverError = searchParams.get('error')?.slice(0, MAX_ERROR_LENGTH);

  // Swaps between sign in and sign up, keeping it in the URL.
  function changeMode(next: string) {
    setSearchParams(next === 'signup' ? { mode: 'signup' } : {}, { replace: true });
  }

  async function switchAccount() {
    if (switching) return;
    setSwitching(true);
    setSwitchError(false);
    try {
      if (!(await signOut())) setSwitching(false);
    } catch {
      setSwitchError(true);
      setSwitching(false);
    }
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
              {switchError && <Text role="alert">Could not sign out. Try again before switching accounts.</Text>}
              {failed && <Text role="alert">Sign-in options could not load. Refresh to try again.</Text>}
              {!config && !failed && <Text role="status">Checking sign-in options…</Text>}
              {config && !hasAccess && <Text>Sign-in is currently unavailable. Please try again later.</Text>}
              {hasAccess && (
                <VStack gap={2}>
                  <Button variant="primary" size="lg" width="100%" label={isSignUp ? 'Create astronaut account' : 'Astronaut sign-in'} href={accessLoginUrl()} />
                  <Text type="supporting">
                    {isSignUp
                      ? 'Cloudflare Access emails you a one-time code; your crew account is created on first sign-in.'
                      : 'Cloudflare Access emails you a one-time code to confirm it’s you.'}
                  </Text>
                  <Button variant="secondary" size="lg" width="100%" label="Staff sign-in" href={staffLoginUrl()} />
                  <Button variant="ghost" width="100%" label="Use a different email" onClick={switchAccount} isDisabled={switching} />
                </VStack>
              )}
              <Button variant="ghost" width="100%" label="Try the demo" href={demoLoginUrl()} />
              <Button
                variant="secondary"
                width="100%"
                label={isSignUp ? 'Already have an account? Sign in' : 'New to EVAde? Sign up'}
                onClick={() => changeMode(isSignUp ? 'signin' : 'signup')}
              />
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
