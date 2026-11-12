import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import AppShell from './components/shell/AppShell';
import RouteBoundary from './components/shared/RouteBoundary.jsx';
import { PageSkeleton } from './components/shared/Skeleton';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './auth/useAuth';
import AuthGate from './auth/AuthGate';
import { ToastProvider } from './contexts/ToastContext';
import PendingSyncFlush from './components/PendingSyncFlush';
import Onboarding from './components/onboarding/Onboarding';
import { MODULE_ROUTES, MODULE_SHELL, REPLACED_KIT_PATHS } from './modules';

// A module that owns the shell (a built app, src/modules/runtime.jsx) replaces the kit AppShell and Onboarding.
const Frame = MODULE_SHELL?.Frame ?? AppShell;

const Home = lazy(() => import('./pages/Home'));
const Settings = lazy(() => import('./pages/Settings'));

// Kit routes a module takes over (listing the path in `replacesKitPaths`, src/modules/) are left out.
const keeps = (path) => !REPLACED_KIT_PATHS.has(path);

// The route outlet inside the kit boundary: a lazy route whose chunk fails to load, or a page that throws, shows words
// and a way out instead of a blank app. A new path starts a fresh try.
function RoutedOutlet() {
  const { pathname } = useLocation();
  return (
    <RouteBoundary resetKey={pathname} homeTo={pathname === '/' ? null : '/'}>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          {MODULE_ROUTES.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
          {keeps('/') && <Route path="/" element={<Home />} />}
          {keeps('/settings') && <Route path="/settings" element={<Settings />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </RouteBoundary>
  );
}

// Add a kit page: a lazy import above, a <Route> below (wrapped in keeps()), its path in src/modules/kitRoutes.js
// (KIT_ROUTE_PATHS; server/__tests__/e2eRoutes.test.js fails when the two differ), an item in components/shell/navItems.js.
// Add a module page: a lazy route in that module's file under src/modules/.
function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGate>
          <BrowserRouter>
            <ToastProvider>
              <PendingSyncFlush />
              {MODULE_SHELL === null && <Onboarding />}
              <Frame>
                <RoutedOutlet />
              </Frame>
            </ToastProvider>
          </BrowserRouter>
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
