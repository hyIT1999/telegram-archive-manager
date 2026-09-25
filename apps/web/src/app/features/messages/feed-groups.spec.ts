import { makeMessage } from '../../../testing/fixtures';
import { groupAlbums } from './feed-groups';

describe('groupAlbums', () => {
  it('groups consecutive messages of one album and keeps the rest apart', () => {
    const single = makeMessage();
    const albumA = [
      makeMessage({ mediaGroupId: '7' }),
      makeMessage({ mediaGroupId: '7' }),
      makeMessage({ mediaGroupId: '7' }),
    ];
    const albumB = [makeMessage({ mediaGroupId: '8' })];
    const entries = groupAlbums([single, ...albumA, ...albumB]);

    expect(entries.map((entry) => entry.kind)).toEqual(['single', 'album', 'single']);
    const album = entries[1];
    expect(album?.kind === 'album' ? album.items.map((item) => item.id) : []).toEqual(
      albumA.map((item) => item.id),
    );
    // Keyed by the album's first message, so the key survives the album growing.
    expect(album?.key).toBe(`album-${albumA[0]?.id}`);
  });

  it('never merges albums of different channels that share an id', () => {
    const first = makeMessage({ mediaGroupId: '7' });
    const other = makeMessage({ mediaGroupId: '7', channel: { id: 'other', title: 'Other' } });
    expect(groupAlbums([first, other]).map((entry) => entry.kind)).toEqual(['single', 'single']);
  });

  it('continues an album cut by a page end', () => {
    const items = [makeMessage({ mediaGroupId: '9' }), makeMessage({ mediaGroupId: '9' })];
    const firstPage = groupAlbums(items.slice(0, 1));
    const both = groupAlbums(items);
    expect(firstPage[0]?.key).toBe(items[0]?.id);
    expect(both).toHaveLength(1);
    expect(both[0]?.kind).toBe('album');
  });
});
