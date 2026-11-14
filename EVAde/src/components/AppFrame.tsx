import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
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
  CheckCircleIcon,
  PlayCircleIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import {
  BookOpenIcon as BookOpenSolid,
  CameraIcon as CameraSolid,
  CheckCircleIcon as CheckCircleSolid,
  PlayCircleIcon as PlayCircleSolid,
  Squares2X2Icon as Squares2X2Solid,
} from '@heroicons/react/24/solid';
import { CREW } from '../data/mission';
import { BASIC_TASKS, PROTOCOL_TASKS } from '../data/tasks';
import { useMission } from '../context/MissionContext';
import BrandMark from './BrandMark';
import LevelMeter from './LevelMeter';
import PageLoader from './PageLoader';
import ThemeToggle from './ThemeToggle';
import './css/AppFrame.css';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: Squares2X2Icon, selectedIcon: Squares2X2Solid },
  { href: '/tutorials', label: 'Tutorials', icon: PlayCircleIcon, selectedIcon: PlayCircleSolid },
  { href: '/tasks', label: 'Missions', icon: CheckCircleIcon, selectedIcon: CheckCircleSolid },
  { href: '/journal', label: 'Journal', icon: BookOpenIcon, selectedIcon: BookOpenSolid },
  { href: '/selfies', label: 'Selfies', icon: CameraIcon, selectedIcon: CameraSolid },
];

const TASK_TOTAL = PROTOCOL_TASKS.length + BASIC_TASKS.length;

// Authenticated app chrome: side navigation around the routed page.
export default function AppFrame() {
  const { pathname } = useLocation();
  const { completed } = useMission();
  const remaining = TASK_TOTAL - completed.length;

  return (
    <AppShell
      variant="elevated"
      contentPadding={0}
      sideNav={
        <SideNav
          collapsible
          header={
            <SideNavHeading
              heading="EVAde"
              subheading={`${CREW.mission} · Day ${CREW.missionDay}`}
              icon={<NavIcon icon={<BrandMark size="sm" />} />}
              headingHref="/dashboard"
            />
          }
          footer={
            <VStack gap={2}>
              <LevelMeter />
              <Divider />
              <HStack gap={1} vAlign="center" hAlign="between">
                <SideNavItem label="Sign out" icon={ArrowLeftStartOnRectangleIcon} href="/" />
                <ThemeToggle size="sm" />
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
  );
}
