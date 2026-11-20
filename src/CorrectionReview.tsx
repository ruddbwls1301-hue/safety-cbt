import { useMemo, useState, type ChangeEvent } from 'react';
import { correctionLabel, groupCorrections, parseCorrectionFile, type CorrectionFile, type CorrectionGroup } from './lib/corrections';
import type { Question } from './types';

type Filter = 'ready' | 'applied' | 'conflict' | 'missing' | 'all';
const PAGE_SIZE = 20;
const STATE_LABEL: Record<CorrectionGroup['state'], string> = { ready: '검토 대기', applied: '반영됨', conflict: '저장값이 달라짐', missing: '문제은행에 없음' };

/** Shared prefix/suffix split so the changed characters stand out; display only. */
export function diffParts(before: string, after: string): { prefix: string; removed: string; added: string; suffix: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { prefix: before.slice(0, start), removed: before.slice(start, before.length - end), added: after.slice(start, after.length - end), suffix: before.slice(before.length - end) };
}

function Change({ before, after, field }: { before: string | number | null; after: string | number; field?: string }) {
  if (field === 'examImage') return <p className="correction-change"><span className="correction-side">교정안</span>ZIP의 문제용 이미지(그림·보기 포함, 정답 없음)를 시험 화면에 연결합니다. 승인 전에 정답 미노출을 직접 확인하세요.</p>;
  if (typeof before !== 'string' || typeof after !== 'string') return <p className="correction-change"><del>{before ?? '없음'}번</del> → <ins>{after}번</ins></p>;
  const parts = diffParts(before, after);
  return <div className="correction-change"><p><span className="correction-side">현재</span>{parts.prefix}<del>{parts.removed}</del>{parts.suffix}</p><p><span className="correction-side">교정안</span>{parts.prefix}<ins>{parts.added}</ins>{parts.suffix}</p></div>;
}

export default function CorrectionReview({ questions, eligibleIds, file, onFile, onPropose, onReview }: {
  questions: Question[]; eligibleIds: ReadonlySet<string>; file: CorrectionFile | null; onFile: (file: CorrectionFile | null) => void;
  onPropose: (group: CorrectionGroup) => void; onReview: (question: Question) => void;
}) {
  const [filter, setFilter] = useState<Filter>('ready');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const groups = useMemo(() => file ? groupCorrections(file, questions) : [], [file, questions]);
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { ready: 0, applied: 0, conflict: 0, missing: 0, all: groups.length };
    for (const group of groups) result[group.state]++;
    return result;
  }, [groups]);
  const awaitingApproval = groups.filter((group) => group.state === 'applied' && group.question && !eligibleIds.has(group.questionId)).length;
  const rows = groups.filter((group) => filter === 'all' || group.state === filter);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) return;
    try { onFile(parseCorrectionFile(JSON.parse(await selected.text()))); setError(''); setPage(0); setFilter('ready'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  return <section className="page-content correction-page">
    <div className="page-heading"><div><span className="eyebrow">문제 관리</span><h1>교정안 검토</h1><p>원본 이미지와 대조해 만든 교정안 파일을 불러와 문항별로 확인합니다. 불러오기만으로는 아무것도 바뀌지 않으며, 원본 대조 화면에서 저장하거나 승인한 문항만 반영됩니다.</p></div><div className="heading-action"><label className="button primary file-button">교정안 파일 선택<input type="file" accept="application/json,.json" onChange={(event) => void selectFile(event)}/></label></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!file ? <div className="empty-state"><h2>불러온 교정안이 없습니다</h2><p>교정안 JSON 파일을 선택하세요. 파일은 이 기기 안에서만 읽습니다.</p></div> : <>
      <div className="correction-summary" role="status"><span>문항 <strong>{counts.all}</strong></span><span>교정 항목 <strong>{file.items.length}</strong></span><span>검토 대기 <strong>{counts.ready}</strong></span><span>반영됨 <strong>{counts.applied}</strong>{awaitingApproval > 0 && <> (승인 대기 {awaitingApproval})</>}</span><span>저장값이 달라짐 <strong>{counts.conflict}</strong></span><span>문제은행에 없음 <strong>{counts.missing}</strong></span><button type="button" className="text-button" onClick={() => onFile(null)}>목록 닫기</button></div>
      <div className="bank-tabs correction-tabs" role="group" aria-label="교정안 상태">{(['ready', 'applied', 'conflict', 'missing', 'all'] as Filter[]).map((id) => <button type="button" key={id} className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(0); }}>{id === 'all' ? '전체' : STATE_LABEL[id]}<span>{counts[id]}</span></button>)}</div>
      {visible.length ? <div className="correction-list">{visible.map((group) => {
        const question = group.question;
        const approved = Boolean(question && eligibleIds.has(group.questionId));
        return <article className="correction-card" key={group.questionId}>
          <header><strong>{group.originalId ?? group.questionId}{question?.book?.originalNumber != null && <> · 책 {question.book.originalNumber}번</>}</strong>{question && <span>{question.originalSubject}</span>}<span className={`status-pill ${group.state === 'applied' && approved ? 'verified' : 'pending'}`}>{group.state === 'applied' ? approved ? '반영·승인 완료' : '반영됨 · 승인 대기' : STATE_LABEL[group.state]}</span></header>
          {question && <p className="correction-prompt">{question.prompt}</p>}
          <ul>{(question ? group.items : []).map(({ item, state, current: saved }) => <li key={`${item.field}:${item.index ?? ''}`}><div className="correction-item-head"><b>{correctionLabel(item)}</b>{state !== 'ready' && <span>{state === 'applied' ? '반영됨' : '저장값이 교정안의 기준과 다름'}</span>}</div>{state === 'conflict' ? <div className="correction-change"><p><span className="correction-side">현재 저장값</span>{String(saved ?? '없음')}</p><p><span className="correction-side">교정안 기준</span>{String(item.before ?? '없음')}</p><p><span className="correction-side">교정안</span>{String(item.after)}</p></div> : <Change before={item.before} after={item.after} field={item.field}/>}{item.note && <small>{item.note}</small>}</li>)}</ul>
          {group.state === 'missing' && <p className="correction-note">이 기기의 문제은행에 해당 문항 ID가 없습니다. 교재를 가져온 기기에서 열어 주세요.</p>}
          {group.state === 'conflict' && <p className="correction-note">교정안을 만든 뒤 문항이 바뀌었습니다. 자동으로 덮어쓰지 않습니다. 원본 대조 화면에서 직접 확인하세요.</p>}
          <div className="correction-actions">{group.state === 'ready' && <button type="button" className="button primary" onClick={() => onPropose(group)}>원본과 대조하며 검토</button>}{question && group.state !== 'ready' && !approved && <button type="button" className="button outline" onClick={() => onReview(question)}>{question.book ? '원본 대조 검수 열기' : '문항 열기'}</button>}</div>
        </article>;
      })}</div> : <div className="empty-state"><h2>해당 상태의 교정안이 없습니다</h2><p>다른 상태 탭을 선택해 보세요.</p></div>}
      {pageCount > 1 && <div className="book-pagination"><button type="button" className="button outline" disabled={current === 0} onClick={() => setPage(current - 1)}>이전</button><span>{current + 1} / {pageCount}</span><button type="button" className="button outline" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>다음</button></div>}
    </>}
  </section>;
}
