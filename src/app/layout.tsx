import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const spaceGrotesk = Space_Grotesk({ variable: '--font-space-grotesk', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'TryoutHQ',
  description: 'Run athlete tryouts and assessments — rosters, rinkside scoring, results and team building.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} h-full`} data-theme="dark">
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
