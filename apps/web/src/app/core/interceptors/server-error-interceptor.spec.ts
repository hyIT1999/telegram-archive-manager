import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  type TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { failNetwork, flushError } from '../../../testing/fixtures';
import { NETWORK_ERROR_MESSAGE, SERVER_ERROR_MESSAGE } from '../../shared/models';
import { NotifyService } from '../services/notify-service';
import { serverErrorInterceptor } from './server-error-interceptor';

describe('serverErrorInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  const notify = { error: vi.fn(), success: vi.fn(), info: vi.fn() };

  beforeEach(() => {
    notify.error.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([serverErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: NotifyService, useValue: notify },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  });

  afterEach(() => http.verify());

  async function failWith(respond: (request: TestRequest) => void): Promise<void> {
    const result = firstValueFrom(client.get('/api/stats'));
    respond(http.expectOne('/api/stats'));
    await expect(result).rejects.toBeDefined();
  }

  it('toasts a generic message for server errors', async () => {
    await failWith((request) => flushError(request, 500, 'Internal server error'));
    expect(notify.error).toHaveBeenCalledExactlyOnceWith(SERVER_ERROR_MESSAGE);
  });

  it('toasts the API message for deliberate, coded server errors', async () => {
    await failWith((request) =>
      flushError(request, 503, 'The worker is not running.', 'WORKER_UNAVAILABLE'),
    );
    expect(notify.error).toHaveBeenCalledExactlyOnceWith('The worker is not running.');
  });

  it('toasts when the server cannot be reached', async () => {
    await failWith((request) => failNetwork(request));
    expect(notify.error).toHaveBeenCalledExactlyOnceWith(NETWORK_ERROR_MESSAGE);
  });

  it.each([400, 401, 404, 409, 422])('leaves %i responses to the page', async (status) => {
    await failWith((request) => flushError(request, status, 'Nope'));
    expect(notify.error).not.toHaveBeenCalled();
  });
});
