import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Channel, PrismaClient } from '@tam/database';
import type { ImportJobDto } from '@tam/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_EVENTS_SETTINGS,
  LIVE_EVENTS_SETTINGS,
  type LiveEventsSettings,
} from '../../src/events/live-events-settings.js';
import { createTestPrisma, insertUser, resetDatabase } from './support/database.js';
import { nextClientIp, sessionCookie } from './support/http.js';
import { type EventStream, eventOf, openEventStream } from './support/sse.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'watcher@example.test';
const PASSWORD = 'correct horse battery staple';

/** Short intervals, so heartbeats and session checks happen within a test. */
const SETTINGS: LiveEventsSettings = {
  ...DEFAULT_LIVE_EVENTS_SETTINGS,
  batchMs: 50,
  maxJobsPerBatch: 3,
  heartbeatMs: 200,
  sessionCheckMs: 200,
};

describe('live updates (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let baseUrl: string;
  let cookie: string;
  const streams: EventStream[] = [];

  const http = () => request(app.getHttpServer());

  async function login(): Promise<string> {
    const response = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    return sessionCookie(response);
  }

  async function open(session: string | null = cookie) {
    const opened = await openEventStream(`${baseUrl}/api/events`, {
      'x-forwarded-for': nextClientIp(),
      ...(session === null ? {} : { cookie: session }),
    });
    if (opened.stream) {
      streams.push(opened.stream);
    }
    return opened;
  }

  /** An open stream that received `ready`. */
  async function watch(session: string = cookie): Promise<EventStream> {
    const { stream } = await open(session);
    if (!stream) {
      throw new Error('The stream did not open');
    }
    await stream.next(eventOf('ready'));
    return stream;
  }

  let chatSequence = 0;
  function addChannel(data: Partial<Channel> = {}): Promise<Channel> {
    chatSequence += 1;
    return prisma.channel.create({
      data: {
        telegramChatId: BigInt(-1_005_000_000_000 - chatSequence),
        title: `Lessons ${chatSequence}`,
        type: 'CHANNEL',
        ...data,
      },
    });
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    await insertUser(prisma, EMAIL, PASSWORD);
    app = await createTestApp((builder) =>
      builder.overrideProvider(LIVE_EVENTS_SETTINGS).useValue(SETTINGS),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    cookie = await login();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE channels, messages, media, import_jobs, download_jobs CASCADE`;
  });

  afterEach(() => {
    for (const stream of streams.splice(0)) {
      stream.close();
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('needs a session', async () => {
    const refused = await open(null);
    expect(refused.status).toBe(401);
    expect(refused.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('opens with ready and the reconnect delay, and pings to keep the connection alive', async () => {
    const stream = await watch();
    expect(stream.messages[0]).toMatchObject({ data: { type: 'ready' }, retry: 5_000 });
    await stream.next(eventOf('ping'));
  });

  it('sends each import job as the api returns it, after every committed change', async () => {
    const stream = await watch();
    const channel = await addChannel({ title: 'Physics' });
    const job = await prisma.importJob.create({ data: { channelId: channel.id, runSeq: 1 } });

    const created = await stream.next(eventOf('import.job'));
    expect((created.data as { job: ImportJobDto }).job).toMatchObject({
      id: job.id,
      channel: { id: channel.id, title: 'Physics' },
      type: 'IMPORT',
      status: 'PENDING',
      activeFiles: [],
    });

    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'RUNNING', processedMessages: 100, totalMessages: 400 },
    });
    const progress = await stream.next(
      eventOf('import.job', (data) => (data.job as ImportJobDto).processedMessages === 100),
    );
    expect((progress.data as { job: ImportJobDto }).job).toMatchObject({
      status: 'RUNNING',
      totalMessages: 400,
    });
  });

  it('hints at changed channels and downloads, for the old group’s supergroup too', async () => {
    const stream = await watch();
    const supergroup = await addChannel({ type: 'SUPERGROUP' });
    const oldGroup = await addChannel({ type: 'GROUP', migratedToChannelId: supergroup.id });

    await prisma.channel.update({ where: { id: supergroup.id }, data: { headMessageId: 10 } });
    await stream.next(eventOf('channel.changed', (data) => data.channelId === supergroup.id));

    const message = await prisma.message.create({
      data: {
        channelId: oldGroup.id,
        telegramMessageId: 1,
        type: 'PHOTO',
        telegramDate: new Date(),
      },
    });
    const media = await prisma.media.create({
      data: {
        messageId: message.id,
        telegramFileId: 'f',
        telegramFileUniqueId: 'u',
        type: 'PHOTO',
      },
    });
    await prisma.downloadJob.create({ data: { mediaId: media.id } });
    await stream.next(eventOf('downloads.changed', (data) => data.channelId === oldGroup.id));
    await stream.next(eventOf('downloads.changed', (data) => data.channelId === supergroup.id));
  });

  it('asks to read everything again when too much changed at once', async () => {
    const stream = await watch();
    const channels = await Promise.all([1, 2, 3, 4].map(() => addChannel()));
    await prisma.importJob.createMany({
      data: channels.map((channel) => ({ channelId: channel.id })),
    });
    await stream.next(eventOf('resync'));
    expect(stream.messages.filter(eventOf('import.job'))).toEqual([]);
  });

  it('asks to read everything again after losing the database notifications', async () => {
    const stream = await watch();
    await prisma.$queryRaw`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'tam-api-live'`;
    await stream.next(eventOf('resync'), 10_000);

    // And listens again.
    const channel = await addChannel();
    await prisma.channel.update({ where: { id: channel.id }, data: { headMessageId: 1 } });
    await stream.next(eventOf('channel.changed', (data) => data.channelId === channel.id));
  });

  it('ends the stream once its session is gone', async () => {
    const other = await login();
    const stream = await watch(other);
    await http().post('/api/auth/logout').set('Cookie', other).expect(204);

    await stream.next(eventOf('session.ended'));
    await stream.ended;
    expect(stream.messages.at(-1)).toMatchObject({ data: { type: 'session.ended' } });
    // The other session is untouched.
    await watch();
  });
});
