import { Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Badge } from '@astryxdesign/core/Badge';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { NavIcon } from '@astryxdesign/core/NavIcon';
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { useToast } from '@astryxdesign/core/Toast';
import {
  ArrowLeftStartOnRectangleIcon,
  BellAlertIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import {
  BellAlertIcon as BellAlertSolid,
  ChatBubbleLeftRightIcon as ChatSolid,
  ExclamationTriangleIcon as ExclamationSolid,
  UserGroupIcon as UserGroupSolid,
} from '@heroicons/react/24/solid';
import { api, type SessionUser } from '../services/api';
import { roleLabel } from '../services/clinic';
import AmbientBackdrop from './AmbientBackdrop';
import BrandMark from './BrandMark';
import MotionToggle from './MotionToggle';
import { useResource } from '../services/useResource';
import NotificationBell, { type Notifications } from './NotificationBell';
import PageLoader from './PageLoader';
import ThemeToggle from './ThemeToggle';

const NAV = [
  { href: '/admin', label: 'Crew', icon: UserGroupIcon, selectedIcon: UserGroupSolid },
  { href: '/admin/emergencies', label: 'Emergencies', icon: ExclamationTriangleIcon, selectedIcon: ExclamationSolid },
  { href: '/admin/alerts', label: 'Alert history', icon: BellAlertIcon, selectedIcon: BellAlertSolid },
  { href: '/admin/chat', label: 'Messages', icon: ChatBubbleLeftRightIcon, selectedIcon: ChatSolid },
];

function selected(href: string, pathname: string) {
  if (href === '/admin') return pathname === '/admin' || pathname.startsWith('/admin/astronauts');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminShell({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const pathname = useLocation().pathname.toLowerCase();
  const [signingOut, setSigningOut] = useState(false);
  const showToast = useToast();
  const notes = useResource<Notifications>('/admin/notifications');
  const { reload } = notes;
  useEffect(() => {
    const timer = window.setInterval(reload, 12000);
    return () => window.clearInterval(timer);
  }, [reload]);
  if (!pathname.startsWith('/admin')) return <Navigate to="/admin" replace />;

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

  const openEmergencies = notes.data?.open_count ?? 0;
  const unread = notes.data?.unread_messages ?? 0;

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
                subheading={`${roleLabel(user.role)} · ${user.display_name}`}
                icon={<NavIcon icon={<BrandMark size="sm" />} />}
                headingHref="/admin"
              />
            }
            footer={
              <VStack gap={2}>
                <HStack hAlign="between" vAlign="center">
                  <NotificationBell data={notes.data} reload={notes.reload} />
                  <HStack gap={0.5}>
                    <MotionToggle size="sm" />
                    <ThemeToggle size="sm" />
                  </HStack>
                </HStack>
                <Divider />
                <SideNavItem label="Sign out" icon={ArrowLeftStartOnRectangleIcon} onClick={signOut} isDisabled={signingOut} />
              </VStack>
            }
          >
            <SideNavSection title="Flight surgeon" isHeaderHidden>
              {NAV.map(item => (
                <SideNavItem
                  key={item.href}
                  label={item.label}
                  href={item.href}
                  icon={item.icon}
                  selectedIcon={item.selectedIcon}
                  isSelected={selected(item.href, pathname)}
                  endContent={
                    item.href === '/admin/emergencies' && openEmergencies > 0 ? <Badge variant="error" label={String(openEmergencies)} />
                    : item.href === '/admin/chat' && unread > 0 ? <Badge variant="purple" label={String(unread)} />
                    : undefined
                  }
                />
              ))}
            </SideNavSection>
          </SideNav>
        }
      >
        <Suspense fallback={<PageLoader />}>
          <VStack className="app-frame__page" key={pathname}>
            <Outlet context={user} />
          </VStack>
        </Suspense>
      </AppShell>
    </>
  );
}
