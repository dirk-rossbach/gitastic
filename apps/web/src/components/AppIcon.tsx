import { useId } from 'react';
import { cn } from '../lib/utils';

export function AppIcon({ className }: { className?: string }) {
  const id = useId().replace(/[:]/g, '');
  const gradientId = `gitastic-logo-${id}`;
  return (
    <svg viewBox="0 0 32 32" className={cn('block', className)} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="58%" style={{ stopColor: 'var(--accent-2)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--accent-3)' }} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill={`url(#${gradientId})`} />
      <path d="M11 8.5v15" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M11 17c0-4 10-2 10-6.5" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="11" cy="8.5" r="2.4" fill="#ffffff" />
      <circle cx="11" cy="23.5" r="2.4" fill="#ffffff" />
      <circle cx="21" cy="10.5" r="2.4" fill="#ffffff" />
    </svg>
  );
}
