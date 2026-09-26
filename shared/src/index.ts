/**
 * @cred-stats/shared — the code both the backend and the frontend run.
 *
 * Types and schemas for every stored entity and every API payload, money,
 * categories, period arithmetic, the canonical statement-text format and the
 * redaction rules. Nothing in here may touch Node, the DOM or the network.
 */
export * from './entities/index.js';
export * from './api/index.js';
export * from './categories.js';
export * from './money.js';
export * from './periods.js';
export * from './period-window.js';
export * from './format.js';
export * from './sections.js';
export * from './statement-text.js';
export * from './pdf-layout.js';
export * from './redact.js';
