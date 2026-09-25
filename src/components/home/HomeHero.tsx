'use client';

/**
 * Compact brand banner for the home screen. Deliberately short — a returning
 * user is here for the sections below it, so it stays a strip rather than a
 * full-screen splash. Always dark: the text is white in both themes.
 */
export function HomeHero() {
  return (
    <section
      className="relative overflow-hidden rounded-2xl"
      style={{ background: 'linear-gradient(135deg, #0c1528 0%, #111f3a 65%, #1a2440 100%)' }}
    >
      {/* Angled brand streak along the right edge. */}
      <svg
        aria-hidden
        className="absolute top-0 right-0 h-full w-[110px] sm:w-[220px]"
        viewBox="0 0 120 100"
        preserveAspectRatio="none"
      >
        <path d="M120 0 L120 100 L60 100 Z" fill="#ff6b2b" fillOpacity={0.9} />
        <path d="M120 0 L120 100 L88 100 Z" fill="#ff6b2b" />
      </svg>

      <div className="relative flex min-h-[132px] flex-col justify-center p-4 pr-[96px] sm:min-h-[150px] sm:p-6 sm:pr-[220px]">
        <div className="mb-2 flex items-center gap-2">
          <span className="block h-0.5 w-4" style={{ backgroundColor: '#ff6b2b' }} />
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase sm:text-xs" style={{ color: '#ff9a5c' }}>
            Organize · Evaluate · Compare
          </span>
        </div>
        <h2
          className="text-xl leading-tight font-bold sm:text-3xl"
          style={{ color: '#ffffff', fontFamily: 'var(--font-space-grotesk)' }}
        >
          Better Evaluations.
          <br />
          <span style={{ color: '#ff6b2b' }}>Stronger Teams.</span>
        </h2>
        <p className="mt-2 max-w-md text-xs leading-snug sm:text-sm" style={{ color: 'rgba(232,238,255,0.72)' }}>
          Simplify your tryouts with powerful tools, real-time results and professional reports.
        </p>
      </div>
    </section>
  );
}
