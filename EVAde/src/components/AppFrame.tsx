import { Suspense, useEffect, useState } from 'react';
import { matchRoutes, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
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
import { AccountStorageContext } from '../context/AccountStorageContext';
import { useMission } from '../context/MissionContext';
import { ApiError, SIGN_IN_REQUIRED, STAFF_ROLES } from '../services/api';
import { fetchSession, signOut, type SessionUser } from '../services/healthApi';
import AmbientBackdrop from './AmbientBackdrop';
import SurgeonShell from './surgeon/SurgeonShell';
import AstronautNotices from './AstronautNotices';
import { usePoll } from '../hooks/usePoll';
import BrandMark from './BrandMark';
import EmergencyButton from './EmergencyButton';
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
  { href: '/messages', label: 'Messages', icon: ChatBubbleLeftRightIcon, selectedIcon: ChatSolid },
];

type SessionState = SessionUser | 'loading' | 'signed-out' | 'error';

// Session gate: every app route renders only for a verified /auth/me user.
export default function AppFrame() {
  const [session, setSession] = useState<SessionState>('loading');
  const [attempt, setAttempt] = useState(0);
  const location = useLocation();

  useEffect(() => {
    const expire = () => setSession('signed-out');
    const refresh = () => setAttempt(previous => previous + 1);
    window.addEventListener(SIGN_IN_REQUIRED, expire);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(SIGN_IN_REQUIRED, expire);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSession({ signal: controller.signal })
      .then(({ user, demo }) => {
        if (!controller.signal.aborted) setSession(user?.user_id ? { ...user, demo: demo === true } : 'signed-out');
      })
      .catch(error => {
        if (!controller.signal.aborted) setSession(error instanceof ApiError && error.status === 401 ? 'signed-out' : 'error');
      });
    return () => controller.abort();
  }, [attempt]);

  // Re-checks the session after a network or server failure.
  function retry() {
    setSession('loading');
    setAttempt(previous => previous + 1);
  }

  if (session === 'signed-out') return <Navigate to="/login" replace />;
  if (session === 'loading') return <PageLoader />;
  if (session === 'error') {
    return (
      <VStack padding={6} gap={3}>
        <Text role="alert">Your session could not be checked. The EVAde API may be unreachable.</Text>
        <Button label="Try again" onClick={retry} />
      </VStack>
    );
  }

  if (STAFF_ROLES.has(session.role) && !session.demo) {
    return <SurgeonShell key={session.user_id} user={session} onSignOut={() => setSession('signed-out')} />;
  }
  if (matchRoutes([{ path: '/admin/*' }], location)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AccountStorageContext.Provider value={session.demo ? null : session.user_id}>
      <MissionProvider key={`${session.user_id}:${session.demo}`} user={session}>
        <SignedInFrame onSignOut={() => setSession('signed-out')} />
      </MissionProvider>
    </AccountStorageContext.Provider>
  );
}

// Signed-in shell: side navigation, level meter, sign-out and the routed page.
function SignedInFrame({ onSignOut }: { onSignOut: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const { pathname } = useLocation();
  const { completed, tasks, user } = useMission();
  const showToast = useToast();
  const remaining = tasks.length - completed.length;
  // Unread 1:1 messages from flight surgeons, polled every few seconds for the nav badge.
  const unread = usePoll<{ unread: number }>('/messages/unread', 5000);
  const reloadUnread = unread.reload;
  useEffect(() => {
    window.addEventListener('evade:messages-read', reloadUnread);
    return () => window.removeEventListener('evade:messages-read', reloadUnread);
  }, [reloadUnread]);
  const unreadCount = unread.data?.unread ?? 0;

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (!(await signOut({ clearAccess: !user.demo }))) onSignOut();
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
                subheading={user.mission_name ?? user.full_name ?? user.display_name}
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
                  <SideNavItem label="Sign out" icon={ArrowLeftStartOnRectangleIcon} onClick={handleSignOut} isDisabled={signingOut} />
                  <HStack gap={0.5}>
                    <MotionToggle size="sm" />
                    <ThemeToggle size="sm" />
                  </HStack>
                </HStack>
              </VStack>
            }>
            <SideNavSection title="Mission control" isHeaderHidden>
              {NAV_ITEMS.map(item => (
                <SideNavItem
                  key={item.href}
                  label={item.label}
                  href={item.href}
                  icon={item.icon}
                  selectedIcon={item.selectedIcon}
                  isSelected={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                  endContent={item.href === '/tasks' && remaining > 0 ? <Badge variant="purple" label={String(remaining)} />
                    : item.href === '/messages' && unreadCount > 0 ? <Badge variant="error" label={String(unreadCount)} /> : undefined}
                />
              ))}
            </SideNavSection>
          </SideNav>
        }>
        <Suspense fallback={<PageLoader />}>
          <VStack className="app-frame__page" key={pathname.split('/').slice(0, 2).join('/')}>
            <AstronautNotices readOnly={!!user.demo} />
            {user.demo && <Banner status="info" title="Read-only demo" description="You can try meals and hydration here. These changes reset when you reload." />}
            <Outlet />
          </VStack>
        </Suspense>
      </AppShell>
    </>
  );
}
