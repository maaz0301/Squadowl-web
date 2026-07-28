'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Renders a QR code as a data-URL image, mirroring the app's QR registration code. */
export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!src) return <div style={{ width: size, height: size, background: '#fff', borderRadius: 12 }} />;

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Registration QR code" width={size} height={size} style={{ borderRadius: 12 }} />;
}
