import type { Metadata } from 'next';

import { LegalPage, type LegalSection } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy | SquadOwl',
  description: 'How SquadOwl collects, uses, shares and protects personal information, including information about athletes.',
};

const sections: LegalSection[] = [
  {
    id: 'who-we-are',
    title: 'Who we are',
    body: (
      <>
        <p>
          SquadOwl is a service for running athlete tryouts and evaluations, managing team rosters, schedules and
          communication, and sharing results. It is available as a website and as a mobile app for Android and iOS
          (together, the &quot;Service&quot;). In this policy, &quot;SquadOwl&quot;, &quot;we&quot; and &quot;us&quot;
          mean the operator of the Service.
        </p>
        <p>
          Questions or requests about privacy: <a href="mailto:support@tryouthq.ca">support@tryouthq.ca</a>.
        </p>
      </>
    ),
  },
  {
    id: 'information-we-collect',
    title: 'Information we collect',
    body: (
      <>
        <p>We collect only what is needed to run the Service.</p>
        <ul>
          <li>
            <strong>Account information:</strong> name, email address, password (stored only as a salted hash by our
            authentication provider) and profile photo.
          </li>
          <li>
            <strong>Athlete and roster information entered by coaches, club staff and parents:</strong> name, jersey
            number, position, date of birth, contact details for the athlete and their guardians, team and season, and
            optional medical or safety notes.
          </li>
          <li>
            <strong>Evaluation information:</strong> scores, ratings, notes, rankings, videos and photos recorded during
            tryouts and evaluations.
          </li>
          <li>
            <strong>Team activity:</strong> schedule events, RSVPs, chat messages, comments, posts, files and photos
            shared with a team.
          </li>
          <li>
            <strong>Payment information:</strong> payments are handled by Stripe. We do not receive or store full card
            numbers. We keep Stripe customer, subscription and payment record identifiers, amounts and dates.
          </li>
          <li>
            <strong>Device and usage information:</strong> a push notification token for your device, the type of device
            and browser, and basic technical logs needed to keep the Service secure and working.
          </li>
          <li>
            <strong>Communications:</strong> messages you send us for support or feedback, including any attachment you
            choose to add.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Information about athletes and children',
    body: (
      <>
        <p>
          The Service is meant for coaches, club staff and parents or guardians. It is not directed to children and
          children are not asked to create accounts on their own. Athletes, including minors, appear in the Service
          because a coach, club or parent or guardian added them to a roster or registered them for a tryout.
        </p>
        <p>
          Anyone who adds a minor to the Service confirms that they are the parent or guardian, or that they are
          authorized by the athlete&apos;s parent or guardian to do so. A parent or guardian can ask to see, correct or
          delete a child&apos;s information at any time by contacting us at{' '}
          <a href="mailto:support@tryouthq.ca">support@tryouthq.ca</a> or by removing the athlete from their My Athletes
          list. If we learn that a child under 13 has created an account without a parent or guardian, we will delete it.
        </p>
        <p>
          Medical or safety notes are optional text entered by a coach or parent. They are visible only to people with
          access to that athlete&apos;s team, are not used for any purpose other than the coach&apos;s own use, and are
          not a medical record.
        </p>
      </>
    ),
  },
  {
    id: 'how-we-use',
    title: 'How we use information',
    body: (
      <ul>
        <li>To provide the Service: run evaluations, build rosters and teams, show schedules and results.</li>
        <li>To send messages you expect: invitations, event reminders, RSVP and chat notifications, receipts and account emails.</li>
        <li>To process subscriptions and registration or team fees.</li>
        <li>To provide support, answer feedback and fix problems.</li>
        <li>To keep the Service secure, prevent abuse and meet legal obligations.</li>
        <li>To provide optional AI features you choose to use, such as turning a written team building request into rules.</li>
      </ul>
    ),
  },
  {
    id: 'sharing',
    title: 'How information is shared',
    body: (
      <>
        <p>We do not sell personal information and we do not use it for advertising.</p>
        <ul>
          <li>
            <strong>Within a team or organization:</strong> information is visible to the people the team&apos;s coach
            or club has given access to, such as other coaches, assessors, and the parents or guardians of athletes on
            that team. Parents and guardians see their own athlete&apos;s information.
          </li>
          <li>
            <strong>Service providers</strong> that process information for us under contract: Supabase (database,
            authentication and file storage), Google Firebase Cloud Messaging (push notifications), Stripe (payments),
            Resend and SendGrid (email delivery), and Anthropic (optional AI features that a coach chooses to run).
            Depending on the feature, a request includes athletes&apos; names, positions, year of birth, friend-group
            names, evaluation scores, the evaluator&apos;s name and the coach&apos;s written comments for the athletes
            involved, plus the coach&apos;s own instructions. It never includes contact details, medical notes, full
            dates of birth or payment information.
          </li>
          <li>
            <strong>Legal and safety:</strong> when required by law, or to protect the rights, safety and security of
            users and the Service.
          </li>
          <li>
            <strong>Business changes:</strong> if SquadOwl is involved in a merger or sale, information may transfer to
            the new owner, who must honour this policy.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep information',
    body: (
      <>
        <p>
          We keep information while an account or team is active. Coaches and clubs can remove athletes, events and
          evaluations, and can archive or delete a team. When an account is deleted we remove its sign in and profile and act on any
          related removal request within 30 days, except where we must keep a record for legal, tax, fraud prevention
          or dispute reasons (for example payment records).
        </p>
        <p>Backups are overwritten on a rolling schedule and do not restore deleted data into the live Service.</p>
      </>
    ),
  },
  {
    id: 'your-choices',
    title: 'Your choices and rights',
    body: (
      <>
        <ul>
          <li>Access and correct your information in the Service, or ask us to do so.</li>
          <li>Delete your account (see below) or ask us to delete information about an athlete.</li>
          <li>Turn off push notifications in your device settings, and unsubscribe from non-essential email.</li>
          <li>Ask for a copy of your information or object to a use of it.</li>
        </ul>
        <p>
          Depending on where you live (for example under PIPEDA in Canada, or GDPR and UK GDPR in Europe, or state laws
          in the United States) you may have additional rights. Contact us and we will respond within 30 days.
        </p>
      </>
    ),
  },
  {
    id: 'delete-account',
    title: 'Deleting your account',
    body: (
      <>
        <p>You can delete your account at any time, without contacting us:</p>
        <ul>
          <li>
            <strong>In the app or website:</strong> sign in, open <strong>Profile</strong>, choose{' '}
            <strong>Delete Account</strong> and confirm.
          </li>
          <li>
            <strong>By email, without signing in:</strong> write to{' '}
            <a href="mailto:support@tryouthq.ca?subject=Delete%20my%20SquadOwl%20account">support@tryouthq.ca</a> from
            the email address on the account with the subject &quot;Delete my SquadOwl account&quot;. We will confirm and
            complete the deletion within 30 days.
          </li>
        </ul>
        <p>
          Deleting an account removes your sign in and profile. We keep one minimal record, your email address and the
          date of deletion, so that signing in again can tell you the account was deleted. Information that belongs to a
          team or club, such as a roster or evaluation other coaches and parents rely on, is handled by that club. If you
          also want information about you or your child removed from a team, say so in your email and we will do it or
          pass the request to the club. Records we must keep by law, such as payment records, are kept only for the
          required period.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <p>
        Data is encrypted in transit (HTTPS) and stored with access controls so that people only see the teams and
        athletes they are authorized for. No system is perfectly secure. If you believe your account has been
        compromised, contact us right away and change your password.
      </p>
    ),
  },
  {
    id: 'international',
    title: 'Where information is processed',
    body: (
      <p>
        Our providers may process information in Canada, the United States and other countries. Where required, we rely
        on contractual protections for transfers of personal information.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        We may update this policy. When the changes are important we will tell you in the Service or by email before they
        take effect. The date at the top shows the latest version.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Email <a href="mailto:support@tryouthq.ca">support@tryouthq.ca</a> for any privacy question, access or deletion
        request, or complaint.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="8 October 2026"
      intro={
        <p>
          This policy explains what information SquadOwl collects, why, who it is shared with, and the choices you have.
          It applies to the SquadOwl website and mobile apps.
        </p>
      }
      sections={sections}
    />
  );
}
