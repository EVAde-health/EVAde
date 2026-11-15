import { Suspense, useMemo, useState } from 'react';
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
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  IdentificationIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import {
  ChatBubbleLeftRightIcon as ChatSolid,
  ExclamationTriangleIcon as ExclamationSolid,
  IdentificationIcon as IdentificationSolid,
  UserGroupIcon as UserGroupSolid,
} from '@heroicons/react/24/solid';
import { SurgeonContext } from '../../context/SurgeonContext';
import { usePoll } from '../../hooks/usePoll';
import { signOut, type SessionUser } from '../../services/healthApi';
import { roleLabel } from '../../services/clinic';
import type { AdminNotifications } from '../../services/surgeon';
import AmbientBackdrop from '../AmbientBackdrop';
import BrandMark from '../BrandMark';
import MotionToggle from '../MotionToggle';
import PageLoader from '../PageLoader';
import ThemeToggle from '../ThemeToggle';
import EmergencyDropdown from './EmergencyDropdown';
import '../css/AppFrame.css';
import './surgeon.css';

const NAV = [
  { href: '/admin', label: 'Crew', icon: UserGroupIcon, selectedIcon: UserGroupSolid },
  { href: '/admin/astronauts', label: 'Astronaut', icon: IdentificationIcon, selectedIcon: IdentificationSolid },
  { href: '/admin/messages', label: 'Messages', icon: ChatBubbleLeftRightIcon, selectedIcon: ChatSolid },
  { href: '/admin/emergencies', label: 'Emergencies', icon: ExclamationTriangleIcon, selectedIcon: ExclamationSolid },
];

function selected(href: string, pathname: string) {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Flight-surgeon app: side navigation with live badges, the emergency drop-down, and the routed page.
export default function SurgeonShell({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const pathname = useLocation().pathname;
  const [signingOut, setSigningOut] = useState(false);
  const showToast = useToast();
  // Every surgeon page polls once here (~5 s); pages read it from context.
  const notes = usePoll<AdminNotifications>('/admin/notifications', 5000);
  const context = useMemo(
    () => ({ user, notifications: notes.data, refreshNotifications: notes.reload }),
    [user, notes.data, notes.reload],
  );
  if (!pathname.startsWith('/admin')) return <Navigate to="/admin" replace />;

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (!(await signOut())) onSignOut();
    } catch {
      showToast({ body: 'Sign-out failed. Please try again.' });
      setSigningOut(false);
    }
  }

  const active = (notes.data?.open_count ?? 0) + (notes.data?.acknowledged_count ?? 0);
  const unread = notes.data?.unread_messages ?? 0;

  return (
    <SurgeonContext.Provider value={context}>
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
                subheading={`${roleLabel(user.role)} · ${user.full_name || user.display_name}`}
                icon={<NavIcon icon={<BrandMark size="sm" />} />}
                headingHref="/admin"
              />
            }
            footer={
              <VStack gap={2}>
                <HStack hAlign="end" gap={0.5}>
                  <MotionToggle size="sm" />
                  <ThemeToggle size="sm" />
                </HStack>
                <Divider />
                <SideNavItem label="Sign out" icon={ArrowLeftStartOnRectangleIcon} onClick={handleSignOut} isDisabled={signingOut} />
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
                    item.href === '/admin/emergencies' && active > 0
                      ? <Badge variant={notes.data?.open_count ? 'error' : 'warning'} label={String(active)} />
                      : item.href === '/admin/messages' && unread > 0 ? <Badge variant="purple" label={String(unread)} />
                      : undefined
                  }
                />
              ))}
            </SideNavSection>
          </SideNav>
        }
      >
        <VStack className="app-frame__page">
          <EmergencyDropdown />
          <Suspense fallback={<PageLoader />}>
            <VStack key={pathname.split('/').slice(0, 3).join('/')}>
              <Outlet context={user} />
            </VStack>
          </Suspense>
        </VStack>
      </AppShell>
    </SurgeonContext.Provider>
  );
}
