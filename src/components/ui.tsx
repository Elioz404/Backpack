import { useId, type ReactNode } from "react";

/**
 * The handful of primitives the app is built from.
 *
 * Deliberately few and deliberately plain: this is a paper surface, so the
 * controls are pressed into it rather than floating above it — square-ish
 * corners, hairline borders, no shadows on anything smaller than a sheet.
 */

type ButtonTone = "primary" | "quiet" | "ghost" | "danger";

const TONES: Record<ButtonTone, string> = {
  primary:
    "bg-ballpoint text-sheet border-ballpoint hover:brightness-110 active:brightness-95",
  quiet:
    "bg-sheet text-ink border-rule-strong hover:bg-sheet-sunk active:bg-sheet-sunk",
  ghost:
    "bg-transparent text-ink-soft border-transparent hover:text-ink hover:bg-sheet-sunk",
  danger:
    "bg-transparent text-overdue border-transparent hover:bg-overdue-soft",
};

export function Button({
  tone = "quiet",
  size = "md",
  icon,
  children,
  ...rest
}: {
  tone?: ButtonTone;
  size?: "sm" | "md";
  icon?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={[
        "focus-ring inline-flex items-center justify-center gap-1.5 border font-medium",
        "rounded-[3px] transition-[background-color,color,filter] duration-100",
        "disabled:opacity-45 disabled:pointer-events-none",
        size === "sm" ? "h-7 px-2 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]",
        TONES[tone],
        rest.className ?? "",
      ].join(" ")}
    >
      {icon}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-[12.5px] text-overdue">{error}</p>
      ) : hint ? (
        <p className="text-[12.5px] text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A ruled input: underline rather than a box, so a form reads like something
 * filled in on paper.
 */
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "focus-ring w-full bg-transparent px-0.5 py-1.5 text-[14.5px] text-ink",
        "border-0 border-b border-rule-strong",
        "placeholder:text-ink-faint focus:border-ballpoint",
        "transition-colors outline-none",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    // React 19 passes `ref` as an ordinary prop to function components, so it
    // only needs declaring — no `forwardRef` wrapper.
    ref?: React.Ref<HTMLTextAreaElement>;
  },
) {
  return (
    <textarea
      {...props}
      className={[
        "focus-ring w-full resize-none bg-sheet-sunk px-2.5 py-2 text-[14px] text-ink",
        "border border-rule-strong rounded-[3px]",
        "placeholder:text-ink-faint focus:border-ballpoint outline-none",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

/** A small tinted marker — a child's name, a count, a status. */
export function Chip({
  color,
  children,
  title,
}: {
  color?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 text-[11.5px] leading-none text-ink-soft"
    >
      {color ? (
        <span
          aria-hidden="true"
          className="h-[7px] w-[7px] rounded-full"
          style={{ background: color }}
        />
      ) : null}
      {children}
    </span>
  );
}

/** A hairline with a label sitting on it, used to open a section. */
export function RuledHeading({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="label whitespace-nowrap">{children}</span>
      <span className="h-px flex-1 bg-rule" aria-hidden="true" />
      {trailing ? <span className="label">{trailing}</span> : null}
    </div>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle
        cx="10"
        cy="10"
        r="7"
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity="0.25"
      />
      <path
        d="M17 10a7 7 0 0 0-7-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
