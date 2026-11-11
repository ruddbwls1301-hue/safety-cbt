import type { Question } from '../types';

/**
 * Correction proposals prepared outside the app (compared with the source image by a reviewer).
 * A proposal never changes saved data by itself: a person opens it next to the source image and saves or approves it.
 */
export type CorrectionField = 'prompt' | 'choice' | 'explanation' | 'answer';
export type CorrectionItem = {
  questionId: string;
  originalId?: string;
  field: CorrectionField;
  /** 0-based choice position; only for `choice`. */
  index?: number;
  before: string | number | null;
  after: string | number;
  note?: string;
};
export type CorrectionFile = { kind: 'cbt-corrections'; version: 1; createdAt?: string; items: CorrectionItem[] };
export type CorrectionState = 'ready' | 'applied' | 'conflict';
export type CorrectionGroup = {
  questionId: string;
  originalId?: string;
  question?: Question;
  items: { item: CorrectionItem; state: CorrectionState; current: string | number | null }[];
  /** ready: something left to apply and nothing conflicts. */
  state: CorrectionState | 'missing';
};

const FIELD_LABEL: Record<CorrectionField, string> = { prompt: '문제 지문', choice: '보기', explanation: '해설', answer: '정답 번호' };
export function correctionLabel(item: CorrectionItem): string {
  return item.field === 'choice' ? `보기 ${(item.index ?? 0) + 1}` : FIELD_LABEL[item.field];
}

export function parseCorrectionFile(value: unknown): CorrectionFile {
  const file = value as Partial<CorrectionFile> | null;
  if (!file || typeof file !== 'object' || file.kind !== 'cbt-corrections' || file.version !== 1 || !Array.isArray(file.items)) throw new Error('교정안 파일 형식이 아닙니다. (kind: cbt-corrections, version: 1)');
  const seen = new Set<string>();
  const items = file.items.map((raw, position): CorrectionItem => {
    const item = raw as Partial<CorrectionItem> | null;
    const fail = (reason: string): never => { throw new Error(`${position + 1}번째 교정안: ${reason}`); };
    if (!item || typeof item !== 'object' || typeof item.questionId !== 'string' || !item.questionId) return fail('문항 ID가 없습니다.');
    if (!['prompt', 'choice', 'explanation', 'answer'].includes(String(item.field))) return fail('수정 대상 항목을 알 수 없습니다.');
    const field = item.field as CorrectionField;
    if (field === 'choice' && (!Number.isInteger(item.index) || item.index! < 0 || item.index! > 3)) return fail('보기 위치는 0~3이어야 합니다.');
    if (field === 'answer') {
      if (!Number.isInteger(item.after) || (item.after as number) < 1 || (item.after as number) > 4) return fail('정답 번호는 1~4여야 합니다.');
      if (item.before !== null && !Number.isInteger(item.before)) return fail('기존 정답 번호 형식을 확인해 주세요.');
    } else if (typeof item.before !== 'string' || typeof item.after !== 'string') return fail('수정 전·후 내용은 문자열이어야 합니다.');
    if (item.before === item.after) return fail('수정 전과 후가 같습니다.');
    const key = `${item.questionId}\u0000${field}\u0000${field === 'choice' ? item.index : ''}`;
    if (seen.has(key)) return fail('같은 항목에 대한 교정안이 중복되었습니다.');
    seen.add(key);
    return {
      questionId: item.questionId, field, before: item.before as CorrectionItem['before'], after: item.after as CorrectionItem['after'],
      ...(typeof item.originalId === 'string' ? { originalId: item.originalId } : {}), ...(field === 'choice' ? { index: item.index } : {}),
      ...(typeof item.note === 'string' && item.note ? { note: item.note } : {}),
    };
  });
  return { kind: 'cbt-corrections', version: 1, ...(typeof file.createdAt === 'string' ? { createdAt: file.createdAt } : {}), items };
}

function currentValue(question: Question, item: CorrectionItem): string | number | null {
  if (item.field === 'choice') return question.choices[item.index ?? 0] ?? '';
  if (item.field === 'answer') return question.answer;
  return question[item.field];
}

/** Exact comparison with the saved value: a changed field is a conflict, never silently overwritten. */
export function groupCorrections(file: CorrectionFile, questions: Question[]): CorrectionGroup[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const groups = new Map<string, CorrectionGroup>();
  for (const item of file.items) {
    let group = groups.get(item.questionId);
    if (!group) {
      const question = byId.get(item.questionId);
      group = { questionId: item.questionId, originalId: item.originalId ?? question?.book?.originalId, question, items: [], state: question ? 'applied' : 'missing' };
      groups.set(item.questionId, group);
    }
    if (!group.question) continue;
    const current = currentValue(group.question, item);
    const state: CorrectionState = current === item.after ? 'applied' : current === item.before ? 'ready' : 'conflict';
    group.items.push({ item, state, current });
  }
  for (const group of groups.values()) {
    if (!group.question) continue;
    group.state = group.items.some((entry) => entry.state === 'conflict') ? 'conflict' : group.items.some((entry) => entry.state === 'ready') ? 'ready' : 'applied';
  }
  return [...groups.values()];
}

/**
 * Builds the proposed question for the review editor. Same ID; the content change returns it to pending
 * and clears the source-comparison marks, exactly like typing the change by hand.
 */
export function proposeCorrection(group: CorrectionGroup): Question {
  if (!group.question) throw new Error('문제은행에 없는 문항입니다.');
  if (group.state !== 'ready') throw new Error('반영할 수 있는 교정안이 없습니다.');
  const next: Question = structuredClone(group.question);
  let contentChanged = false; let explanationChanged = false;
  for (const { item, state } of group.items) {
    if (state !== 'ready') continue;
    if (item.field === 'choice') { next.choices[item.index ?? 0] = item.after as string; contentChanged = true; }
    else if (item.field === 'answer') { next.answer = item.after as number; contentChanged = true; }
    else if (item.field === 'prompt') { next.prompt = item.after as string; contentChanged = true; }
    else { next.explanation = item.after as string; explanationChanged = true; }
  }
  next.status = 'pending';
  if (next.book) {
    const review = { ...next.book.review };
    delete review.automatic;
    if (contentChanged) { review.sourceCompared = false; review.flagsChecked = false; }
    if (explanationChanged) review.explanationChecked = false;
    next.book = { ...next.book, review };
  }
  return next;
}
