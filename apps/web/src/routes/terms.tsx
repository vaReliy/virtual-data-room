import { Link } from 'react-router';

import { LegalPage, LegalSection } from '@/features/legal/legal-page';

const SUPPORT_EMAIL = 'valeriy.garbuzov@gmail.com';

/** Referenced from the Google Auth Platform Branding page as the app's terms of service. */
export function TermsRoute() {
  return (
    <LegalPage title="Terms of Service" updated="25 August 2026">
      <LegalSection heading="1. The service">
        <p>
          Virtual Data Room is a demonstration project offered for evaluation. It is provided free
          of charge, as-is, and may be changed, taken offline or reset without notice. Using it
          means accepting these terms.
        </p>
      </LegalSection>

      <LegalSection heading="2. Your account">
        <p>
          Access requires signing in with a Google account. You are responsible for that account and
          for everything done through it. Access may be withdrawn at any time.
        </p>
      </LegalSection>

      <LegalSection heading="3. Acceptable use">
        <ul className="list-disc space-y-1 pl-5">
          <li>Do not upload unlawful content, malware, or material you have no right to store.</li>
          <li>
            Do not upload confidential documents or other people's personal data. This is a
            demonstration project, not an audited production system.
          </li>
          <li>Do not attempt to reach documents belonging to another account.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. No warranty">
        <p>
          The application is provided without warranty of any kind, including availability,
          durability or fitness for a particular purpose. Keep your own copy of anything you upload:
          stored files may be deleted at any time, and no backup is promised.
        </p>
      </LegalSection>

      <LegalSection heading="5. Liability">
        <p>
          To the extent permitted by law, no liability is accepted for any loss arising from use of
          the application, including loss of data or of access to it.
        </p>
      </LegalSection>

      <LegalSection heading="6. Contact">
        <p>
          Questions go to{' '}
          <a className="underline underline-offset-4" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          . The{' '}
          <Link className="underline underline-offset-4" to="/privacy">
            Privacy Policy
          </Link>{' '}
          describes what the application stores.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
