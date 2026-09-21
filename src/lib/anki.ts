import type { Book } from './store';
import { locationLabel, readingLink, type ReadingNote } from './notes';

function html(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r\n|\r|\n/g, '<br>');
}
function csv(value: string) {
  return '"' + value.replace(/"/g, '""') + '"';
}
/** A local UTF-8 file for Anki's standard two-field Basic note type. */
export function ankiCsv(
  book: Book,
  notes: ReadingNote[],
  origin = location.origin,
) {
  const rows = notes.map((note) => {
    const where = locationLabel(book, note);
    const front =
      note.quote.trim() || `What did you note about ${book.title} at ${where}?`;
    const back =
      (note.text.trim() ? html(note.text.trim()) + '<br><br>' : '') +
      `<b>${html(book.title)}</b>` +
      (book.author ? '<br>' + html(book.author) : '') +
      '<br>' +
      html(where) +
      `<br><a href="${html(readingLink(book, note, origin))}">Return to this location</a>`;
    return [html(front), back].map(csv).join(',');
  });
  return (
    '#separator:Comma\n#html:true\n#columns:Front,Back\n#tags:skrivist-books\n' +
    rows.join('\n') +
    '\n'
  );
}
