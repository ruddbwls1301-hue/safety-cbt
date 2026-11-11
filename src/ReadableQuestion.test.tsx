import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReadableQuestion, splitQuestionForReading } from './ReadableQuestion';
import { BookImageFigure } from './BookImages';

describe('source-preserving reading layout', () => {
  it('separates a short question from a long passage while retaining every character', () => {
    const text = '합성 화면 확인 질문은?  이것은 화면 배치 검증을 위한 긴 설명입니다. 원본의 띄어쓰기와 문장부호를 그대로 보존합니다.';
    const parts = splitQuestionForReading(text);
    expect(parts).toHaveLength(2);
    expect(parts.join('')).toBe(text);
    expect(renderToStaticMarkup(<ReadableQuestion text={text}/>)).toContain('class="reading-passage"');
  });
  it.each(['질문만 있는 합성 문장?', '단순 합성 지문 3.14 × 10⁻³', '기존 줄바꿈?\n이미 구분된 합성 지문입니다.', '합성 지문? (단, x = 1.2)'])('keeps existing short text, line breaks and formula content: %s', (text) => {
    expect(splitQuestionForReading(text)).toEqual([text]);
    expect(splitQuestionForReading(text).join('')).toBe(text);
  });
  it('escapes text and retains heading semantics in review cards', () => {
    const html = renderToStaticMarkup(<ReadableQuestion as="h3" text={'합성 <script>안전</script> 지문'}/>);
    expect(html).toContain('<h3 class="readable-question">');
    expect(html).toContain('&lt;script&gt;안전&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('puts image enlargement controls before the image while preserving the original URL', () => {
    const html = renderToStaticMarkup(<BookImageFigure url="blob:synthetic-preview-only" purpose="review" alt="합성 원본 해설"/>);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('이미지 확대');
    expect(html.indexOf('이미지 확대')).toBeLessThan(html.indexOf('<img'));
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('src="blob:synthetic-preview-only"');
  });
});
