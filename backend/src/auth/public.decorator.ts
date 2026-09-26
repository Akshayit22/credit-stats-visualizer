import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'cred-stats:is-public';

/**
 * Opts a route out of the session check. Everything else requires a signed-in
 * user by default — a new route is private unless someone decides otherwise.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
