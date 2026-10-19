/** Bộ icon nét 1.6px dùng chung — vẽ tay để không phụ thuộc thư viện icon */
import type { SVGProps } from 'react';

type IconProps = { className?: string };

function Svg({ className = 'size-4', children, ...rest }: IconProps & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="5.25" />
    <path d="m13 13 3.5 3.5" />
  </Svg>
);

export const StopIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 8 4 4 4-4" />
  </Svg>
);

export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11.5 3.5h5v5M16.5 3.5 9.5 10.5M14.5 11.5v3a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3.5v9M6.5 9 10 12.5 13.5 9M4 16h12" />
  </Svg>
);

export const SortIcon = ({ direction, ...p }: IconProps & { direction: 'asc' | 'desc' }) => (
  <Svg {...p}>
    {direction === 'asc' ? <path d="M10 15.5v-11M6 8.5l4-4 4 4" /> : <path d="M10 4.5v11M6 11.5l4 4 4-4" />}
  </Svg>
);

export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3.5 2.8 16h14.4L10 3.5Z" />
    <path d="M10 8.5v3.2M10 14v.01" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="9" width="11" height="8" rx="1.8" />
    <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
  </Svg>
);

export const LogoMark = ({ className = 'size-8' }: IconProps) => (
  <svg viewBox="0 0 32 32" aria-hidden className={className}>
    <rect width="32" height="32" rx="8" className="fill-accent" />
    <path d="M9 9.5h9M9 13.5h6M9 17.5h4" stroke="white" strokeWidth="2" strokeLinecap="round" opacity=".55" />
    <circle cx="19" cy="18" r="5" fill="none" stroke="white" strokeWidth="2.2" />
    <path d="m22.6 21.6 3.4 3.4" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);
