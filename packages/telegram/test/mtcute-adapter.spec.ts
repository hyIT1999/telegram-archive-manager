import { Long, PeersIndex, tl } from '@mtcute/core';
import { TelegramClient } from '@mtcute/core/client.js';
import { StubTelegramClient, createStub } from '@mtcute/test';
import { describe, expect, it, vi } from 'vitest';
import {
  LoginStepError,
  MtcuteTelegramAdapter,
  NotAForumError,
  type UpdateEvent,
  decodeFileId,
} from '../src/index.js';

const CHANNEL_ID = 1_234_567_890;
const MARKED_CHANNEL_ID = String(-1_000_000_000_000 - CHANNEL_ID);

function setup() {
  const stub = new StubTelegramClient();
  const adapter = new MtcuteTelegramAdapter(new TelegramClient({ client: stub }));
  return { stub, adapter };
}

function rpcError(code: number, message: string): tl.RpcError {
  return tl.RpcError.fromTl({ errorCode: code, errorMessage: message });
}

const channel = createStub('channel', {
  id: CHANNEL_ID,
  title: 'Lessons',
  username: 'lessons',
  broadcast: true,
  accessHash: Long.fromNumber(987_654),
});

function message(id: number, extra: Partial<tl.RawMessage> = {}): tl.RawMessage {
  return createStub('message', {
    id,
    peerId: { _: 'peerChannel', channelId: CHANNEL_ID },
    date: 1_700_000_000 + id,
    message: '',
    ...extra,
  });
}

describe('MtcuteTelegramAdapter — login primitives', () => {
  it('reports the code delivery of sendCode', async () => {
    const { stub, adapter } = setup();
    stub.respondWith('auth.sendCode', () =>
      createStub('auth.sentCode', {
        type: { _: 'auth.sentCodeTypeApp', length: 5 },
        phoneCodeHash: 'hash-1',
        nextType: { _: 'auth.codeTypeSms' },
        timeout: 60,
      }),
    );
    await stub.with(async () => {
      await expect(adapter.sendCode('+84912345678')).resolves.toEqual({
        kind: 'code_sent',
        phoneCodeHash: 'hash-1',
        codeType: 'app',
        nextCodeType: 'sms',
        resendAfterSeconds: 60,
      });
    });
  });

  it('refuses accounts that must set up a login email first', async () => {
    const { stub, adapter } = setup();
    stub.respondWith('auth.sendCode', () =>
      createStub('auth.sentCode', {
        type: { _: 'auth.sentCodeTypeSetUpEmailRequired' },
        phoneCodeHash: 'hash-2',
      }),
    );
    await stub.with(async () => {
      await expect(adapter.sendCode('+84912345678')).rejects.toMatchObject({
        code: 'EMAIL_REQUIRED',
      });
    });
  });

  it('asks for the 2FA password when Telegram requires it', async () => {
    const { stub, adapter } = setup();
    stub.respondWith('auth.signIn', () => {
      throw rpcError(401, 'SESSION_PASSWORD_NEEDED');
    });
    await stub.with(async () => {
      await expect(adapter.signIn('+84912345678', 'hash', '12345')).resolves.toEqual({
        kind: 'password_required',
      });
    });
  });

  it('turns a wrong code into a LoginStepError', async () => {
    const { stub, adapter } = setup();
    stub.respondWith('auth.signIn', () => {
      throw rpcError(400, 'PHONE_CODE_INVALID');
    });
    await stub.with(async () => {
      const failure = adapter.signIn('+84912345678', 'hash', '00000');
      await expect(failure).rejects.toBeInstanceOf(LoginStepError);
      await expect(failure).rejects.toMatchObject({ code: 'PHONE_CODE_INVALID' });
    });
  });

  it('signs in and returns the account', async () => {
    const { stub, adapter } = setup();
    stub.respondWith('auth.signIn', () =>
      createStub('auth.authorization', {
        user: createStub('user', { id: 42, firstName: 'An', username: 'an_user', self: true }),
      }),
    );
    await stub.with(async () => {
      await expect(adapter.signIn('+84912345678', 'hash', '12345')).resolves.toEqual({
        kind: 'authorized',
        user: { id: '42', username: 'an_user', displayName: 'An' },
      });
    });
  });

  it('treats a revoked or missing session as logged out', async () => {
    const { stub, adapter } = setup();
    stub.respondWith('users.getUsers', () => {
      throw rpcError(401, 'AUTH_KEY_UNREGISTERED');
    });
    await stub.with(async () => {
      await expect(adapter.getAuthorizedUser()).resolves.toBeNull();
      await expect(adapter.authenticate()).resolves.toMatchObject({
        state: 'LOGGED_OUT',
        user: null,
      });
    });
  });
});

