import type { Metadata, Viewport } from 'next';
import { PwaStatus } from '@/components/routerunner/pwa-status';
import { routeRunnerReleaseId } from '@/pwa/release';
import 'mapbox-gl/dist/mapbox-gl.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'RouteRunner',
  description: 'Your AI plans. RouteRunner executes.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
  other: {
    'routerunner-release': routeRunnerReleaseId,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#176b50',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <PwaStatus />
      </body>
    </html>
  );
}
