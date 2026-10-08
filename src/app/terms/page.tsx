import type { Metadata } from 'next';

import { LegalPage, type LegalSection } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service | SquadOwl',
  description: 'The terms for using SquadOwl, including rules for content shared in teams.',
};

const sections: LegalSection[] = [
  {
    id: 'agreement',
    title: 'Agreement',
    body: (
      <p>
        By creating an account or using SquadOwl (the website and mobile apps, together the &quot;Service&quot;) you agree
        to these terms and to our <a href="/privacy">Privacy Policy</a>. If you use the Service for a club or
        organization, you confirm you are allowed to accept these terms for it. If you do not agree, do not use the
        Service.
      </p>
    ),
  },
  {
    id: 'accounts',
    title: 'Accounts',
    body: (
      <ul>
        <li>You must be at least 18, or the age of majority where you live, to create an account.</li>
        <li>Give accurate information and keep your password private. You are responsible for activity on your account.</li>
        <li>Tell us promptly if you think your account has been accessed without permission.</li>
      </ul>
    ),
  },
  {
    id: 'athletes',
    title: 'Information about athletes',
    body: (
      <>
        <p>
          You may add an athlete to the Service only if you are their parent or guardian, or you are a coach or club
          representative who has the authority and any required consent from the athlete and their parent or guardian to
          do so. You are responsible for the accuracy of what you enter and for using it only for running tryouts, teams
          and events.
        </p>
        <p>Do not enter information you are not allowed to share, and do not use athlete information for any other purpose.</p>
      </>
    ),
  },
  {
    id: 'content',
    title: 'Content and conduct',
    body: (
      <>
        <p>
          You keep ownership of the content you post (chat messages, comments, posts, photos, videos and files). You give
          us permission to store, display and deliver it within the Service to the people you share it with.
        </p>
        <p>You must not post or send content that:</p>
        <ul>
          <li>is illegal, harassing, hateful, threatening, sexually explicit or promotes violence;</li>
          <li>targets, bullies or endangers a child or any other person;</li>
          <li>shares another person&apos;s private information or images without permission;</li>
          <li>is spam, malware or an attempt to access accounts or data that are not yours;</li>
          <li>infringes someone else&apos;s rights.</li>
        </ul>
        <p>
          Team content is shared with the members of that team. Coaches and team managers can remove content in their
          teams. We may remove content or suspend accounts that break these rules, and we may report serious cases to
          the authorities.
        </p>
      </>
    ),
  },
  {
    id: 'reporting',
    title: 'Reporting a problem',
    body: (
      <p>
        To report abusive content or a user, email <a href="mailto:support@tryouthq.ca">support@tryouthq.ca</a> with the
        team name, what you saw and when. We review reports promptly and remove content that breaks these terms. You can
        also ask the coach or team manager to remove content or a member from their team.
      </p>
    ),
  },
  {
    id: 'plans',
    title: 'Plans, fees and payments',
    body: (
      <>
        <p>
          Some features need a paid plan, shown with its price before you buy. Plans renew each period until cancelled.
          You can cancel any time from your account billing page; access continues to the end of the paid period. Fees
          are charged in the currency shown, are processed by Stripe, and are non-refundable except where the law
          requires or we say otherwise.
        </p>
        <p>
          Registration or team fees paid to a club are payments to that club, not to SquadOwl. Refund questions about
          them go to the club.
        </p>
      </>
    ),
  },
  {
    id: 'ai',
    title: 'AI features',
    body: (
      <p>
        Optional AI features produce suggestions, such as team building rules. They can be wrong. A coach is always
        responsible for the decisions made about athletes, and should review any suggestion before acting on it.
      </p>
    ),
  },
  {
    id: 'health',
    title: 'Not medical or professional advice',
    body: (
      <p>
        The Service stores notes entered by users and does not give medical, safety or coaching advice. It is not a
        medical record. Follow your league&apos;s safety rules and seek professional advice when needed.
      </p>
    ),
  },
  {
    id: 'availability',
    title: 'Availability and changes',
    body: (
      <p>
        We work to keep the Service available but do not promise it will be uninterrupted or error free. We may change or
        stop features, and we will give notice of changes that materially affect paid plans.
      </p>
    ),
  },
  {
    id: 'termination',
    title: 'Ending your use',
    body: (
      <p>
        You can delete your account at any time from Profile, or by emailing{' '}
        <a href="mailto:support@tryouthq.ca">support@tryouthq.ca</a>. We may suspend or end access if you break these
        terms or use the Service in a way that puts others or the Service at risk.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Limits of liability',
    body: (
      <p>
        The Service is provided &quot;as is&quot;. To the extent the law allows, SquadOwl is not liable for indirect or
        consequential losses, or for decisions made by coaches or clubs using the Service, and our total liability to
        you for any claim is limited to the amount you paid us in the 12 months before the claim. Nothing here limits
        rights you have under consumer protection law.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these terms. If a change is important we will tell you in the Service or by email before it takes
        effect. Continuing to use the Service after that means you accept the update.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about these terms: <a href="mailto:support@tryouthq.ca">support@tryouthq.ca</a>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="8 October 2026"
      intro={<p>These terms explain the rules for using SquadOwl. Please read them together with our Privacy Policy.</p>}
      sections={sections}
    />
  );
}
