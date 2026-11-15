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
