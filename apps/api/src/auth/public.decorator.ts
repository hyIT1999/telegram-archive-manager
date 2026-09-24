import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_ROUTE = 'tam:public-route';

/** Opts a controller or handler out of the global SessionGuard. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_ROUTE, true);