describe('MtcuteTelegramAdapter — chats', () => {
  it('lists channels, supergroups and basic groups, and skips users', async () => {
    const { stub, adapter } = setup();
    const supergroup = createStub('channel', {
      id: 400,
      title: 'Study group',
      megagroup: true,
      noforwards: true,
      forum: true,
      accessHash: Long.fromNumber(1),
      participantsCount: 1_234,
    });
    const basicGroup = createStub('chat', { id: 200, title: 'Family', participantsCount: 5 });
    const user = createStub('user', { id: 300, firstName: 'Friend' });
    let calls = 0;
    stub.respondWith('messages.getDialogs', () => {
      calls += 1;
      if (calls > 1) {
        return createStub('messages.dialogs', { dialogs: [], chats: [], users: [], messages: [] });
      }
      return createStub('messages.dialogs', {
        dialogs: [
          createStub('dialog', {
            peer: { _: 'peerChannel', channelId: CHANNEL_ID },
            topMessage: 1,
          }),
          createStub('dialog', { peer: { _: 'peerChat', chatId: 200 }, topMessage: 1 }),
          createStub('dialog', { peer: { _: 'peerUser', userId: 300 }, topMessage: 1 }),
          createStub('dialog', { peer: { _: 'peerChannel', channelId: 400 }, topMessage: 1 }),
        ],
        chats: [channel, basicGroup, supergroup],
        users: [user],
        messages: [],
      });
    });

    await stub.with(async () => {
      const chats = await adapter.getChats();
      expect(chats).toEqual([
        {
          id: MARKED_CHANNEL_ID,
          title: 'Lessons',
          username: 'lessons',
          type: 'CHANNEL',
          accessHash: '987654',
          isForum: false,
          isProtected: false,
          memberCount: null,
          migratedFromChatId: null,
        },
        {
          id: '-200',
          title: 'Family',
          username: null,
          type: 'GROUP',
          accessHash: null,
          isForum: false,
          isProtected: false,
          memberCount: 5,
          migratedFromChatId: null,
        },
        {
          id: String(-1_000_000_000_000 - 400),
          title: 'Study group',
          username: null,
          type: 'SUPERGROUP',
          accessHash: '1',
          isForum: true,
          isProtected: true,
          memberCount: 1_234,
          migratedFromChatId: null,
        },
      ]);
    });
  });
});

