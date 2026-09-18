'use client';

import {
  ArrowLineLeft,
  ArrowLineRight,
  ArrowRight,
  Bank,
  CalendarX,
  Check,
  CreditCard,
  FilePdf,
  Files,
  Gear,
  GoogleLogo,
  Minus,
  Percent,
  Plus,
  SignOut,
  SquaresFour,
  TrendDown,
  TrendUp,
  UploadSimple,
  Warning,
  X,
} from '@phosphor-icons/react/dist/ssr';

/**
 * The Phosphor icons this app uses, named once so screens never reach into the
 * icon package directly. Every icon inherits `currentColor`.
 */
export const Icon = {
  ArrowLineLeft,
  ArrowLineRight,
  ArrowRight,
  Bank,
  CalendarX,
  Check,
  CreditCard,
  FilePdf,
  Files,
  Gear,
  GoogleLogo,
  Minus,
  Percent,
  Plus,
  SignOut,
  SquaresFour,
  TrendDown,
  TrendUp,
  UploadSimple,
  Warning,
  X,
} as const;

export type IconName = keyof typeof Icon;
