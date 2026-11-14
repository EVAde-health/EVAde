import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading, Text } from '@astryxdesign/core/Text';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Icon } from '@astryxdesign/core/Icon';
import { EnvelopeIcon, IdentificationIcon, LockClosedIcon, UserIcon } from '@heroicons/react/24/outline';
import BrandMark from '../components/BrandMark';
import NebulaCanvas from '../components/NebulaCanvas';
import OrbitalHud from '../components/OrbitalHud';
import ThemeToggle from '../components/ThemeToggle';
import './css/LoginPage.css';

type AuthMode = 'signin' | 'signup';

interface Credentials {
  name: string;
  crewId: string;
  email: string;
  password: string;
}

const EMPTY_CREDENTIALS: Credentials = { name: '', crewId: '', email: '', password: '' };

// Returns a validation message, or null when the form is valid.
function validate(mode: AuthMode, form: Credentials) {
  if (!/^\S+@\S+\.\S+$/.test(form.email)) return 'Enter a valid email address.';
  if (form.password.length < 8) return 'Password must be at least 8 characters.';
  if (mode === 'signup' && !form.name.trim()) return 'Tell us your name.';
  return null;
}

// Sign in / sign up screen; auth is stubbed until Cloudflare OAuth lands.
export default function LoginPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<Credentials>(EMPTY_CREDENTIALS);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mode: AuthMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
  const isSignUp = mode === 'signup';

  // Updates one credential field and clears stale errors.
  function updateField(field: keyof Credentials, value: string) {
    setForm(previous => ({ ...previous, [field]: value }));
    setError(null);
  }

  // Swaps between sign in and sign up, keeping it in the URL.
  function changeMode(next: string) {
    setSearchParams(next === 'signup' ? { mode: 'signup' } : {}, { replace: true });
    setError(null);
  }

  // Validates, then (for now) routes straight to the dashboard.
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const message = validate(mode, form);
    if (message) {
      setError(message);
      return;
    }
    setIsSubmitting(true);
    navigate('/dashboard', { viewTransition: true });
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
            <VStack as="form" gap={4} onSubmit={handleSubmit}>
              {isSignUp && (
                <TextInput label="Full name" value={form.name} onChange={v => updateField('name', v)} startIcon={UserIcon} autoComplete="name" isRequired />
              )}
              {isSignUp && (
                <TextInput label="Crew ID" value={form.crewId} onChange={v => updateField('crewId', v)} startIcon={IdentificationIcon} placeholder="EXP74-FE2" isOptional />
              )}
              <TextInput label="Email" type="email" value={form.email} onChange={v => updateField('email', v)} startIcon={EnvelopeIcon} autoComplete="email" isRequired />
              <TextInput
                label="Password"
                type="password"
                value={form.password}
                onChange={v => updateField('password', v)}
                startIcon={LockClosedIcon}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                status={error ? { type: 'error', message: error } : undefined}
                statusVariant="detached"
                isRequired
              />
              <Button type="submit" variant="primary" size="lg" width="100%" label={isSignUp ? 'Sign up' : 'Sign in'} isLoading={isSubmitting} />
              <HStack gap={3} vAlign="center">
                <Divider />
                <Text type="supporting">or</Text>
                <Divider />
              </HStack>
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
            <Text type="supporting">Health data is encrypted in transit and at rest.</Text>
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
