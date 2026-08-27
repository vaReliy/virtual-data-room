import { Link } from 'react-router';

import { LegalPage, LegalSection } from '@/features/legal/legal-page';

const SUPPORT_EMAIL = 'valeriy.garbuzov@gmail.com';

/**
 * Referenced from the Google Auth Platform Branding page as the app's privacy policy.
 * Keep it accurate: it describes exactly what `User`, `Account` and `Node` persist, and
 * the claim that no Google tokens are stored is a property of the auth module, not a
 * marketing line. If either changes, this page changes with it.
 */
export function PrivacyRoute() {
  return (
    <LegalPage title="Privacy Policy" updated="25 August 2026">
      <LegalSection heading="What this application is">
        <p>
          Virtual Data Room is a demonstration project: a secure repository for storing and sharing
          documents during due diligence. It is offered for evaluation, not as a commercial service.
          This policy describes what it collects and why.
        </p>
      </LegalSection>

      <LegalSection heading="What we receive from Google">
        <p>
          Signing in with Google is the only way into the application. With your consent Google
          returns three pieces of information, from the <code>openid</code>,{' '}
          <code>userinfo.email</code> and <code>userinfo.profile</code> scopes:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>your Google account identifier, used to recognise you on your next sign-in;</li>
          <li>
            your email address, used to identify your account and to address documents shared with
            you;
          </li>
          <li>your display name and profile picture URL, shown in the application header.</li>
        </ul>
        <p>
          No Google access or refresh tokens are stored. The application has no access to your
          Gmail, Drive, Calendar or any other Google service.
        </p>
      </LegalSection>

      <LegalSection heading="What you create in the application">
        <p>
          Files you upload are stored in Google Cloud Storage. Their names, sizes, content types and
          folder structure are stored in a PostgreSQL database, together with the share links you
          create. Your documents are private to your account until you share them, and a share link
          grants read-only access to exactly what it points at.
        </p>
      </LegalSection>

      <LegalSection heading="Cookies">
        <p>
          One cookie is set: an httpOnly session cookie that keeps you signed in. It is not readable
          by scripts and is not used for tracking. There is no analytics, no advertising and no
          third-party tracker on this site.
        </p>
      </LegalSection>

      <LegalSection heading="Where the data is held">
        <p>
          Application data is held by three infrastructure providers acting on our behalf: Neon (the
          PostgreSQL database), Google Cloud Platform (file storage and the API server) and Vercel
          (this web interface). Data is not sold, rented or disclosed to anyone else.
        </p>
      </LegalSection>

      <LegalSection heading="Retention and deletion">
        <p>
          Data is kept for as long as the account exists. Write to{' '}
          <a className="underline underline-offset-4" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>{' '}
          to have your account, your files and your share links deleted. You may also revoke the
          application's access at any time from your{' '}
          <a
            className="underline underline-offset-4"
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
          >
            Google account permissions
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Changes and contact">
        <p>
          Any change to this policy is published on this page with a new date above. Questions go to{' '}
          <a className="underline underline-offset-4" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          . The accompanying{' '}
          <Link className="underline underline-offset-4" to="/terms">
            Terms of Service
          </Link>{' '}
          cover use of the application itself.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