describe('MtcuteTelegramAdapter — history', () => {
  it('pages newest → oldest with an exclusive cursor and at most 100 messages', async () => {
    const { stub, adapter } = setup();
    await stub.registerPeers(channel);
    const requests: tl.messages.RawGetHistoryRequest[] = [];
    stub.respondWith('messages.getHistory', (request) => {
      requests.push(request);
      return createStub('messages.channelMessages', {
        messages: [message(49, { message: 'older' }), message(50, { message: 'newest on page' })],
        chats: [channel],
        users: [],
        count: 2,
      });
    });

    await stub.with(async () => {
      const page = await adapter.getChatHistory(MARKED_CHANNEL_ID, '51', 500);
      expect(page.map((item) => item.id)).toEqual(['50', '49']);
      expect(requests[0]).toMatchObject({ offsetId: 51, addOffset: 0, limit: 100 });

      await adapter.getChatHistory(MARKED_CHANNEL_ID);
      expect(requests[1]).toMatchObject({ offsetId: 0, limit: 100 });
    });
  });

  it('reads newer messages oldest → newest, strictly after the given id', async () => {
    const { stub, adapter } = setup();
    await stub.registerPeers(channel);
    let request: tl.messages.RawGetHistoryRequest | undefined;
    stub.respondWith('messages.getHistory', (incoming) => {
      request = incoming;
      // Telegram answers newest first; the offset message itself may be included.
      return createStub('messages.channelMessages', {
        messages: [message(12), message(11), message(10)],
        chats: [channel],
        users: [],
        count: 3,
      });
    });

    await stub.with(async () => {
      const newer = await adapter.getNewerMessages(MARKED_CHANNEL_ID, '10', 50);
      expect(newer.map((item) => item.id)).toEqual(['11', '12']);
      expect(request).toMatchObject({ offsetId: 11, addOffset: -50, limit: 50 });
    });
  });

  it('maps text, captions, media, albums, replies, forwards and protection flags', async () => {
    const { stub, adapter } = setup();
    await stub.registerPeers(channel);
    const video = createStub('document', {
      id: Long.fromNumber(77),
      mimeType: 'video/mp4',
      size: 1_048_576,
      attributes: [
        { _: 'documentAttributeVideo', duration: 12.5, w: 1280, h: 720 },
        { _: 'documentAttributeFilename', fileName: 'lesson-01.mp4' },
      ],
    });
    stub.respondWith('messages.getHistory', () =>
      createStub('messages.channelMessages', {
        messages: [
          message(3, {
            message: 'Bài giảng 1',
            media: { _: 'messageMediaDocument', document: video },
            groupedId: Long.fromNumber(555),
            entities: [{ _: 'messageEntityBold', offset: 0, length: 4 }],
            noforwards: true,
            ttlPeriod: 86_400,
            views: 10,
          }),
          message(2, {
            message: 'Plain text',
            replyTo: { _: 'messageReplyHeader', replyToMsgId: 1 },
            fwdFrom: {
              _: 'messageFwdHeader',
              date: 1_690_000_000,
              fromId: { _: 'peerChannel', channelId: 42 },
              channelPost: 99,
            },
            entities: [
              { _: 'messageEntityTextUrl', offset: 0, length: 5, url: 'https://example.com' },
            ],
          }),
        ],
        chats: [channel],
        users: [],
        count: 2,
      }),
    );

    await stub.with(async () => {
      const [withVideo, plain] = await adapter.getChatHistory(MARKED_CHANNEL_ID);

      expect(withVideo).toMatchObject({
        id: '3',
        chatId: MARKED_CHANNEL_ID,
        type: 'VIDEO',
        text: null,
        caption: 'Bài giảng 1',
        entities: [{ kind: 'bold', offset: 0, length: 4 }],
        mediaGroupId: '555',
        isContentProtected: true,
        ttlPeriod: 86_400,
        views: 10,
      });
      expect(withVideo?.media).toHaveLength(1);
      const media = withVideo!.media[0]!;
      expect(media).toMatchObject({
        type: 'VIDEO',
        fileName: 'lesson-01.mp4',
        mimeType: 'video/mp4',
        size: 1_048_576,
        width: 1280,
        height: 720,
        duration: 12.5,
        isSelfDestructing: false,
      });
      expect(decodeFileId(media.fileId)).toEqual({
        chatId: MARKED_CHANNEL_ID,
        messageId: '3',
        fileUniqueId: media.fileUniqueId,
      });

      expect(plain).toMatchObject({
        id: '2',
        type: 'TEXT',
        text: 'Plain text',
        caption: null,
        media: [],
        replyToMessageId: '1',
        entities: [
          { kind: 'textUrl', offset: 0, length: 5, params: { url: 'https://example.com' } },
        ],
        forward: {
          fromChatId: String(-1_000_000_000_000 - 42),
          fromMessageId: '99',
          senderName: null,
        },
      });
      expect(plain?.forward?.date.toISOString()).toBe(new Date(1_690_000_000_000).toISOString());
    });
  });
});

