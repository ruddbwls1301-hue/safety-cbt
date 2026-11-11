import { describe, expect, it } from 'vitest';
import { parseQuestionImport } from './questions';

describe('question bank import', () => {
  it('accepts questions classified by subject without year or round', () => {
    const [question] = parseQuestionImport({ questions: [{
      year: null,
      originalSubject: '산업재해 예방 및 안전보건교육',
      prompt: '다음 중 안전교육의 목적은?',
      choices: ['가', '나', '다', '라'],
      answer: 2,
      explanation: '원문 해설',
    }] });

    expect(question.year).toBeNull();
    expect(question.round).toBe('');
    expect(question.originalSubject).toBe('산업재해 예방 및 안전보건교육');
  });
});
