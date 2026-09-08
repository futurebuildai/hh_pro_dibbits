import { dealerConfig } from '@core/config/runtime';
import { cn } from '@ui/lib/cn';
import { type ReactElement, useState } from 'react';
import { DealerMark } from './DealerMark';

/**
 * The resolver: what identity does THIS deployment show, and how.
 *
 * Two sources, in order:
 *
 * 1. `branding.logoUrl` — the dealer uploaded their own mark in the admin
 *    console. Rendered as an `<img>` in a fixed-height box with
 *    `object-contain`, because a dealer's file is whatever aspect ratio they
 *    had and the row it sits in has one height.
 * 2. Nothing set — `DealerMark`. `DEFAULT_CONFIG` deliberately carries no
 *    `logoUrl` (see `docs/brand-tokens.md`), so the built-in mark is the
 *    NORMAL path, not a fallback for a broken deployment.
 *
 * If the dealer's image fails to load we hide it and let the text name stand.
 * We do NOT fall back to the built-in mark: painting our own diamond next to
 * another company's name is a worse failure than an empty box, because it
 * looks deliberate.
 *
 * `logoDarkUrl` is not consulted here on purpose. Choosing between two files
 * means observing `data-theme` on `<html>`, which React cannot do (see
 * `DealerMark`'s note); swapping a dealer's dark file needs a CSS-level rule in
 * the identity layer, not an `if` in this component.
 *
 * THE WORDMARK IS LIVE TEXT, NEVER AN IMAGE OF A WORD.
 * `variant="lockup"` sets the company name in the display face. An image of a
 * baked-in word would re-hardcode the very name that `supplierName()` exists
 * to remove, and it would be wrong on every deployment but one.
 */

const DEFAULT_SIZE = 28;

/**
 * The brand's clear space is the diamond's height: `15 x sqrt(2)` of 64 units,
 * about 33% of the rendered size. In a lockup that is the gap between mark and
 * wordmark, so it is computed rather than guessed.
 */
const CLEAR_SPACE_RATIO = 0.33;
/** Wordmark cap height against the mark's edge length, from the brand kit. */
const WORDMARK_RATIO = 0.62;

export interface DealerLogoProps {
  /** `mark` is the badge alone; `lockup` is the badge plus the company name. */
  variant: 'mark' | 'lockup';
  /** Height of the mark (and of the dealer image box) in px. Default 28. */
  size?: number | undefined;
  /** Passed through to `DealerMark`; ignored when the dealer supplied a file. */
  tone?: 'auto' | 'mono' | 'reverse' | undefined;
  /** Layout is the caller's. This is the hook for it. */
  className?: string | undefined;
}

export function DealerLogo({ variant, size, tone, className }: DealerLogoProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const { branding } = dealerConfig();
  const px = size ?? DEFAULT_SIZE;
  const name = branding.companyName;
  const isLockup = variant === 'lockup';

  // The badge carries the accessible name only when it stands alone. In a
  // lockup the name is already on screen as text, and labelling both would
  // announce the company twice — the same "never both" rule DealerMark keeps.
  let badge: ReactElement | null;
  if (!branding.logoUrl) {
    badge = (
      <DealerMark size={px} {...(tone ? { tone } : {})} {...(isLockup ? {} : { label: name })} />
    );
  } else if (imageFailed) {
    // The dealer's file is broken. Show nothing rather than our own mark:
    // our diamond beside another company's name looks deliberate, and wrong.
    badge = null;
  } else {
    badge = (
      <span className="inline-flex shrink-0 items-center" style={{ height: px }}>
        <img
          src={branding.logoUrl}
          alt={isLockup ? '' : name}
          onError={() => setImageFailed(true)}
          className="h-full w-auto max-w-[10rem] object-contain"
        />
      </span>
    );
  }

  if (!isLockup) {
    return className ? <span className={className}>{badge}</span> : badge;
  }

  return (
    <span
      className={cn('inline-flex items-center', className)}
      style={{ gap: Math.round(px * CLEAR_SPACE_RATIO) }}
    >
      {badge}
      <span
        className="font-display font-extrabold uppercase leading-none tracking-[-0.0095em]"
        style={{ fontSize: Math.round(px * WORDMARK_RATIO) }}
      >
        {name}
      </span>
    </span>
  );
}
