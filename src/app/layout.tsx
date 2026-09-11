import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const spaceGrotesk = Space_Grotesk({ variable: '--font-space-grotesk', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'TryoutHQ',
  description: 'Run athlete tryouts and evaluations — rosters, rinkside scoring, results and team building.',
  // Home-screen installs on iOS get the app name and their own status bar.
  appleWebApp: { capable: true, title: 'TryoutHQ', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the page paint into the notch/home-indicator areas; the shell then
  // pays those insets back with the .pt-safe/.pb-safe utilities. Without it
  // env(safe-area-inset-*) is always 0 on iOS.
  viewportFit: 'cover',
  // Chrome's default keyboard behavior (resizes-visual) only shrinks the
  // *visual* viewport, not the layout one — so every `dvh`-sized panel (the
  // team chat composer included) keeps its pre-keyboard height and the
  // keyboard simply overlays on top of it, covering the input. This makes
  // the layout viewport itself shrink when the keyboard opens, so `dvh`
  // layouts resize out from under it instead of being covered.
  interactiveWidget: 'resizes-content',
  // No maximumScale/userScalable here on purpose — pinch-zoom stays available.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f9fcff' },
    { media: '(prefers-color-scheme: dark)', color: '#070d1a' },
  ],
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
