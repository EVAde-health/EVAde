import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Theme } from '@astryxdesign/core/theme';
import { LinkProvider } from '@astryxdesign/core/Link';
import { themes, defaultThemeSlug } from './astryx-themes';
import { ColorModeContext } from './context/ColorModeContext';
import { useColorMode } from './hooks/useColorMode';
import AppFrame from './components/AppFrame';
import PageLoader from './components/PageLoader';
import RouterLink from './components/RouterLink';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TutorialsPage = lazy(() => import('./pages/TutorialsPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const JournalPage = lazy(() => import('./pages/JournalPage'));
const SelfiesPage = lazy(() => import('./pages/SelfiesPage'));
const CrewChatPage = lazy(() => import('./pages/CrewChatPage'));
const CrewPage = lazy(() => import('./pages/admin/CrewPage'));
const GoalsPage = lazy(() => import('./pages/admin/GoalsPage'));
const EmergenciesPage = lazy(() => import('./pages/admin/EmergenciesPage'));
const StaffChatPage = lazy(() => import('./pages/admin/StaffChatPage'));
const AlertHistoryPage = lazy(() => import('./pages/admin/HealthPages').then(module => ({ default: module.AlertHistoryPage })));
const AstronautOverviewPage = lazy(() => import('./pages/admin/HealthPages').then(module => ({ default: module.AstronautOverviewPage })));
const VitalsPage = lazy(() => import('./pages/admin/HealthPages').then(module => ({ default: module.VitalsPage })));
const NutritionAdminPage = lazy(() => import('./pages/admin/HealthPages').then(module => ({ default: module.NutritionAdminPage })));
const SleepAdminPage = lazy(() => import('./pages/admin/HealthPages').then(module => ({ default: module.SleepAdminPage })));
const MoodAdminPage = lazy(() => import('./pages/admin/HealthPages').then(module => ({ default: module.MoodAdminPage })));
const AstronautAlertsPage = lazy(() => import('./pages/admin/HealthPages').then(module => ({ default: module.AstronautAlertsPage })));

// Root: theme, routing, link adapter and shared mission state.
export default function App() {
  const colorMode = useColorMode();

  return (
    <ColorModeContext.Provider value={colorMode}>
      <Theme theme={themes[defaultThemeSlug]} mode={colorMode.mode}>
        <BrowserRouter>
          <LinkProvider component={RouterLink}>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route element={<AppFrame />}>
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/tutorials" element={<TutorialsPage />} />
                    <Route path="/tasks" element={<TasksPage />} />
                    <Route path="/journal" element={<JournalPage />} />
                    <Route path="/selfies" element={<SelfiesPage />} />
                    <Route path="/chat" element={<CrewChatPage />} />
                    <Route path="/chat/:staffId" element={<CrewChatPage />} />
                    <Route path="/admin" element={<CrewPage />} />
                    <Route path="/admin/emergencies" element={<EmergenciesPage />} />
                    <Route path="/admin/alerts" element={<AlertHistoryPage />} />
                    <Route path="/admin/chat" element={<StaffChatPage />} />
                    <Route path="/admin/chat/:threadId" element={<StaffChatPage />} />
                    <Route path="/admin/astronauts/:id" element={<AstronautOverviewPage />} />
                    <Route path="/admin/astronauts/:id/goals" element={<GoalsPage />} />
                    <Route path="/admin/astronauts/:id/vitals" element={<VitalsPage />} />
                    <Route path="/admin/astronauts/:id/nutrition" element={<NutritionAdminPage />} />
                    <Route path="/admin/astronauts/:id/sleep" element={<SleepAdminPage />} />
                    <Route path="/admin/astronauts/:id/mood" element={<MoodAdminPage />} />
                    <Route path="/admin/astronauts/:id/alerts" element={<AstronautAlertsPage />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
          </LinkProvider>
        </BrowserRouter>
      </Theme>
    </ColorModeContext.Provider>
  );
}
