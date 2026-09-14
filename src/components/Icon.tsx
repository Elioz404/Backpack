/**
 * A small drawn set, stroked like a ballpoint rather than filled like a UI kit.
 * No emoji anywhere in the product: emoji render differently on every platform
 * and read as decoration, and every mark here means something.
 */
export type IconName =
  | "backpack"
  | "mail"
  | "site"
  | "plus"
  | "check"
  | "hand"
  | "undo"
  | "close"
  | "chevron"
  | "quote"
  | "ask"
  | "reading"
  | "dismiss"
  | "copy";

const PATHS: Record<IconName, React.ReactNode> = {
  backpack: (
    <>
      <path d="M4 9.5a6 6 0 0 1 12 0V17a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 17Z" />
      <path d="M7.5 9.5V6a2.5 2.5 0 0 1 5 0v3.5" />
      <path d="M6.75 13.75h6.5" />
    </>
  ),
  mail: (
    <>
      <rect x="2.75" y="4.75" width="14.5" height="10.5" rx="1.5" />
      <path d="m3.5 6 6.5 4.75L16.5 6" />
    </>
  ),
  site: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M2.9 10h14.2M10 2.75c1.9 2 2.9 4.6 2.9 7.25s-1 5.2-2.9 7.25c-1.9-2-2.9-4.6-2.9-7.25S8.1 4.75 10 2.75Z" />
    </>
  ),
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  check: <path d="m4.5 10.5 3.6 3.5L15.5 6.5" />,
  hand: (
    <>
      <path d="M7 9V5.4a1.4 1.4 0 0 1 2.8 0V9m0-.6V4.4a1.4 1.4 0 0 1 2.8 0V9" />
      <path d="M12.6 9V6.4a1.4 1.4 0 0 1 2.8 0v5.3c0 3.2-2 5.3-4.9 5.3-2.6 0-4-1.2-5.3-3.4l-1.4-2.4a1.4 1.4 0 0 1 2.3-1.5L7 11" />
    </>
  ),
  undo: <path d="M5 8.5h7.5a3.5 3.5 0 1 1 0 7H9M5 8.5 7.75 5.5M5 8.5l2.75 3" />,
  close: <path d="m5.5 5.5 9 9m0-9-9 9" />,
  chevron: <path d="m7.5 5.5 5 4.5-5 4.5" />,
  quote: (
    <>
      <path d="M4.5 5.5h11M4.5 9h11M4.5 12.5h7" />
    </>
  ),
  ask: (
    <>
      <path d="M10 13.5v.01" />
      <path d="M10 11.2c0-1.8 2.2-1.9 2.2-3.7a2.2 2.2 0 0 0-4.4-.2" />
      <circle cx="10" cy="10" r="7.25" />
    </>
  ),
  reading: (
    <>
      <path d="M2.75 5.25c2.4-1 4.6-1 6.5.4v9.1c-1.9-1.4-4.1-1.4-6.5-.4Z" />
      <path d="M17.25 5.25c-2.4-1-4.6-1-6.5.4v9.1c1.9-1.4 4.1-1.4 6.5-.4Z" />
    </>
  ),
  dismiss: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="m6.8 6.8 6.4 6.4" />
    </>
  ),
  copy: (
    <>
      <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" />
      <path d="M13 4.5H5a1.5 1.5 0 0 0-1.5 1.5v8" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.5,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
