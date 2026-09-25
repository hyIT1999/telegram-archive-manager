import type { MessageEntityDto } from '../../shared/models';
import { formatText, linkTarget } from './text-format';

const texts = (runs: readonly { text: string }[]) => runs.map((run) => run.text);

describe('formatText', () => {
  it('returns nothing for empty text', () => {
    expect(formatText(null, [])).toEqual([]);
    expect(formatText('', [{ kind: 'bold', offset: 0, length: 1 }])).toEqual([]);
  });

  it('keeps plain text as one run', () => {
    expect(formatText('Hello\nworld', [])).toEqual([
      { kind: 'text', runs: [{ text: 'Hello\nworld', classes: '', href: null, spoiler: false }] },
    ]);
  });

  it('splits nested and overlapping formatting into runs', () => {
    // "Lesson one:" is bold, "one: optic" italic.
    const entities: MessageEntityDto[] = [
      { kind: 'bold', offset: 0, length: 11 },
      { kind: 'italic', offset: 7, length: 10 },
    ];
    const [block] = formatText('Lesson one: optics', entities);
    expect(block?.kind).toBe('text');
    const runs = block?.kind === 'text' ? block.runs : [];
    expect(texts(runs)).toEqual(['Lesson ', 'one:', ' optic', 's']);
    expect(runs.map((run) => run.classes)).toEqual(['b', 'b i', 'i', '']);
  });

  it('turns code blocks and quotes into blocks, formatting inside quotes', () => {
    const text = 'Intro\nprint(1)\nQuoted bold';
    const blocks = formatText(text, [
      { kind: 'pre', offset: 6, length: 8, language: 'python' },
      { kind: 'blockquote', offset: 15, length: 11 },
      { kind: 'bold', offset: 22, length: 4 },
    ]);
    expect(blocks.map((block) => block.kind)).toEqual(['text', 'pre', 'text', 'quote']);
    expect(blocks[1]).toEqual({ kind: 'pre', text: 'print(1)', language: 'python' });
    const quote = blocks[3];
    expect(quote?.kind === 'quote' ? texts(quote.runs) : []).toEqual(['Quoted ', 'bold']);
  });

  it('links web addresses, text links, mentions and e-mail addresses safely', () => {
    const text = 'See example.com, the notes, @physics_notes or me@example.com';
    const [block] = formatText(text, [
      { kind: 'link', offset: 4, length: 11 },
      { kind: 'textLink', offset: 17, length: 9, url: 'https://example.com/notes' },
      { kind: 'mention', offset: 28, length: 14 },
      { kind: 'email', offset: 46, length: 14 },
    ]);
    const links = block?.kind === 'text' ? block.runs.filter((run) => run.href) : [];
    expect(links.map((run) => [run.text, run.href])).toEqual([
      ['example.com', 'https://example.com/'],
      ['the notes', 'https://example.com/notes'],
      ['@physics_notes', 'https://t.me/physics_notes'],
      ['me@example.com', 'mailto:me@example.com'],
    ]);
  });

  it('never links unsafe targets and ignores ranges outside the text', () => {
    const text = 'Click here';
    const blocks = formatText(text, [
      { kind: 'textLink', offset: 0, length: 5, url: 'javascript:alert(1)' },
      { kind: 'bold', offset: 5, length: 40 },
    ]);
    expect(blocks).toEqual([
      { kind: 'text', runs: [{ text: 'Click here', classes: '', href: null, spoiler: false }] },
    ]);
  });

  it('marks spoilers', () => {
    const [block] = formatText('The answer is 42', [{ kind: 'spoiler', offset: 14, length: 2 }]);
    const runs = block?.kind === 'text' ? block.runs : [];
    expect(runs.at(-1)).toEqual({ text: '42', classes: 'spoiler', href: null, spoiler: true });
  });
});

describe('linkTarget', () => {
  it('keeps an explicit scheme and refuses other protocols', () => {
    const at = (value: string): MessageEntityDto => ({
      kind: 'link',
      offset: 0,
      length: value.length,
    });
    expect(linkTarget(at('http://example.com'), 'http://example.com')).toBe('http://example.com/');
    expect(linkTarget(at('ftp://example.com'), 'ftp://example.com')).toBeNull();
    expect(linkTarget({ kind: 'mention', offset: 0, length: 3 }, '@ab')).toBeNull();
    expect(linkTarget({ kind: 'bold', offset: 0, length: 3 }, 'abc')).toBeNull();
  });
});
