import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * While the site is "Coming Soon", the public domain serves only the home page:
 * every other route on squadowl.com sends the visitor back to it. Any other host
 * (localhost, preview deployments, the app's own domain) is left alone.
 */
const LOCKED_HOSTS = new Set(['squadowl.com', 'www.squadowl.com']);

export function proxy(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase();
  if (!LOCKED_HOSTS.has(host)) return NextResponse.next();
  const { pathname } = request.nextUrl;
  // The page itself and the one file it shows.
  if (pathname === '/' || pathname === '/images/coming-soon.webp') return NextResponse.next();
  return NextResponse.redirect(new URL('/', request.url), 307);
}

export const config = {
  // Skip Next's own build output so the home page can still load; everything else is checked.
  matcher: ['/((?!_next/static|_next/image|favicon.png|icon.png|apple-icon.png).*)'],
};
