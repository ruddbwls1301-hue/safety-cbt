import { useEffect, useRef, useState } from 'react';
import { getBookImage, saveBookImages } from './lib/db';
import { bookApprovalIssues } from './lib/bookData';
import { SUBJECTS } from './constants';
import type { Question } from './types';
import { BookStoredImage, bookExplanationText } from './BookImages';
import { randomBrowserId } from './lib/browserCrypto';
import { bookReviewFlagLabel } from './lib/bookReview';
import { symbolHints } from './lib/symbolReview';
import { SymbolHintList, SymbolPalette } from './SymbolPalette';

export type ProposalNote = { label: string; before: string; after: string; note?: string };

export default function BookReviewEditor({ question, questions, onClose, onSave, onApprove, proposal, proposalNotes, proposeCandidateImage = false }: { question: Question; questions: Question[]; proposal?: Question; proposeCandidateImage?: boolean; proposalNotes?: ProposalNote[]; onClose: () => void; onSave: (question: Question) => Promise<void>; onApprove: (question: Question) => Promise<void> }) {
  const [edited, setEdited] = useState<Question>(() => structuredClone(proposal ?? question));
  const [fullUrl, setFullUrl] = useState('');
  const [imageLoaded, setImageLoaded] = useState(false);
  const [examImageLoaded, setExamImageLoaded] = useState(false);
  const [candidateImageLoaded, setCandidateImageLoaded] = useState(false);
  const [referenceImageLoaded, setReferenceImageLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [crop, setCrop] = useState({ left: 0, top: 0, width: 100, height: 50 });
  const sourceImage = useRef<HTMLImageElement>(null);
  const form = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(edited) !== JSON.stringify(question);
  function requestClose() {
    if (busy) return;
    if (dirty && !window.confirm('저장하지 않은 수정 내용이 있습니다. 저장하지 않고 닫을까요?')) return;
    onClose();
  }
  const closeHandler = useRef(requestClose);
  closeHandler.current = requestClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); closeHandler.current(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const book = edited.book!;
  const allQuestions = questions.map((item) => item.id === edited.id ? edited : item);
  const explanationTarget = book.explanationRef ? allQuestions.find((item) => item.book?.datasetId === book.datasetId && item.book.originalId === book.explanationRef) : undefined;
  const explanationEvidenceReady = imageLoaded && (!book.explanationRef || Boolean(explanationTarget?.book?.reviewImageId && referenceImageLoaded));
  const issues = bookApprovalIssues({ ...edited, book: { ...book, review: { ...book.review, automatic: undefined } } }, allQuestions);
  useEffect(() => {
    let active = true; let created = '';
    if (!question.book?.reviewImageId) return;
    void getBookImage(question.book.reviewImageId).then((image) => {
      if (!active) return;
      if (!image || image.kind !== 'review') { setError('검수용 JPG 원본이 없습니다. ZIP을 다시 가져와 이미지 연결을 복원해 주세요.'); return; }
      created = URL.createObjectURL(image.blob); setFullUrl(created);
    }).catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; if (created) URL.revokeObjectURL(created); };
  }, [question.book]);
  function update(field: keyof Question, value: unknown) {
    setEdited((current) => ({ ...current, [field]: value, status: 'pending', book: { ...current.book!, review: {
      ...current.book!.review, automatic: undefined,
      ...(['prompt', 'choices', 'answer'].includes(field) ? { sourceCompared: false, flagsChecked: false } : {}),
      ...(field === 'explanation' ? { explanationChecked: false } : {}),
    } } }));
  }
  function check(field: keyof typeof book.review, value: boolean) { setEdited((current) => ({ ...current, status: 'pending', book: { ...current.book!, review: { ...current.book!.review, [field]: value } } })); }
  async function makeCrop() {
    const image = sourceImage.current;
    if (!image?.naturalWidth || !fullUrl) return;
    setBusy(true); setError('');
    try {
      if (!Object.values(crop).every(Number.isFinite) || crop.left < 0 || crop.top < 0 || crop.width <= 0 || crop.height <= 0 || crop.left + crop.width > 100 || crop.top + crop.height > 100) throw new Error('자르기 영역은 이미지 범위 안에서 지정해 주세요.');
      const canvas = document.createElement('canvas');
      const x = Math.round(image.naturalWidth * crop.left / 100); const y = Math.round(image.naturalHeight * crop.top / 100);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * crop.width / 100)); canvas.height = Math.max(1, Math.round(image.naturalHeight * crop.height / 100));
      const context = canvas.getContext('2d'); if (!context) throw new Error('이미지 자르기를 지원하지 않습니다.');
      context.drawImage(image, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('자른 이미지를 생성하지 못했습니다.')), 'image/png'));
      const id = `${book.reviewImageId}:exam:${randomBrowserId()}`;
      await saveBookImages([{ id, blob, kind: 'exam', createdAt: new Date().toISOString() }]);
      setEdited((current) => ({ ...current, status: 'pending', book: { ...current.book!, examImageId: id, review: { ...current.book!.review, automatic: undefined, examImageSafe: false } } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  // An image proposal links the archive's question-only image once both images are visible; the person still confirms it is answer-free.
  const candidateProposed = useRef(false);
  useEffect(() => {
    if (!proposeCandidateImage || candidateProposed.current || !candidateImageLoaded || !imageLoaded || book.examImageId) return;
    candidateProposed.current = true;
    void useCandidateImage();
  }, [proposeCandidateImage, candidateImageLoaded, imageLoaded, book.examImageId]);
  async function useCandidateImage() {
    if (!book.sourceQuestionImageId || !candidateImageLoaded) return;
    setBusy(true); setError('');
    try {
      const candidate = await getBookImage(book.sourceQuestionImageId);
      if (!candidate || candidate.kind !== 'candidate-exam' || !candidate.blob.size) throw new Error('문제용 원본 이미지를 찾지 못했습니다.');
      const id = `${book.sourceQuestionImageId}:exam:${randomBrowserId()}`;
      await saveBookImages([{ id, blob: candidate.blob, kind: 'exam', createdAt: new Date().toISOString() }]);
      setEdited((current) => ({ ...current, status: 'pending', book: { ...current.book!, examImageId: id, review: { ...current.book!.review, automatic: undefined, examImageSafe: false } } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  async function submit(approve: boolean) {
    setBusy(true); setError('');
    try { if (approve) await onApprove(edited); else await onSave(edited); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  if (!book?.source || !book.review || !Array.isArray(book.reviewFlags) || typeof book.reviewImageId !== 'string') return <div className="modal-backdrop"><section className="editor-modal"><div className="editor-header"><h2>교재 메타데이터 확인 필요</h2><button className="button outline" onClick={onClose}>닫기</button></div><div className="book-review-form"><p>불완전한 백업 문항을 검수 대기로 보존했습니다. 원본 교재 ZIP과 문항 ID를 대조해야 하므로 승인할 수 없습니다.</p><pre>{JSON.stringify(edited.book, null, 2)}</pre></div></section></div>;
  return <div className="modal-backdrop book-review-backdrop" role="presentation"><section className="book-review-modal" role="dialog" aria-modal="true" aria-labelledby="book-review-title"><header className="editor-header"><div><span className="eyebrow">교재 원본 대조 검수</span><h2 id="book-review-title">{book.originalId} · 책 {book.originalNumber}번</h2><p>{edited.originalSubject} · {book.examRound ? `${book.examRound.year}년 실전 ${book.examRound.round}회차` : '연도 미상 과목별 문항'} · {book.source.page}쪽</p></div><button className="button outline" disabled={busy} onClick={requestClose}>닫기</button></header>
    <div className="book-review-columns"><div className="book-review-source"><h3>검수용 전체 JPG · 정답과 해설 포함</h3><p>이 전체 이미지는 CBT 응시 화면에 표시하지 않습니다.</p>{fullUrl && <div className="book-source-image"><img ref={sourceImage} onLoad={() => setImageLoaded(true)} onError={() => { setImageLoaded(false); setError('원본 이미지를 표시하지 못했습니다. 승인 전에 이미지 파일을 확인해 주세요.'); }} src={fullUrl} alt="정답과 해설을 포함한 검수용 원본 JPG"/><div className="book-crop-outline" style={{ left: `${crop.left}%`, top: `${crop.top}%`, width: `${crop.width}%`, height: `${crop.height}%` }}/></div>}
      <div className="book-crop-controls">{book.sourceQuestionImageId && <><h3>ZIP의 문제용 이미지 · 응시 노출 전 확인 필요</h3><p>문제·보기가 모두 포함되고 정답·해설이 없는지 원본과 대조하세요. 확인 전에는 응시 중 표시하지 않습니다.</p><BookStoredImage imageId={book.sourceQuestionImageId} purpose="candidate-exam" onReady={setCandidateImageLoaded} alt="검수가 필요한 ZIP 문제용 이미지"/><button className="button outline" disabled={busy || !candidateImageLoaded || !imageLoaded} onClick={() => void useCandidateImage()}>이 이미지를 시험용 검수 대상으로 선택</button></>}<h3>시험용 이미지 · 문제와 보기만 선택</h3><p>녹색 영역에 정답 표시와 해설이 포함되지 않도록 직접 지정하세요. 다음 단·쪽이 이어 붙은 원본은 필요한 문제·보기 전체가 포함되는지 확인해야 합니다.</p><div className="editor-grid">{([['left', '왼쪽'], ['top', '위쪽'], ['width', '너비'], ['height', '높이']] as const).map(([key, label]) => <label key={key}>{label} (%)<input type="number" min={0} max={100} value={crop[key]} onChange={(event) => setCrop((current) => ({ ...current, [key]: Number(event.target.value) }))}/></label>)}</div><button className="button outline" disabled={busy || !imageLoaded} onClick={() => void makeCrop()}>선택 영역을 시험용 이미지로 저장</button>
      {book.examImageId && <><h4>CBT에 사용할 별도 이미지</h4><BookStoredImage imageId={book.examImageId} purpose="exam" onReady={setExamImageLoaded} alt="시험용으로 자른 이미지 미리보기"/><label className="book-check"><input type="checkbox" checked={book.review.examImageSafe} disabled={!examImageLoaded} onChange={(event) => check('examImageSafe', event.target.checked)}/>문제·보기 전체를 포함하고 정답·해설이 보이지 않는 것을 확인했습니다.</label><button className="text-button" onClick={() => setEdited((current) => ({ ...current, status: 'pending', book: { ...current.book!, examImageId: undefined, review: { ...current.book!.review, examImageSafe: false } } }))}>시험용 이미지 연결 해제</button></>}
      </div></div><div className="book-review-form" ref={form}><div className="book-metadata">{book.review?.automatic && <strong>자동 구조 검사 승인 · {new Date(book.review.automatic.checkedAt).toLocaleString('ko-KR')} · 원본 JPG 대조 승인과 구분됩니다.</strong>}<span>과목 번호 {book.subjectNo} · 빈도 {book.frequency ?? '미상'} · 정답 출처 {book.answerSource ?? '미상'}</span><span>원본 순서 {book.sourceOrder + 1} · 원본 텍스트 대조 표시 {book.textVerified ? '있음 (앱 승인과 별개)' : '없음'}</span>{book.bookNote && <p>{book.bookNote}</p>}<details><summary>보존한 페이지 위치와 원본 메타데이터</summary><pre>{JSON.stringify(book.rawRecord, null, 2)}</pre></details></div>
      {proposalNotes && proposalNotes.length > 0 && <div className="proposal-banner" role="note"><strong>교정안 {proposalNotes.length}건이 아래 입력 칸에 미리 적용되어 있습니다 · 아직 저장되지 않았습니다</strong><ul>{proposalNotes.map((note) => <li key={note.label}><b>{note.label}</b> <del>{note.before}</del> → <ins>{note.after}</ins>{note.note && <small> · {note.note}</small>}</li>)}</ul><small>왼쪽 원본 이미지와 대조해 맞으면 확인란을 체크하고 승인하세요. 다르면 직접 고치거나 닫으면 됩니다.</small></div>}
      <SymbolPalette scope={form}/><SymbolHintList hints={symbolHints(edited)}/>
      <label>문제 지문<textarea rows={5} data-symbol-field="문제 지문" value={edited.prompt} onChange={(event) => update('prompt', event.target.value)}/></label><fieldset className="book-choices"><legend>보기 · 정답은 원본 JPG에서 대조</legend>{[0, 1, 2, 3].map((index) => <label key={index}><span>{index + 1}</span><textarea rows={2} data-symbol-field={`보기 ${index + 1}`} aria-label={`보기 ${index + 1} 내용`} value={edited.choices[index] ?? ''} onChange={(event) => update('choices', [0, 1, 2, 3].map((position) => position === index ? event.target.value : edited.choices[position] ?? ''))}/><input type="radio" name="book-answer" checked={edited.answer === index + 1} aria-label={`${index + 1}번 정답`} onChange={() => update('answer', index + 1)}/></label>)}</fieldset>
      <label>해설<textarea rows={5} data-symbol-field="해설" value={edited.explanation} onChange={(event) => update('explanation', event.target.value)}/></label><label>해설 참조 · 원본 문항 ID<input value={book.explanationRef ?? ''} placeholder="예: s2-220" onChange={(event) => { setReferenceImageLoaded(false); setEdited((current) => ({ ...current, status: 'pending', book: { ...current.book!, explanationRef: event.target.value.trim() || null, review: { ...current.book!.review, explanationChecked: false } } })); }}/></label>{book.explanationRef && <div className="book-reference-preview"><strong>참조 해설 미리보기 · 검수용 전체 원본</strong><p>{bookExplanationText(edited, allQuestions)}</p>{explanationTarget?.book?.reviewImageId ? <BookStoredImage key={book.explanationRef} imageId={explanationTarget.book.reviewImageId} purpose="review" onReady={setReferenceImageLoaded} alt={`${book.explanationRef} 해설 참조 검수용 원본 이미지`}/> : <p className="form-error">참조 대상 문항의 원본 이미지가 없어 해설을 확인할 수 없습니다.</p>}</div>}
      <label>2027 개정 과목 · 직접 확인한 경우만 선택<select value={edited.currentSubject ?? ''} onChange={(event) => update('currentSubject', event.target.value || undefined)}><option value="">미분류</option>{SUBJECTS.revised.map((value) => <option key={value}>{value}</option>)}</select></label>
      {book.reviewFlags.length > 0 && <div className="book-flags"><strong>원본 reviewFlags 보존 · 코드는 그대로 보관</strong>{book.reviewFlags.map((flag) => <div className="book-flag-row" key={flag}><code>{flag}</code><span>{bookReviewFlagLabel(flag)}</span></div>)}</div>}
      <label className="book-check"><input type="checkbox" checked={book.review.sourceCompared} disabled={!imageLoaded} onChange={(event) => check('sourceCompared', event.target.checked)}/>JPG 원본과 지문·보기·정답 번호를 직접 대조했습니다.</label><label className="book-check"><input type="checkbox" checked={book.review.flagsChecked} onChange={(event) => check('flagsChecked', event.target.checked)}/>검수 플래그의 수식·기호·번호·보기 항목을 확인하고 필요한 수정을 마쳤습니다.</label><label className="book-check"><input type="checkbox" checked={book.review.explanationChecked} disabled={!explanationEvidenceReady} onChange={(event) => check('explanationChecked', event.target.checked)}/>해설을 원본과 대조했습니다{book.explanationRef ? ' · 참조 문항의 원본 이미지까지 확인했습니다' : ''}.</label>
      {issues.length > 0 && <div className="book-review-issues"><strong>승인 전에 확인할 항목 {issues.length}개</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}{error && <p className="form-error" role="alert">{error}</p>}
      <div className="editor-footer">{dirty && <span className="unsaved-note" role="status">저장하지 않은 수정 있음 · 저장하면 검수 대기로 돌아갑니다</span>}<button className="button outline" disabled={busy} onClick={() => void submit(false)}>검수 대기로 저장</button><button className="button primary" disabled={busy || !imageLoaded || (Boolean(book.examImageId) && !examImageLoaded) || issues.length > 0} onClick={() => void submit(true)}>확인 후 문제은행 승인</button></div>
    </div></div>
  </section></div>;
}
