import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Theme } from '@astryxdesign/core/theme';
import { LinkProvider } from '@astryxdesign/core/Link';
import { ToastViewport } from '@astryxdesign/core/Toast';
import { themes, defaultThemeSlug } from './astryx-themes';
import { ColorModeContext } from './context/ColorModeContext';
import { useColorMode } from './hooks/useColorMode';
import AppFrame from './components/AppFrame';
import PageLoader from './components/PageLoader';
import RouterLink from './components/RouterLink';
import ToastCenter from './components/ToastCenter';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TutorialsPage = lazy(() => import('./pages/TutorialsPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const JournalPage = lazy(() => import('./pages/JournalPage'));
const SelfiesPage = lazy(() => import('./pages/SelfiesPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
const ResearchPage = lazy(() => import('./pages/ResearchPage'));
const ModelsPage = lazy(() => import('./pages/ModelsPage'));
const CrewPage = lazy(() => import('./pages/surgeon/CrewPage'));
const AstronautPage = lazy(() => import('./pages/surgeon/AstronautPage'));
const SurgeonMessagesPage = lazy(() => import('./pages/surgeon/SurgeonMessagesPage'));
const EmergenciesPage = lazy(() => import('./pages/surgeon/EmergenciesPage'));

// Root: theme, routing, link adapter and shared mission state.
export default function App() {
  const colorMode = useColorMode();

  return (
    <ColorModeContext.Provider value={colorMode}>
      <Theme theme={themes[defaultThemeSlug]} mode={colorMode.mode}>
        <ToastViewport position="topEnd" maxVisible={4} inset={{ top: 24, end: 24, start: 24 }}>
        <ToastCenter>
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
                    <Route path="/research" element={<ResearchPage />} />
                    <Route path="/models" element={<ModelsPage />} />
                    <Route path="/messages" element={<MessagesPage />} />
                    <Route path="/messages/:id" element={<MessagesPage />} />
                    <Route path="/chat/*" element={<Navigate to="/messages" replace />} />
                    <Route path="/admin" element={<CrewPage />} />
                    <Route path="/admin/astronauts" element={<AstronautPage />} />
                    <Route path="/admin/astronauts/:id" element={<AstronautPage />} />
                    <Route path="/admin/astronauts/:id/:section" element={<AstronautPage />} />
                    <Route path="/admin/messages" element={<SurgeonMessagesPage />} />
                    <Route path="/admin/messages/:id" element={<SurgeonMessagesPage />} />
                    <Route path="/admin/emergencies" element={<EmergenciesPage />} />
                    <Route path="/admin/*" element={<Navigate to="/admin" replace />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
          </LinkProvider>
        </BrowserRouter>
        </ToastCenter>
        </ToastViewport>
      </Theme>
    </ColorModeContext.Provider>
  );
}
