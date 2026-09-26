import {
  GENERAL_TOPIC_ID as SHARED_GENERAL_TOPIC_ID,
  MESSAGE_CATEGORIES,
  messageTypesOf,
} from '@tam/shared';
import { makeMediaSummary, makeMessage } from '../../../testing/fixtures';
import {
  CATEGORY_TYPES,
  GENERAL_TOPIC_ID,
  categoryOfType,
  mediaStatusLabel,
  messageTitle,
  serviceActionLabel,
  titleMatches,
} from './message-labels';

describe('message labels', () => {
  it('mirrors the categories of @tam/shared', () => {
    for (const category of MESSAGE_CATEGORIES) {
      expect(CATEGORY_TYPES[category]).toEqual(messageTypesOf(category));
    }
    expect(Object.keys(CATEGORY_TYPES).sort()).toEqual([...MESSAGE_CATEGORIES].sort());
    expect(GENERAL_TOPIC_ID).toBe(SHARED_GENERAL_TOPIC_ID);
    expect(categoryOfType('VOICE')).toBe('audio');
    expect(categoryOfType('SERVICE')).toBeNull();
  });

  it('names messages after their file, their first line or their type', () => {
    expect(
      messageTitle(makeMessage({ media: makeMediaSummary({ fileName: 'Lesson 4.mp4' }) })),
    ).toBe('Lesson 4.mp4');
    expect(
      messageTitle(
        makeMessage({ type: 'TEXT', media: null, excerpt: '\n  Homework for Monday\nPage 12' }),
      ),
    ).toBe('Homework for Monday');
    expect(
      messageTitle(
        makeMessage({ type: 'PHOTO', media: null, excerpt: null, telegramMessageId: 42 }),
      ),
    ).toBe('Photo #42');
    expect(
      messageTitle(makeMessage({ type: 'TEXT', media: null, excerpt: 'x'.repeat(200) })),
    ).toHaveLength(120);
  });

  it('finds where a search matched in the title', () => {
    const named = makeMessage({
      media: makeMediaSummary({ fileName: '  Wave zone.mp4' }),
      matches: { fileName: [[7, 4]], excerpt: [] },
    });
    // The title is trimmed: the range moves with it.
    expect(messageTitle(named)).toBe('Wave zone.mp4');
    expect(titleMatches(named)).toEqual([[5, 4]]);

    const text = makeMessage({
      type: 'TEXT',
      media: null,
      excerpt: '\n  Needle here\nand a needle there',
      matches: {
        fileName: [],
        excerpt: [
          [3, 6],
          [19, 6],
        ],
      },
    });
    // Only the first line names the message.
    expect(titleMatches(text)).toEqual([[0, 6]]);

    const long = makeMessage({
      type: 'TEXT',
      media: null,
      excerpt: `${'x'.repeat(118)}needle`,
      matches: { fileName: [], excerpt: [[118, 6]] },
    });
    // Cut away with the end of a long line.
    expect(titleMatches(long)).toEqual([]);
    expect(titleMatches(makeMessage())).toEqual([]);
  });

  it('describes service messages and download states', () => {
    expect(serviceActionLabel('messageActionTopicCreate')).toBe('Topic created');
    expect(serviceActionLabel('messageActionSomethingNew')).toBe('Service message');
    expect(serviceActionLabel(null)).toBe('Service message');
    expect(mediaStatusLabel({ downloadStatus: 'DOWNLOADING', downloadProgress: 45 })).toBe(
      'Downloading 45%',
    );
    expect(mediaStatusLabel({ downloadStatus: 'SKIPPED', downloadProgress: 0 })).toBe(
      'Not downloaded',
    );
    expect(mediaStatusLabel({ downloadStatus: 'DOWNLOADED', downloadProgress: 100 })).toBe(
      'Downloaded',
    );
  });
});
