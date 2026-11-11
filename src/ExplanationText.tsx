/** Reflow OCR/PDF line breaks for reading without changing the saved explanation. */
export function explanationParagraphs(text: string): string[] {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n+/u);
  return blocks.flatMap((block) => {
    const joined = block.split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
    if (!joined) return [];
    return joined.split(/(?<=[.!?。])\s+(?=[^\s])/u).map((sentence) => sentence.trim()).filter(Boolean);
  });
}

/** Display only: `emphasizeLead` labels the first paragraph as the key point; text is never altered. */
export function ExplanationText({ text, className, emphasizeLead = false }: { text: string; className: string; emphasizeLead?: boolean }) {
  const paragraphs = explanationParagraphs(text);
  const lead = emphasizeLead && paragraphs.length > 1;
  return <div className={lead ? `${className} has-lead` : className}>{paragraphs.map((paragraph, index) => lead && index === 0
    ? <p key={`${index}:${paragraph.slice(0, 24)}`} className="explanation-lead"><span className="explanation-lead-label">핵심</span>{paragraph}</p>
    : <p key={`${index}:${paragraph.slice(0, 24)}`}>{paragraph}</p>)}</div>;
}
