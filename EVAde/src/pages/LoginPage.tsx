import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { Icon } from '@astryxdesign/core/Icon';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import BrandMark from '../components/BrandMark';
import NebulaCanvas from '../components/NebulaCanvas';
import OrbitalHud from '../components/OrbitalHud';
import ThemeToggle from '../components/ThemeToggle';
import { ACCESS_LOGIN_URL, ACCESS_STAFF_LOGIN_URL, API_ORIGIN } from '../services/api';
import './css/LoginPage.css';

export default function LoginPage() {
  return (
    <Grid columns={{ minWidth: 380, max: 2 }} className="login">
      <VStack className="login__form-side" padding={6}>
        <HStack hAlign="between" vAlign="center">
          <Button label="EVAde home" variant="ghost" href="/" icon={<BrandMark size="sm" />}>EVAde</Button>
          <ThemeToggle />
        </HStack>

        <VStack gap={6} vAlign="center" className="login__form-wrap">
          <VStack gap={2} className="rise-in">
            <Heading level={1}>Welcome, crew</Heading>
            <Text color="secondary">
              Sign in or create an account to track your mission health.
            </Text>
          </VStack>

          <Card padding={6} className="login__card">
            <VStack gap={3}>
              <Button variant="primary" size="lg" width="100%" label="Sign in or sign up" href={ACCESS_LOGIN_URL} />
              <Button variant="secondary" size="lg" width="100%" label="Flight surgeon sign-in" href={ACCESS_STAFF_LOGIN_URL} />
              {import.meta.env.DEV && <DevSignIn />}
            </VStack>
          </Card>
          <HStack gap={2} vAlign="center">
            <Icon icon={LockClosedIcon} size="xsm" color="secondary" />
            <Text type="supporting">Crew and staff each sign in through their own Cloudflare Access application.</Text>
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

function DevSignIn() {
  const [email, setEmail] = useState('hale@evade.health');
  const redirect = `${window.location.origin}/dashboard`;
  return (
    <form method="post" action={`${API_ORIGIN}/auth/start`}>
      <VStack gap={2}>
        <Text type="supporting">Local test sign-in. A staff email opens the console only when that account’s database role is staff and ACCESS_STAFF_AUD is set.</Text>
        <input type="hidden" name="provider" value="dev" />
        <input type="hidden" name="redirect" value={redirect} />
        <TextInput label="Dev email" htmlName="dev_email" type="email" value={email} onChange={setEmail} />
        <Button type="submit" variant="ghost" label="Dev sign in" />
      </VStack>
    </form>
  );
}
