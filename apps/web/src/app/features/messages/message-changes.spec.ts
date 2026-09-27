import { TestBed } from '@angular/core/testing';
import { makeMessage } from '../../../testing/fixtures';
import type { MessageSummaryDto } from '../../shared/models';
import { FeedStateCache } from './feed-cache';
import {
  MessageChanges,
  type MessageUpdate,
  favoriteChanged,
  tagDeleted,
  tagEdited,
  tagsChanged,
} from './message-changes';

const RED = { id: '0199a0b1-0000-7000-8000-e00000000001', name: 'Red', color: '#e5484d' };
const BLUE = { id: '0199a0b1-0000-7000-8000-e00000000002', name: 'Blue', color: null };

describe('message updates', () => {
  it('change only the message they are about', () => {
    const message = makeMessage();
    const other = makeMessage();
    expect(favoriteChanged(message.id, true)(message).isFavorite).toBe(true);
    expect(favoriteChanged(message.id, true)(other)).toBe(other);
    expect(tagsChanged(message.id, [RED])(message).tags).toEqual([RED]);
  });

  it('follow a renamed or deleted tag on every message carrying it', () => {
    const tagged = makeMessage({ tags: [RED, BLUE] });
    const untagged = makeMessage();
    const renamed = { ...RED, name: 'Crimson' };
    expect(tagEdited(renamed)(tagged).tags).toEqual([renamed, BLUE]);
    expect(tagEdited(renamed)(untagged)).toBe(untagged);
    expect(tagDeleted(RED.id)(tagged).tags).toEqual([BLUE]);
    expect(tagDeleted(RED.id)(untagged)).toBe(untagged);
  });
});

describe('MessageChanges', () => {
  it('updates the feeds kept for Back and tells the open ones', () => {
    const message = makeMessage();
    const cache = TestBed.inject(FeedStateCache);
    cache.set('feed', { items: [message], nextCursor: null, total: 1, totalCapped: false });
    const changes = TestBed.inject(MessageChanges);
    const heard: MessageUpdate[] = [];
    changes.updates.subscribe((update) => heard.push(update));

    changes.publish(favoriteChanged(message.id, true));

    expect(cache.get('feed')?.items[0]?.isFavorite).toBe(true);
    expect(heard).toHaveLength(1);
    const applied: MessageSummaryDto | undefined = heard[0]?.(message);
    expect(applied?.isFavorite).toBe(true);
  });
});
