import { createBrowserRouter } from 'react-router';

import { SessionGate } from '@/features/session/session-gate';
import { HomeRoute } from '@/routes/home';
import { LoginRoute } from '@/routes/login';
import { NotFoundRoute } from '@/routes/not-found';
import { RoomRoute } from '@/routes/rooms.$roomId';

/**
 * `/login` sits outside `SessionGate` on purpose: the gate redirects an unauthenticated
 * visitor there, so putting the login screen behind it would be a redirect loop.
 */
export const router = createBrowserRouter([
  { path: '/login', Component: LoginRoute },
  {
    Component: SessionGate,
    children: [
      { index: true, Component: HomeRoute },
      { path: 'rooms/:roomId', Component: RoomRoute },
    ],
  },
  { path: '*', Component: NotFoundRoute },
]);
