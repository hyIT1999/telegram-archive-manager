export interface NavItem {
  readonly label: string;
  readonly path: string;
  /** Material Symbols ligature name. */
  readonly icon: string;
}

export interface NavSection {
  readonly title: string;
  readonly items: readonly NavItem[];
}

/** The sidebar, top to bottom. Sections only group the items visually. */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', path: '/dashboard', icon: 'space_dashboard' }],
  },
  {
    title: 'Library',
    items: [
      { label: 'Channels', path: '/channels', icon: 'forum' },
      { label: 'All Messages', path: '/messages', icon: 'chat' },
      { label: 'Videos', path: '/videos', icon: 'movie' },
      { label: 'Images', path: '/images', icon: 'photo_library' },
      { label: 'Documents', path: '/documents', icon: 'description' },
      { label: 'Audio', path: '/audio', icon: 'headphones' },
    ],
  },
  {
    title: 'Collections',
    items: [
      { label: 'Favorites', path: '/favorites', icon: 'star' },
      { label: 'Tags', path: '/tags', icon: 'sell' },
    ],
  },
  {
    title: 'Manage',
    items: [
      { label: 'Import Jobs', path: '/imports', icon: 'download' },
      { label: 'Settings', path: '/settings', icon: 'settings' },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
