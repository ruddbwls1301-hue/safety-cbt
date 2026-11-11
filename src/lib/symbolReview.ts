import type { Question } from '../types';

/**
 * Symbol entry and review hints for manual correction.
 * Nothing here rewrites saved text: the palette inserts only what a person clicks,
 * and the hints only point at fields a person should compare with the source.
 */
export type SymbolEntry = { char: string; name: string };
export type SymbolGroup = { id: string; label: string; symbols: SymbolEntry[] };

const entries = (pairs: string): SymbolEntry[] => pairs.split('|').map((pair) => {
  const [char, name] = pair.split('=');
  return { char, name: name ?? char };
});

export const SYMBOL_GROUPS: SymbolGroup[] = [
  { id: 'process', label: '공정 기호', symbols: entries('○=가공|⇒=운반|□=수량검사|◇=품질검사|▽=저장|D=지체') },
  { id: 'arrow', label: '화살표·도형', symbols: entries('→=오른쪽 화살표|←=왼쪽 화살표|↑=위 화살표|↓=아래 화살표|↔=양방향 화살표|⇔=동치|△=삼각형|▲=검은 삼각형|●=검은 원|■=검은 사각형|◆=검은 마름모|◎=이중 원|※=참고표') },
  { id: 'math', label: '수식', symbols: entries('×=곱하기|÷=나누기|±=플러스마이너스|≤=이하|≥=이상|≠=같지 않음|≒=근사|√=제곱근|∑=합|∞=무한대|∝=비례|∴=따라서|²=제곱|³=세제곱|⁻¹=마이너스 1제곱|½=2분의 1|·=가운뎃점|′=프라임') },
  { id: 'unit', label: '단위', symbols: entries('℃=섭씨|°=도|Ω=옴|㎡=제곱미터|㎥=세제곱미터|㎏=킬로그램|㎜=밀리미터|㎝=센티미터|㎞=킬로미터|㎾=킬로와트|㎸=킬로볼트|㎃=밀리암페어|㎐=헤르츠|㏈=데시벨|㎩=파스칼|㎫=메가파스칼|㎂=마이크로암페어|‰=퍼밀') },
  { id: 'greek', label: '그리스 문자', symbols: entries('α=알파|β=베타|γ=감마|δ=델타|ε=엡실론|η=에타|θ=세타|λ=람다|μ=뮤|π=파이|ρ=로|σ=시그마|τ=타우|φ=파이(phi)|ω=오메가|Δ=대문자 델타|Σ=대문자 시그마') },
  { id: 'number', label: '번호', symbols: entries('①|②|③|④|⑤|㉠|㉡|㉢|㉣|㉮|㉯|㉰|㉱|ⓐ|ⓑ|ⓒ|ⓓ') },
];

/** Pure caret insertion: replaces the selected range and reports the new caret position. */
export function insertAtSelection(value: string, start: number | null, end: number | null, text: string): { value: string; caret: number } {
  const from = Math.max(0, Math.min(start ?? value.length, value.length));
  const to = Math.max(from, Math.min(end ?? from, value.length));
  return { value: value.slice(0, from) + text + value.slice(to), caret: from + text.length };
}

export type SymbolHintField = 'prompt' | 'choice' | 'explanation';
export type SymbolHint = { field: SymbolHintField; index?: number; label: string; reason: string };

const SHAPE_OR_OPERATOR = /[←-⇿∀-⋿■-◿①-⓿㈀-㋿]/u;

function textHints(text: string, field: SymbolHintField, label: string, index?: number): SymbolHint[] {
  const hints: SymbolHint[] = [];
  const add = (reason: string) => hints.push({ field, label, reason, ...(index === undefined ? {} : { index }) });
  if (/[�-]/u.test(text)) add('깨진 문자(□ 대체 문자·사용자 정의 영역)가 저장되어 있습니다. 원본 글자를 직접 입력하세요.');
  if (/\?{2,}/u.test(text)) add('물음표가 연속됩니다. 인식하지 못한 기호일 수 있습니다.');
  if (/(?<![A-Za-z])(?:mm|cm|km|m)[23](?![0-9A-Za-z])/u.test(text)) add('단위 뒤 숫자(예: m2, cm3)가 지수 ²·³ 또는 ㎡·㎥ 인지 원본과 대조하세요.');
  if (/(?<![0-9.])10-[0-9]/u.test(text)) add('"10-숫자" 표기가 지수(10⁻ⁿ)인지 범위인지 원본과 대조하세요.');
  if (/\S {3,}\S/u.test(text)) add('공백이 3칸 이상 이어집니다. 기호·수식이 빠졌을 수 있습니다.');
  if (/^\s*[:：=]/u.test(text)) add('구분 기호(: =) 앞이 비어 있습니다. 앞머리 기호가 빠졌을 수 있습니다.');
  return hints;
}

/**
 * Review hints for one question. Heuristic and incomplete by design:
 * a clean result does not mean the text matches the source, and nothing is auto-corrected.
 */
export function symbolHints(question: Pick<Question, 'prompt' | 'choices' | 'explanation'>): SymbolHint[] {
  const prompt = typeof question.prompt === 'string' ? question.prompt : '';
  const choices = Array.isArray(question.choices) ? question.choices.map((choice) => typeof choice === 'string' ? choice : '') : [];
  const explanation = typeof question.explanation === 'string' ? question.explanation : '';
  const hints = [...textHints(prompt, 'prompt', '문제 지문')];
  choices.forEach((choice, index) => {
    const label = `보기 ${index + 1}`;
    hints.push(...textHints(choice, 'choice', label, index));
    // "A: 75, B: 30" blanks and ratios such as "1:0.5" are ordinary text, not lost symbols.
    if (/^\s*[0-9A-Za-z]\s*[:：]\s*\S/u.test(choice) && !/[,，]\s*[A-Za-z]\s*[:：]/u.test(choice) && !/^\s*[0-9]\s*[:：]\s*[0-9]/u.test(choice)) hints.push({ field: 'choice', index, label, reason: '앞머리가 숫자·영문 한 글자입니다. 원본이 도형 기호(○ □ ◇ ▽ ⇒ 등)인지 대조하세요. (지체 D처럼 원본이 영문인 경우는 그대로 둡니다.)' });
  });
  if (/기호|부호/u.test(prompt) && ![prompt, ...choices].some((text) => SHAPE_OR_OPERATOR.test(text))) hints.push({ field: 'prompt', label: '문제 지문', reason: '지문이 기호·부호를 묻지만 지문과 보기에 기호 문자가 없습니다. 원본에서 빠진 기호가 있는지 대조하세요.' });
  hints.push(...textHints(explanation, 'explanation', '해설'));
  return hints;
}

/** True when a person has compared this content with the source since it was last changed. */
export function isHumanCompared(question: Question): boolean {
  if (question.status !== 'verified') return false;
  return question.book ? question.book.review?.sourceCompared === true && !question.book.review.automatic : true;
}

/** Bank/review-queue filter: hinted content that no person has compared yet. */
export function needsSymbolReview(question: Question): boolean {
  return !isHumanCompared(question) && symbolHints(question).length > 0;
}
