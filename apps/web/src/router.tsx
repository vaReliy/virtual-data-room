import { createBrowserRouter } from 'react-router';

import { SessionGate } from '@/features/session/session-gate';
import { HomeRoute } from '@/routes/home';
import { LoginRoute } from '@/routes/login';
import { NotFoundRoute } from '@/routes/not-found';
import { PrivacyRoute } from '@/routes/privacy';
import { NodeRoute } from '@/routes/rooms.$roomId.n.$nodeId';
import { RoomRoute } from '@/routes/rooms.$roomId';
import { SharedNodeRootRoute } from '@/routes/s.$token';
import { SharedNodeRoute } from '@/routes/s.$token.n.$nodeId';
import { SharedRoute } from '@/routes/shared';
import { TermsRoute } from '@/routes/terms';

/**
 * `/login` sits outside `SessionGate` on purpose: the gate redirects an unauthenticated
 * visitor there, so putting the login screen behind it would be a redirect loop.
 *
 * `/privacy` and `/terms` sit outside it for a different reason: they are the links
 * registered on the Google Auth Platform Branding page, and they must resolve for a
 * signed-out visitor.
 *
 * `/s/:token` is outside it for the strongest reason of the three. A share recipient has
 * no account, so the gate would bounce them to `/login` — and signing in would not help
 * them: the token is the authorization, and it grants nothing to a session. Putting these
 * two routes behind the gate would make every share link a sign-in prompt.
 */
export const router = createBrowserRouter([
  { path: '/login', Component: LoginRoute },
  { path: '/privacy', Component: PrivacyRoute },
  { path: '/terms', Component: TermsRoute },
  { path: '/s/:token', Component: SharedNodeRootRoute },
  { path: '/s/:token/n/:nodeId', Component: SharedNodeRoute },
  {
    Component: SessionGate,
    children: [
      { index: true, Component: HomeRoute },
      { path: 'shared', Component: SharedRoute },
      { path: 'rooms/:roomId', Component: RoomRoute },
      { path: 'rooms/:roomId/n/:nodeId', Component: NodeRoute },
    ],
  },
  { path: '*', Component: NotFoundRoute },
]);
