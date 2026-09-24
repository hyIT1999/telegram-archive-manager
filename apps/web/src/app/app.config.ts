import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withNavigationErrorHandler,
} from '@angular/router';
import { routes } from './app.routes';
import { serverErrorInterceptor } from './core/interceptors/server-error-interceptor';
import { unauthorizedInterceptor } from './core/interceptors/unauthorized-interceptor';
import { handleNavigationError } from './core/services/navigation-error-handler';
import { PageTitleStrategy } from './core/services/page-title-strategy';
import { ThemeService } from './core/services/theme-service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      withNavigationErrorHandler(handleNavigationError),
    ),
    // Same-origin /api calls carry the session cookie; no CORS, no withCredentials needed.
    provideHttpClient(withInterceptors([unauthorizedInterceptor, serverErrorInterceptor])),
    { provide: TitleStrategy, useClass: PageTitleStrategy },
    { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-outlined' } },
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', subscriptSizing: 'dynamic' },
    },
    // Start the theme service at boot so 'system' mode tracks OS changes on every page.
    provideAppInitializer(() => {
      inject(ThemeService);
    }),
  ],
};
