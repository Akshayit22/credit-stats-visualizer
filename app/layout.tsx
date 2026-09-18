import type { Metadata, Viewport } from 'next';
import './nocturne.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'cred-stats — statement analytics',
  description:
    'Upload a credit card or savings statement PDF and see where the money went. ' +
    'PDFs are parsed in your browser and never stored.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#161826',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
