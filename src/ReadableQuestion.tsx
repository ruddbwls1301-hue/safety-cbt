/** Layout only: retain every source character, including whitespace and punctuation. */
export function splitQuestionForReading(text: string): [string, string?] {
  const mark = text.search(/[?？]/);
  if (mark < 0 || mark > 140 || text.includes('\n') || text.slice(mark + 1).trim().length < 30) return [text];
  return [text.slice(0, mark + 1), text.slice(mark + 1)];
}

export function ReadableQuestion({ text, as: Tag = 'h1' }: { text: string; as?: 'h1' | 'h3' }) {
  const [lead, passage] = splitQuestionForReading(text);
  return <Tag className="readable-question">{lead}{passage !== undefined && <span className="reading-passage">{passage}</span>}</Tag>;
}
