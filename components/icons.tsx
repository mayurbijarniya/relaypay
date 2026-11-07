import type { SVGProps } from "react";

/** Small stroke icon set, drawn for RelayPay. 20px grid, 1.75 stroke. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 9.2 10 3.5l7 5.7V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1V9.2Z" />
  </Svg>
);

export const IconBag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 6.5h11l-.9 9.6a1 1 0 0 1-1 .9H6.4a1 1 0 0 1-1-.9l-.9-9.6Z" />
    <path d="M7.5 8.5V6a2.5 2.5 0 0 1 5 0v2.5" />
  </Svg>
);

export const IconReceipt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 2.75h10v14.5l-2-1.25-1.5 1.25L10 16l-1.5 1.25L7 16l-2 1.25V2.75Z" />
    <path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" />
  </Svg>
);

export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 2.75 16 5v4.6c0 3.6-2.5 6.3-6 7.65-3.5-1.35-6-4.05-6-7.65V5l6-2.25Z" />
    <path d="m7.25 10 1.9 1.9 3.6-3.8" />
  </Svg>
);

export const IconList = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9" />
    <circle cx="4" cy="5.5" r=".6" fill="currentColor" />
    <circle cx="4" cy="10" r=".6" fill="currentColor" />
    <circle cx="4" cy="14.5" r=".6" fill="currentColor" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 6h7M14.5 6h2M3.5 14h2M9.5 14h7" />
    <circle cx="12.5" cy="6" r="2" />
    <circle cx="7.5" cy="14" r="2" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Svg>
);

export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3.25 17.5 16.5h-15L10 3.25Z" />
    <path d="M10 8.25v3.5M10 14.1v.01" />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M10 9v4.5M10 6.4v.01" />
  </Svg>
);

export const IconSparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 2.75c.5 3.4 2 5 5.25 5.5-3.25.5-4.75 2.1-5.25 5.5-.5-3.4-2-5-5.25-5.5C8 7.75 9.5 6.15 10 2.75Z" />
    <path d="M15.5 13.25c.2 1.35.8 1.95 2 2.15-1.2.2-1.8.8-2 2.1-.2-1.3-.8-1.9-2-2.1 1.2-.2 1.8-.8 2-2.15Z" />
  </Svg>
);

export const IconCard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.75" y="4.75" width="14.5" height="10.5" rx="1.75" />
    <path d="M2.75 8.25h14.5M5.75 12.25h3" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6.75" y="6.75" width="9.5" height="9.5" rx="1.5" />
    <path d="M13.25 6.75V5.25a1.5 1.5 0 0 0-1.5-1.5h-6.5a1.5 1.5 0 0 0-1.5 1.5v6.5a1.5 1.5 0 0 0 1.5 1.5h1.5" />
  </Svg>
);

export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11.5 3.75h4.75V8.5M16 4l-7 7" />
    <path d="M14.25 11.5v3.25a1.5 1.5 0 0 1-1.5 1.5h-7.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5H8.5" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16.25 10a6.25 6.25 0 1 1-1.85-4.45" />
    <path d="M16.25 3.5v3.25H13" />
  </Svg>
);

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 4.5v11l9-5.5-9-5.5Z" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.25" y="8.75" width="11.5" height="8" rx="1.5" />
    <path d="M6.75 8.75V6.5a3.25 3.25 0 0 1 6.5 0v2.25" />
  </Svg>
);

export const IconScale = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3v14M6 17h8M4 6.5h12" />
    <path d="m4 6.5-2 5a2.5 2.5 0 0 0 4 0l-2-5ZM16 6.5l-2 5a2.5 2.5 0 0 0 4 0l-2-5Z" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12" />
  </Svg>
);

export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
  </Svg>
);

export const IconCoffee = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.75 8h10v4.5a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V8Z" />
    <path d="M13.75 9h1a2 2 0 0 1 0 4h-1.1M6.5 2.75c-.5.75.5 1.5 0 2.5M9.5 2.75c-.5.75.5 1.5 0 2.5" />
  </Svg>
);

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="3.25" />
    <path d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.25 1.25M14.05 14.05l1.25 1.25M4.7 15.3l1.25-1.25M14.05 5.95l1.25-1.25" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16.25 12.1A6.75 6.75 0 0 1 7.9 3.75a6.75 6.75 0 1 0 8.35 8.35Z" />
  </Svg>
);

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.25 8.25a4.75 4.75 0 0 1 9.5 0c0 3.75 1.5 5 1.5 5H3.75s1.5-1.25 1.5-5Z" />
    <path d="M8.5 15.75a1.6 1.6 0 0 0 3 0" />
  </Svg>
);

/** RelayPay mark: three stacked bars on a safety-orange tile (same as the landing page). */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="5" fill="var(--brand-solid)" />
      <rect x="5" y="5.5" width="14" height="3.4" rx="1.7" fill="var(--on-brand)" />
      <rect x="5" y="10.3" width="10" height="3.4" rx="1.7" fill="var(--on-brand)" />
      <rect x="5" y="15.1" width="6" height="3.4" rx="1.7" fill="var(--on-brand)" />
    </svg>
  );
}
