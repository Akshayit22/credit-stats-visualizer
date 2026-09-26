import type { Account } from '../entities/account.js';
import type { Period } from '../entities/common.js';
import type { CategoryRule } from '../entities/category-rule.js';
import type { Statement } from '../entities/statement.js';
import type { Summary } from '../entities/summary.js';
import type { Transaction } from '../entities/transaction.js';
import type { UserProfile } from '../entities/user.js';
import type { PeriodWindow } from '../period-window.js';

/**
 * The response bodies, one per endpoint. The dashboards each get a single
 * "view" that carries everything the screen draws, so a screen is one request
 * rather than a waterfall of them.
 */

/* ── auth ─────────────────────────────────────────────────────────────────── */

/** `GET /api/auth/config` — what the sign-in page may offer. Public. */
export interface AuthConfig {
  /** Null when Google sign-in is not configured on the server. */
  googleClientId: string | null;
  /** True only outside production, and only when explicitly switched on. */
  devLoginEnabled: boolean;
}

/** The signed-in person, as the browser sees them. */
export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string;
  /** True for the owner's accounts; shows the admin overview. */
  isAdmin?: boolean;
}

/* ── statements ───────────────────────────────────────────────────────────── */

export interface ParseWarning {
  code: string;
  message: string;
}

/** `POST /api/statements` — 201 when new, 200 when it was already uploaded. */
export interface ParsedStatementResult {
  statement: Statement;
  account: Account;
  transactions: Transaction[];
  warnings: ParseWarning[];
  duplicate: boolean;
}

/** `GET /api/statements` */
export interface StatementLibrary {
  statements: Statement[];
  accounts: Account[];
}

/** `GET /api/statements/:statementId` */
export interface StatementDetail {
  statement: Statement;
  transactions: Transaction[];
}

/** `DELETE /api/statements/:statementId` */
export interface StatementDeleted {
  deleted: true;
  rowsRemoved: number;
}

/* ── views ────────────────────────────────────────────────────────────────── */

/** `GET /api/workspace` — the sidebar and every screen's frame. */
export interface WorkspaceView {
  accounts: Account[];
  /** Newest upload first. */
  statements: Statement[];
  /** Months with at least one statement, oldest first. */
  periods: Period[];
  needsReview: Statement[];
}

/**
 * One month on the Overview. Card figures are kept apart from the rest:
 * cashback and fees only exist on a credit card, so a month with only a savings
 * statement must not read as "the card earned nothing".
 */
export interface OverviewMonth {
  period: Period;
  /** Every account: what left the account or was charged to the card. */
  spendMinor: number;
  incomeMinor: number;
  paymentsMinor: number;
  /** Credit cards only. */
  cardSpendMinor: number;
  cashbackMinor: number;
  feesMinor: number;
  hasAnyStatement: boolean;
  hasCardStatement: boolean;
}

/** `GET /api/views/overview` */
export interface OverviewView {
  accounts: Account[];
  statements: Statement[];
  needsReview: Statement[];
  months: OverviewMonth[];
  window: PeriodWindow;
}

/**
 * `GET /api/views/card/:accountId`, `/savings/:accountId`, `/cashback/:accountId`.
 *
 * `transactions` are the selected **statement's** rows, not the calendar
 * month's: a card cycle running 17 May – 15 Jun has four rows dated in May.
 */
export interface AccountView {
  account: Account;
  statement: Statement | null;
  statements: Statement[];
  transactions: Transaction[];
  summaries: Summary[];
  window: PeriodWindow;
  periodsWithData: Period[];
}

/* ── settings and profile ─────────────────────────────────────────────────── */

/** Which AI provider the server uses. Read-only, and never the key itself. */
export interface ProviderInfo {
  id: string;
  modelId: string;
  configured: boolean;
  /** Environment variables that are missing, when it is not configured. */
  missing: string[];
  note: string;
}

/** `GET /api/settings` */
export interface SettingsView {
  email: string;
  currency: string;
  locale: string;
  statementCount: number;
  accountCount: number;
  provider: ProviderInfo;
}

/** `GET /api/profile/export` — everything held about the user. */
export interface ProfileExport {
  exportedAt: string;
  note: string;
  profile: UserProfile | null;
  accounts: Account[];
  statements: Statement[];
  transactions: Transaction[];
  summaries: Summary[];
  categoryRules: Array<Pick<CategoryRule, 'merchant' | 'category'>>;
}

/** `POST /api/profile/delete` — how many documents went, per collection. */
export interface ProfileDeleted {
  deleted: {
    summaries: number;
    transactions: number;
    statements: number;
    accounts: number;
    categoryRules: number;
    profile: number;
  };
}

/** `GET /api/health` */
export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'ok' | 'unreachable';
  llmProvider: string;
}

/* ── admin ────────────────────────────────────────────────────────────────── */

/** One bank a user has uploaded statements for, and how many. */
export interface AdminBankCount {
  issuer: string;
  accountType: 'credit_card' | 'savings';
  statements: number;
}

/** One person, as the admin overview shows them. Counts only — no figures. */
export interface AdminUserSummary {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  lastLoginAt: string;
  statements: number;
  /** Newest upload, or null when they have not uploaded anything. */
  lastUploadAt: string | null;
  banks: AdminBankCount[];
}

/** `GET /api/admin/overview` — admins only. */
export interface AdminOverview {
  generatedAt: string;
  totals: { users: number; statements: number; accounts: number };
  /** Most recently signed in first. */
  users: AdminUserSummary[];
}
