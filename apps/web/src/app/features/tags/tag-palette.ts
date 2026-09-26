export interface TagColor {
  readonly value: string;
  readonly name: string;
}

/** Tag colors that read well as a dot on light and dark surfaces. */
export const TAG_COLORS: readonly TagColor[] = [
  { value: '#e5484d', name: 'Red' },
  { value: '#f76b15', name: 'Orange' },
  { value: '#ffc53d', name: 'Yellow' },
  { value: '#46a758', name: 'Green' },
  { value: '#12a594', name: 'Teal' },
  { value: '#0090ff', name: 'Blue' },
  { value: '#3e63dd', name: 'Indigo' },
  { value: '#8e4ec6', name: 'Purple' },
  { value: '#d6409f', name: 'Pink' },
  { value: '#978365', name: 'Brown' },
];

/** Mirrors TAG_NAME_MAX_LENGTH of @tam/shared. */
export const TAG_NAME_MAX_LENGTH = 40;

/** The color for a new tag: the one the tags use least (the first of the palette on a tie). */
export function nextTagColor(tags: readonly { color: string | null }[]): string {
  const uses = new Map(TAG_COLORS.map((color) => [color.value, 0]));
  for (const tag of tags) {
    const count = tag.color === null ? undefined : uses.get(tag.color);
    if (tag.color !== null && count !== undefined) {
      uses.set(tag.color, count + 1);
    }
  }
  let best = TAG_COLORS[0]?.value ?? '#0090ff';
  for (const { value } of TAG_COLORS) {
    if ((uses.get(value) ?? 0) < (uses.get(best) ?? 0)) {
      best = value;
    }
  }
  return best;
}

/** How tag names are told apart: trimmed, spaces collapsed, without regard to case. */
export function tagKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}
