import type { Provider, Type } from '@nestjs/common';
import { HealthController } from './controllers/health.controller.js';
import { MongoClientManager } from './managers/mongo-client.manager.js';
import { Environment } from './services/environment.service.js';
import { LogService } from './services/log.service.js';

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

export const Controllers: Type[] = [HealthController];

const Managers: Provider[] = [MongoClientManager];

const Services: Provider[] = [Environment, LogService];

export const Providers: Provider[] = [...Managers, ...Services];
