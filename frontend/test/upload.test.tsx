import { createHash } from 'node:crypto';
import type { ParsedStatementResult, Statement } from '@cred-stats/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadDialog } from '../src/components/upload-dialog';
import { SectionPage } from '../src/pages/section-page';
import type * as PdfText from '../src/utils/pdf-text';
import { PdfPasswordRequiredError } from '../src/utils/pdf-text';
import { prepareUpload } from '../src/utils/upload';
import { mockApi, renderRoutes, renderWithProviders } from './helpers/render';

/**
 * pdf.js needs a real browser to run its worker, so extraction is replaced by
 * what it would have produced; everything after it — normalising, redacting,
 * hashing, posting — is the real code.
 */
const extractPdfPages = vi.hoisted(() => vi.fn());
vi.mock('../src/utils/pdf-text', async (importOriginal) => ({
  ...(await importOriginal<typeof PdfText>()),
  extractPdfPages,
}));

const STATEMENT_PAGES = {
  pageCount: 1,
  pages: [
    {
      pageNumber: 1,
      lines: [
        'AXIS BANK SUPERMONEY RuPay Credit Card',
        'PRIYA RAMACHANDRAN NAIR',
        '14, SECOND CROSS, INDIRANAGAR,',
        'Email\tpriya.nair@example.com',
        'DATE\tDETAILS\tAMOUNT',
        '25/05/2026\tUPI/SWIGGY/swiggy@icici\t400.00 Dr',
      ],
    },
  ],
};

function pdfFile(): File {
  return new File(['%PDF-1.7 fake bytes'], 'statement.pdf', { type: 'application/pdf' });
}

beforeEach(() => {
  extractPdfPages.mockReset();
});

describe('preparing an upload in the browser', () => {
  it('sends redacted text and its hash — never the password or the bytes', async () => {
    extractPdfPages.mockResolvedValue(STATEMENT_PAGES);

    const { payload, redacted } = await prepareUpload(pdfFile(), 'hunter2-pdf-password');
    const body = JSON.stringify(payload);

    expect(Object.keys(payload).sort()).toEqual(['contentHash', 'meta', 'text']);
    expect(body).not.toContain('hunter2-pdf-password');
    expect(body).not.toContain('%PDF');
    expect(body).not.toContain('PRIYA');
    expect(body).not.toContain('priya.nair@example.com');
    expect(payload.text).toContain('SWIGGY');
    expect(payload.contentHash).toBe(createHash('sha256').update(payload.text).digest('hex'));
    expect(redacted.holderName).toBeGreaterThan(0);
  });

  it('refuses a PDF with no readable text, such as a scan', async () => {
    extractPdfPages.mockResolvedValue({ pageCount: 1, pages: [{ pageNumber: 1, lines: [] }] });
    await expect(prepareUpload(pdfFile())).rejects.toThrow(/Scanned or photographed/);
  });
});

describe('the upload dialog', () => {
  const statement = {
    statementId: 'axis-bank-credit-card-9581_2026-06',
    accountType: 'credit_card',
    periodStart: '2026-05-17',
    periodEnd: '2026-06-15',
    rowCount: 1,
    parser: 'deterministic:axis-supermoney-card',
    reconciliation: { ok: true, message: 'Everything adds up.' },
    card: { totalDueMinor: 19_392_38 },
  } as unknown as Statement;

  const result: ParsedStatementResult = {
    statement,
    account: { displayName: 'Axis Bank · Supermoney' } as ParsedStatementResult['account'],
    transactions: [],
    warnings: [],
    duplicate: false,
  };

  it('parses, posts the text, and shows what reconciled', async () => {
    extractPdfPages.mockResolvedValue(STATEMENT_PAGES);
    const fetchSpy = mockApi({
      'POST /api/statements': () => ({ status: 201, body: { data: result } }),
    });

    renderWithProviders(<UploadDialog open onClose={() => {}} />);
    await userEvent.upload(screen.getByTestId('statement-file'), pdfFile());
    await userEvent.click(screen.getByRole('button', { name: 'Parse' }));

    expect(await screen.findByText(/Totals reconciled/)).toBeInTheDocument();
    expect(screen.getByText('₹19,392.38')).toBeInTheDocument();

    const posted = fetchSpy.mock.calls.find(([url]) => String(url) === '/api/statements');
    expect(JSON.parse(String(posted?.[1]?.body))).toHaveProperty('contentHash');
  });

  it('asks for the password when the PDF is locked', async () => {
    extractPdfPages.mockRejectedValue(new PdfPasswordRequiredError(false));
    renderWithProviders(<UploadDialog open onClose={() => {}} />);

    await userEvent.upload(screen.getByTestId('statement-file'), pdfFile());
    await userEvent.click(screen.getByRole('button', { name: 'Parse' }));

    expect(await screen.findByText('This PDF needs a password.')).toBeInTheDocument();
    expect(screen.getByText(/this file needs one/)).toBeInTheDocument();
  });

  it('shows the API’s own explanation when a statement cannot be read', async () => {
    extractPdfPages.mockResolvedValue(STATEMENT_PAGES);
    mockApi({
      'POST /api/statements': () => ({
        status: 400,
        body: {
          error: { code: 'bad_request', message: 'No built-in parser covers this statement.' },
        },
      }),
    });
    renderWithProviders(<UploadDialog open onClose={() => {}} />);

    await userEvent.upload(screen.getByTestId('statement-file'), pdfFile());
    await userEvent.click(screen.getByRole('button', { name: 'Parse' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No built-in parser covers');
  });
});

describe('the section links', () => {
  it('say plainly that there is no card yet, and offer savings instead', async () => {
    mockApi({
      'GET /api/views/workspace': {
        accounts: [{ accountId: 'slice-savings-6993', type: 'savings' }],
        statements: [],
        periods: [],
        needsReview: [],
      },
    });
    renderRoutes([{ path: '/accounts', element: <SectionPage section="card" /> }], '/accounts');

    expect(await screen.findByText('No card statements yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open savings instead' })).toHaveAttribute(
      'href',
      '/savings/slice-savings-6993',
    );
  });

  it('go straight to the newest statement of the first card', async () => {
    mockApi({
      'GET /api/views/workspace': {
        accounts: [{ accountId: 'axis-card-9581', type: 'credit_card' }],
        statements: [{ accountId: 'axis-card-9581', period: '2026-06' }],
        periods: ['2026-06'],
        needsReview: [],
      },
    });
    renderRoutes(
      [
        { path: '/accounts', element: <SectionPage section="card" /> },
        { path: '/accounts/:accountId', element: <p>card screen</p> },
      ],
      '/accounts',
    );
    await waitFor(() => expect(screen.getByText('card screen')).toBeInTheDocument());
  });
});