describe('MtcuteTelegramAdapter — imports', () => {
  it('reports the message count and reads pages below an id or a date', async () => {
    const { stub, adapter } = setup();
    await stub.registerPeers(channel);
    const requests: tl.messages.RawGetHistoryRequest[] = [];
    stub.respondWith('messages.getHistory', (request) => {
      requests.push(request);
      return createStub('messages.channelMessages', {
        messages: [message(7), message(9), message(8)],
        chats: [channel],
        users: [],
        count: 1_234,
      });
    });

    await stub.with(async () => {
      const newest = await adapter.getHistoryPage(MARKED_CHANNEL_ID, { limit: 3 });
      expect(newest.total).toBe(1_234);
      expect(newest.messages.map((item) => item.id)).toEqual(['9', '8', '7']);
      expect(requests[0]).toMatchObject({ offsetId: 0, offsetDate: 0, limit: 3 });

      const before = new Date('2026-09-01T00:00:00Z');
      await adapter.getHistoryPage(MARKED_CHANNEL_ID, { beforeDate: before, limit: 1 });
      expect(requests[1]).toMatchObject({
        offsetId: 0,
        offsetDate: before.getTime() / 1000,
        limit: 1,
      });

      // The id cursor wins over the date, and stays exclusive.
      const older = await adapter.getHistoryPage(MARKED_CHANNEL_ID, {
        beforeMessageId: '9',
        beforeDate: before,
      });
      expect(requests[2]).toMatchObject({ offsetId: 9, offsetDate: 0, limit: 100 });
      expect(older.messages.map((item) => item.id)).toEqual(['8', '7']);
    });
  });

  it('reads the full chat, including the basic group it was upgraded from', async () => {
    const { stub, adapter } = setup();
    const supergroup = createStub('channel', {
      id: 400,
      title: 'Study group',
      megagroup: true,
      accessHash: Long.fromNumber(1),
    });
    await stub.registerPeers(supergroup);
    stub.respondWith('channels.getFullChannel', () =>
      createStub('messages.chatFull', {
        fullChat: createStub('channelFull', {
          id: 400,
          participantsCount: 321,
          migratedFromChatId: Long.fromNumber(200),
          migratedFromMaxId: 57,
        }),
        chats: [supergroup],
        users: [],
      }),
    );

    await stub.with(async () => {
      await expect(adapter.refreshChat(String(-1_000_000_000_000 - 400))).resolves.toMatchObject({
        type: 'SUPERGROUP',
        title: 'Study group',
        memberCount: 321,
        isProtected: false,
        migratedFromChatId: '-200',
      });
    });
  });

  it('turns an unreadable chat into ChatUnavailableError', async () => {
    const { stub, adapter } = setup();
    await stub.registerPeers(channel);
    stub.respondWith('channels.getFullChannel', () => {
      throw rpcError(406, 'CHANNEL_PRIVATE');
    });
    await stub.with(async () => {
      await expect(adapter.refreshChat(MARKED_CHANNEL_ID)).rejects.toMatchObject({
        code: 'CHAT_UNAVAILABLE',
      });
    });
  });

  it('describes the old basic group, or null when this account cannot read it', async () => {
    const { stub, adapter } = setup();
    stub.respondWith('messages.getChats', (request) =>
      createStub('messages.chats', {
        chats: request.id.map((id) =>
          Number(id) === 200
            ? createStub('chat', {
                id: 200,
                title: 'Study group (before upgrade)',
                deactivated: true,
                noforwards: true,
              })
            : createStub('chatForbidden', { id: Number(id), title: 'Hidden' }),
        ),
      }),
    );

    await stub.with(async () => {
      await expect(adapter.getLegacyGroup('-200')).resolves.toEqual({
        id: '-200',
        title: 'Study group (before upgrade)',
        isProtected: true,
      });
      await expect(adapter.getLegacyGroup('-300')).resolves.toBeNull();
    });
  });

  it('reads every forum topic, page by page', async () => {
    const { stub, adapter } = setup();
    const forum = createStub('channel', {
      id: CHANNEL_ID,
      title: 'Course',
      megagroup: true,
      forum: true,
      accessHash: Long.fromNumber(5),
    });
    await stub.registerPeers(forum);
    const topic = (id: number, extra: Partial<tl.RawForumTopic> = {}) =>
      createStub('forumTopic', {
        id,
        date: 1_700_000_000 + id,
        title: `Lesson ${id}`,
        iconColor: 0x6fb9f0,
        topMessage: 1_000 + id,
        ...extra,
      });
    const all = [
      topic(1, { title: 'General', hidden: true }),
      ...Array.from({ length: 149 }, (_, index) =>
        topic(index + 2, { pinned: index === 0, closed: index === 5 }),
      ),
    ];
    const requests: tl.messages.RawGetForumTopicsRequest[] = [];
    stub.respondWith('messages.getForumTopics', (request) => {
      requests.push(request);
      const start =
        request.offsetTopic === 0
          ? 0
          : all.findIndex((item) => item.id === request.offsetTopic) + 1;
      const page = all.slice(start, start + request.limit);
      return createStub('messages.forumTopics', {
        count: all.length,
        topics: page,
        // Each topic's last message, whose date pages topics ordered by activity.
        messages: page.map((item) => message(item.topMessage)),
        chats: [forum],
        users: [],
      });
    });

    await stub.with(async () => {
      const topics = await adapter.getForumTopics(MARKED_CHANNEL_ID);
      expect(topics).toHaveLength(150);
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ offsetDate: 0, offsetId: 0, offsetTopic: 0, limit: 100 });
      expect(requests[1]).toMatchObject({
        offsetTopic: 100,
        offsetId: 1_100,
        offsetDate: 1_700_000_000 + 1_100,
      });
      expect(topics[0]).toEqual({
        id: 1,
        title: 'General',
        iconColor: 0x6fb9f0,
        isClosed: false,
        isPinned: false,
        isHidden: true,
        date: new Date((1_700_000_000 + 1) * 1000),
      });
      expect(topics[1]).toMatchObject({ id: 2, title: 'Lesson 2', isPinned: true });
      expect(topics[6]).toMatchObject({ id: 7, isClosed: true });
    });
  });

  it('turns a chat without topics into NotAForumError', async () => {
    const { stub, adapter } = setup();
    await stub.registerPeers(channel);
    stub.respondWith('messages.getForumTopics', () => {
      throw rpcError(400, 'CHANNEL_FORUM_MISSING');
    });
    await stub.with(async () => {
      await expect(adapter.getForumTopics(MARKED_CHANNEL_ID)).rejects.toBeInstanceOf(
        NotAForumError,
      );
    });
  });
});

