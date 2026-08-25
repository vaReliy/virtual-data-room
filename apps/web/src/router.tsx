import { createBrowserRouter } from 'react-router';

import { SessionGate } from '@/features/session/session-gate';
import { HomeRoute } from '@/routes/home';
import { LoginRoute } from '@/routes/login';
import { NotFoundRoute } from '@/routes/not-found';
import { PrivacyRoute } from '@/routes/privacy';
import { RoomRoute } from '@/routes/rooms.$roomId';
import { TermsRoute } from '@/routes/terms';

/**
 * `/login` sits outside `SessionGate` on purpose: the gate redirects an unauthenticated
 * visitor there, so putting the login screen behind it would be a redirect loop.
 *
 * `/privacy` and `/terms` sit outside it for a different reason: they are the links
 * registered on the Google Auth Platform Branding page, and they must resolve for a
 * signed-out visitor.
 */
export const router = createBrowserRouter([
  { path: '/login', Component: LoginRoute },
  { path: '/privacy', Component: PrivacyRoute },
  { path: '/terms', Component: TermsRoute },
  {
    Component: SessionGate,
    children: [
      { index: true, Component: HomeRoute },
      { path: 'rooms/:roomId', Component: RoomRoute },
    ],
  },
  { path: '*', Component: NotFoundRoute },
]);
