import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SquadOwl, Coming Soon',
  description: 'Smarter Assessments. Scheduling. Team Sorting. Clearer communication.',
};

/** The public home page while the site is not open yet. The app itself is still reachable at /login and /dashboard. */
export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/coming-soon.webp"
        alt="SquadOwl, coming soon. Smarter assessments, scheduling, team sorting and clearer communication. Your all in one team management app."
        style={{ width: 'min(100vw, 100vh)', height: 'auto', maxWidth: '100%' }}
      />
    </main>
  );
}