describe('MtcuteTelegramAdapter — updates', () => {
  function setupUpdates() {
    const stub = new StubTelegramClient();
    const client = new TelegramClient({ client: stub });
    return { stub, client, adapter: new MtcuteTelegramAdapter(client) };
  }

  /** What Telegram pushes; the peers of an update are cached only when Telegram sent them along. */
  function announce(stub: StubTelegramClient, update: tl.TypeUpdate, cached = true): void {
    const peers = cached ? PeersIndex.from({ chats: [channel] }) : new PeersIndex();
    stub.onRawUpdate.emit({ update, peers } as never);
  }

  it('passes on the ids of new, edited and deleted messages once it receives updates', async () => {
    const { stub, client, adapter } = setupUpdates();
    const start = vi.spyOn(client, 'startUpdatesLoop').mockResolvedValue();
    const events: UpdateEvent[] = [];
    await adapter.subscribeUpdates((event) => {
      events.push(event);
    });
    expect(start).toHaveBeenCalledTimes(1);

    announce(stub, { _: 'updateNewChannelMessage', message: message(41), pts: 1, ptsCount: 1 });
    announce(
      stub,
      { _: 'updateNewChannelMessage', message: message(42), pts: 2, ptsCount: 1 },
      false,
    );
    announce(stub, {
      _: 'updateEditChannelMessage',
      message: message(40, { editDate: 1_700_000_100 }),
      pts: 3,
      ptsCount: 1,
    });
    announce(stub, {
      _: 'updateDeleteChannelMessages',
      channelId: CHANNEL_ID,
      messages: [7, 8],
      pts: 5,
      ptsCount: 2,
    });
    announce(stub, { _: 'updateDeleteMessages', messages: [9], pts: 6, ptsCount: 1 });

    expect(events).toEqual([
      { kind: 'new_message', chatId: MARKED_CHANNEL_ID, messageId: '41' },
      // The chat of a message comes from its raw peer, cached or not.
      { kind: 'new_message', chatId: MARKED_CHANNEL_ID, messageId: '42' },
      { kind: 'edit_message', chatId: MARKED_CHANNEL_ID, messageId: '40' },
      { kind: 'delete_messages', chatId: MARKED_CHANNEL_ID, messageIds: ['7', '8'] },
      { kind: 'delete_messages', chatId: null, messageIds: ['9'] },
    ]);
  });

  it('keeps delivering when the handler fails, and keeps the first handler of a client', async () => {
    const { stub, adapter } = setupUpdates();
    const seen: string[] = [];
    adapter.onUpdate(async (event) => {
      seen.push(event.kind === 'new_message' ? event.messageId : event.kind);
      if (seen.length === 1) {
        throw new Error('broken handler');
      }
    });
    adapter.onUpdate(() => {
      seen.push('second handler');
    });

    announce(stub, { _: 'updateNewChannelMessage', message: message(1), pts: 1, ptsCount: 1 });
    announce(stub, { _: 'updateNewChannelMessage', message: message(2), pts: 2, ptsCount: 1 });
    await Promise.resolve();
    expect(seen).toEqual(['1', '2']);
  });

  it('starts receiving again on request (after a reconnect)', async () => {
    const { client, adapter } = setupUpdates();
    const start = vi.spyOn(client, 'startUpdatesLoop').mockResolvedValue();
    await adapter.startUpdates();
    await adapter.startUpdates();
    expect(start).toHaveBeenCalledTimes(2);
  });
});
