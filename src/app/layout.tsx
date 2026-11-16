import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Cypress Dental | Independent Scheduling Concept',
  description: 'An independent dental scheduling concept using synthetic patients and appointments.',
  robots: { index: false, follow: false },
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;
}
