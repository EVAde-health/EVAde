import { Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import { AppShell } from '@astryxdesign/core/AppShell';
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { NavIcon } from '@astryxdesign/core/NavIcon';
import { Badge } from '@astryxdesign/core/Badge';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Divider } from '@astryxdesign/core/Divider';
import {
  ArrowLeftStartOnRectangleIcon,
  BookOpenIcon,
  CameraIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  PlayCircleIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import {
  BookOpenIcon as BookOpenSolid,
  CameraIcon as CameraSolid,
  ChatBubbleLeftRightIcon as ChatSolid,
  CheckCircleIcon as CheckCircleSolid,
  PlayCircleIcon as PlayCircleSolid,
  Squares2X2Icon as Squares2X2Solid,
} from '@heroicons/react/24/solid';
import { BASIC_TASKS, PROTOCOL_TASKS } from '../data/tasks';
import { useMission } from '../context/MissionContext';
import { api, ApiError, SIGN_IN_REQUIRED, STAFF_ROLES, type SessionUser } from '../services/api';
import AdminShell from './AdminShell';
import EmergencyButton from './EmergencyButton';
import AmbientBackdrop from './AmbientBackdrop';
import BrandMark from './BrandMark';
import LevelMeter from './LevelMeter';
import MotionToggle from './MotionToggle';
import MissionProvider from './MissionProvider';
import PageLoader from './PageLoader';
import ThemeToggle from './ThemeToggle';
import './css/AppFrame.css';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: Squares2X2Icon, selectedIcon: Squares2X2Solid },
  { href: '/tutorials', label: 'Tutorials', icon: PlayCircleIcon, selectedIcon: PlayCircleSolid },
  { href: '/tasks', label: 'Missions', icon: CheckCircleIcon, selectedIcon: CheckCircleSolid },
  { href: '/journal', label: 'Journal', icon: BookOpenIcon, selectedIcon: BookOpenSolid },
  { href: '/selfies', label: 'Selfies', icon: CameraIcon, selectedIcon: CameraSolid },
  { href: '/chat', label: 'Team line', icon: ChatBubbleLeftRightIcon, selectedIcon: ChatSolid },
];

export default function AppFrame() {
  const [session, setSession] = useState<SessionUser | 'loading' | 'signed-out' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const { pathname } = useLocation();
  useEffect(() => {
    const expire = () => setSession('signed-out');
    window.addEventListener(SIGN_IN_REQUIRED, expire);
    return () => window.removeEventListener(SIGN_IN_REQUIRED, expire);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<{ user: Omit<SessionUser, 'demo'> | null; demo?: boolean }>('/auth/me', { signal: controller.signal })
      .then(({ user, demo }) => { if (!controller.signal.aborted) setSession(user?.user_id ? { ...user, demo: demo === true } : 'signed-out'); })
      .catch(error => {
        if (!controller.signal.aborted) setSession(error instanceof ApiError && error.status === 401 ? 'signed-out' : 'error');
      });
    return () => controller.abort();
  }, [attempt]);

  if (session === 'signed-out') return <Navigate to="/login" replace />;
  if (session === 'loading') return <PageLoader />;
  if (session === 'error') return (
    <VStack padding={6} gap={3}>
      <Text role="alert">Your session could not be checked.</Text>
      <Button label="Try again" onClick={() => { setSession('loading'); setAttempt(previous => previous + 1); }} />
    </VStack>
  );

  if (STAFF_ROLES.has(session.role)) {
    return <AdminShell user={session} onSignOut={() => setSession('signed-out')} />;
  }

  if (/^\/admin(?:\/|$)/.test(pathname)) return <Navigate to="/dashboard" replace />;
  if (session.demo && /^\/chat(?:\/|$)/.test(pathname)) return <Navigate to="/dashboard" replace />;

  return (
    <MissionProvider key={session.user_id} user={session}>
      <SignedInFrame onSignOut={() => setSession('signed-out')} />
    </MissionProvider>
  );
}

function SignedInFrame({ onSignOut }: { onSignOut: () => void }) {
  const { pathname } = useLocation();
  const { completed, user } = useMission();
  const remaining = BASIC_TASKS.length + PROTOCOL_TASKS.length - completed.length;
  const [signingOut, setSigningOut] = useState(false);
  const showToast = useToast();
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await api('/auth/logout', { method: 'POST' });
      onSignOut();
    } catch {
      showToast({ body: 'Sign-out failed. Please try again.' });
      setSigningOut(false);
    }
  }

  return (
    <>
      <AmbientBackdrop />
      <AppShell
        variant="elevated"
        contentPadding={0}
        sideNav={
          <SideNav
            className="app-frame__nav"
            collapsible
            header={
              <SideNavHeading
                heading="EVAde"
                subheading={user.mission_name ?? user.display_name}
                icon={<NavIcon icon={<BrandMark size="sm" />} />}
                headingHref="/dashboard"
              />
            }
            footer={
              <VStack gap={2}>
                <LevelMeter />
                {!user.demo && <EmergencyButton />}
                <Divider />
                <HStack gap={1} vAlign="center" hAlign="between">
                  <SideNavItem label="Sign out" icon={ArrowLeftStartOnRectangleIcon} onClick={signOut} isDisabled={signingOut} />
                  <HStack gap={0.5}>
                    <MotionToggle size="sm" />
                    <ThemeToggle size="sm" />
                  </HStack>
                </HStack>
              </VStack>
            }>
            <SideNavSection title="Mission control" isHeaderHidden>
              {NAV_ITEMS.filter(item => !user.demo || item.href !== '/chat').map(item => (
                <SideNavItem
                  key={item.href}
                  label={item.label}
                  href={item.href}
                  icon={item.icon}
                  selectedIcon={item.selectedIcon}
                  isSelected={pathname === item.href}
                  endContent={item.href === '/tasks' && remaining > 0 ? <Badge variant="purple" label={String(remaining)} /> : undefined}
                />
              ))}
            </SideNavSection>
          </SideNav>
        }>
        <Suspense fallback={<PageLoader />}>
          <VStack className="app-frame__page" key={pathname}>
            <Outlet />
          </VStack>
        </Suspense>
      </AppShell>
    </>
  );
}
