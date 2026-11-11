import { describe, expect, it } from 'vitest';
import { createDraftsForPage, draftIssues, inferImportDefaults, parseQuestionText, promptSimilarity } from './pdfImport';

describe('PDF extraction parsing', () => {
  it('splits questions, choices, explicit answers, and explanations without inventing an answer', () => {
    const text = [
      '97',
      '다음 중 방진마스크의 구비조건으로 적절하지 않은 것은?',
      '① 흡기밸브는 미약한 호흡에도 확실하게 작동할 것',
      '② 쉽게 착용되어야 하고 안면부가 밀착될 것',
      '③ 여과재는 우수하고 인체에 장애를 주지 않을 것',
      '④ 흡기 저항이 높을 것',
      '해설',
      '흡기밸브는 외부의 힘에 의하여 손상되지 않도록 한다.',
      '정답 ④',
      '98',
      '다음 중 안전장치가 아닌 것은?',
      '① 예초기',
      '② 기계장치',
      '해설 안전장치에 관한 설명',
      '99',
      '다음 중 보기에서 옳은 것은?',
      '① 보기 1 ② 보기 2 ③ 보기 3 ④ 보기 4',
      '해설 답에 관한 설명',
      '정답: ②',
    ].join('\n');

    const parsed = parseQuestionText(text);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({ questionNumber: 97, answer: 4, choices: ['흡기밸브는 미약한 호흡에도 확실하게 작동할 것', '쉽게 착용되어야 하고 안면부가 밀착될 것', '여과재는 우수하고 인체에 장애를 주지 않을 것', '흡기 저항이 높을 것'] });
    expect(parsed[0].explanation).toContain('외부의 힘');
    expect(parsed[1].answer).toBeNull();
    expect(parsed[1].choices[2]).toBe('');
    expect(parsed[2]).toMatchObject({ questionNumber: 99, answer: 2, choices: ['보기 1', '보기 2', '보기 3', '보기 4'] });
  });

  it('recovers a sequential question number when OCR joins a page digit to the number', () => {
    const parsed = parseQuestionText([
      '97. 다음 중 첫 번째 문제는?',
      '98. 다음 중 두 번째 문제는?',
      '40 산업안전기사 필기 1과목 499 [OCR] 다음 중 세 번째 문제는?',
      '100. 다음 중 네 번째 문제는?',
    ].join('\n'));
    expect(parsed.map((item) => item.questionNumber)).toEqual([97, 98, 99, 100]);
    expect(parsed[2].prompt).toContain('세 번째 문제');
  });

  it('filters numbered book headings that do not have question wording', () => {
    expect(parseQuestionText([
      '1. 최근 12개년치 기출 중복문제 소거 정리',
      '2. 산업재해 예방 및 안전보건교육',
    ].join('\n'))).toEqual([]);
  });

  it('leaves ambiguous years and rounds blank', () => {
    expect(inferImportDefaults('산업안전기사 2024 2회 기출.pdf')).toEqual({ year: 2024, round: '2회' });
    expect(inferImportDefaults('산업안전기사 2024-2025 기출.pdf')).toEqual({ year: null, round: '' });
  });

  it('does not require year or round, but still blocks incomplete content and unknown subject', () => {
    const issues = draftIssues({ year: null, round: '', originalSubject: '', prompt: '문제 지문', choices: ['보기 1', '', '보기 3', '보기 4'], answer: null, explanation: '', confidence: 92 });
    expect(issues).toEqual(expect.arrayContaining(['원본 과목 미확인', '보기 누락', '정답 표식 미검출', '해설 누락']));
    expect(issues).not.toContain('연도 미확인');
    expect(issues).not.toContain('회차 미확인');
  });

  it('keeps extracted questions unapproved, yearless, and grouped by detected subject', () => {
    const source = {
      id: 'book', name: '산업안전기사.pdf', size: 10, pageCount: 1, pageStart: 40, pageEnd: 40,
      lastProcessedPage: 39, importedAt: '2026-01-01T00:00:00.000Z', status: 'processing' as const,
      defaultYear: null, defaultRound: '', defaultOriginalSubject: '',
    };
    const [draft] = createDraftsForPage(source, 40, [
      '1과목 산업재해 예방 및 안전보건교육', '97', '다음 중 방진마스크의 조건으로 옳은 것은?',
      '① 보기 가', '② 보기 나', '③ 보기 다', '④ 보기 라', '정답 ④', '해설 원문 설명',
    ].join('\n'), 91, 'ocr');
    expect(draft).toMatchObject({ year: null, round: '', originalSubject: '산업재해 예방 및 안전보건교육', answer: 4, status: 'pending', sourcePage: 40 });
  });

  it('detects exact and near-duplicate Korean prompts', () => {
    const prompt = '다음 중 산업안전보건법상 안전관리자의 직무로 옳은 것은?';
    expect(promptSimilarity(prompt, prompt)).toBe(1);
    expect(promptSimilarity(prompt, '다음 중 산업안전보건법상 안전관리자의 직무로 옳은 것은')).toBeGreaterThan(0.88);
  });
});
