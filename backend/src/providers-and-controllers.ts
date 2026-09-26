import type { Provider, Type } from '@nestjs/common';
import { AuthController } from './controllers/auth.controller.js';
import { DataController } from './controllers/data.controller.js';
import { HealthController } from './controllers/health.controller.js';
import { ProfileController } from './controllers/profile.controller.js';
import { StatementsController } from './controllers/statements.controller.js';
import { ViewsController } from './controllers/views.controller.js';
import { GoogleAuthClientManager } from './managers/google-auth-client.manager.js';
import { LlmClientManager } from './managers/llm-client.manager.js';
import { MongoClientManager } from './managers/mongo-client.manager.js';
import { AccountsRepository } from './repositories/accounts.repository.js';
import { CategoryRulesRepository } from './repositories/category-rules.repository.js';
import { StatementsRepository } from './repositories/statements.repository.js';
import { SummariesRepository } from './repositories/summaries.repository.js';
import { TransactionsRepository } from './repositories/transactions.repository.js';
import { UsersRepository } from './repositories/users.repository.js';
import { AuthService } from './services/auth.service.js';
import { Environment } from './services/environment.service.js';
import { IngestService } from './services/ingest.service.js';
import { LlmService } from './services/llm.service.js';
import { LogService } from './services/log.service.js';
import { ProfileService } from './services/profile.service.js';
import { SessionService } from './services/session.service.js';
import { StatementsService } from './services/statements.service.js';
import { SummaryService } from './services/summary.service.js';
import { ViewsService } from './services/views.service.js';

/**
 * Every controller and provider in the app, grouped by layer, in one place.
 *
 *   controllers   HTTP in, HTTP out; validate, call a service, return data
 *   services      the business logic; no HTTP, no MongoDB queries
 *   repositories  one per collection; the only code that queries MongoDB
 *   managers      clients for things outside the process (MongoDB, AI APIs)
 *
 * Adding a class means adding it to the right list here — nothing is picked up
 * by scanning, so what the app is made of is readable in one file.
 */

export const Controllers: Type[] = [
  HealthController,
  AuthController,
  StatementsController,
  ViewsController,
  DataController,
  ProfileController,
];

const Managers: Provider[] = [MongoClientManager, LlmClientManager, GoogleAuthClientManager];

export const Repositories: Provider[] = [
  UsersRepository,
  CategoryRulesRepository,
  AccountsRepository,
  StatementsRepository,
  TransactionsRepository,
  SummariesRepository,
];

const Services: Provider[] = [
  Environment,
  LogService,
  LlmService,
  SessionService,
  AuthService,
  SummaryService,
  IngestService,
  StatementsService,
  ViewsService,
  ProfileService,
];

export const Providers: Provider[] = [...Managers, ...Repositories, ...Services];
