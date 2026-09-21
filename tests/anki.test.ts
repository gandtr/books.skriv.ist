import { it, expect } from 'vitest';
import { ankiCsv } from '../src/lib/anki';
import type { Book } from '../src/lib/store';
import type { ReadingNote } from '../src/lib/notes';
const book = {
  id: 'a'.repeat(64),
  title: 'A book, with "quotes"',
  author: '日本語',
  format: 'epub',
} as Book;
const note: ReadingNote = {
  id: 'note-1',
  bookId: book.id,
  quote: 'Why, "now"?\nNext line.',
  text: '<img src="https://tracker.test"> & my note',
  section: 'Morning',
  position: { chapter: 0, fraction: 0.5, page: 1 },
  created: 1,
  updated: 1,
};
it('exports two quoted Basic fields with safe HTML and a return location', () => {
  const result = ankiCsv(book, [note], 'https://books.skriv.ist');
  expect(result).toContain(
    '#separator:Comma\n#html:true\n#columns:Front,Back\n',
  );
  expect(result).toContain('"Why, &quot;now&quot;?<br>Next line.","');
  expect(result).toContain(
    '&lt;img src=&quot;https://tracker.test&quot;&gt; &amp; my note',
  );
  expect(result).not.toContain('<img');
  expect(result).toContain('日本語');
  expect(result).toContain(
    '<a href=""https://books.skriv.ist/#read=' +
      book.id +
      '&amp;chapter=0&amp;fraction=0.5&amp;page=1"">',
  );
  expect(result.split('\n')).toHaveLength(6);
});
it('uses a location question for notes without a quotation and exports every note', () => {
  const pdf = { ...book, format: 'pdf' as const };
  const result = ankiCsv(
    pdf,
    [
      { ...note, quote: '', text: 'My answer' },
      { ...note, id: 'note-2', text: '' },
    ],
    'https://books.skriv.ist',
  );
  expect(result).toContain(
    'What did you note about A book, with &quot;quotes&quot; at Page 1?',
  );
  expect(result).toContain('My answer<br><br>');
  expect(result.split('\n')).toHaveLength(7);
});
