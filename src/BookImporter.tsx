import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { BookImage, BookImportManifest, Question } from './types';
import { LOCAL_SERVER_FEATURES } from './lib/runtimeFlags';
import { commitBookImport, getBookImage, getQuestions, saveQuestions, saveBookImages, saveBookImportManifest } from './lib/db';
import { BOOK_DATASET_ID, autoApproveBookQuestions, bookApprovalIssues, bookReviewImagePath, bookQuestionImagePath, convertBookData, isBookQuestionEligible } from './lib/bookData';
import { inspectBookArchive, readBookImage, type BookArchive } from './lib/bookArchive';
import { SUBJECTS } from './constants';
import { bookRoundKey, bookRoundLabel, BOOK_EXAM_ROUNDS } from './lib/bookSelection';
import { randomBrowserId, sha256Hex } from './lib/browserCrypto';
import { bookReviewIssueMatches, bookReviewStatusMatches, type BookReviewIssueFilter, type BookReviewStatusFilter } from './lib/bookReview';

export default function BookImporter({ questions, onImported, onReview }: { questions: Question[]; onImported: () => Promise<void>; onReview: (question: Question) => void }) {
  const [archive, setArchive] = useState<BookArchive | null>(null);
  const [busy, setBusy] = useState<'inspect' | 'import' | null>(null);
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ added: number; skipped: number; approved: number } | null>(null);
  const [category, setCategory] = useState('subjects');
  const [subject, setSubject] = useState('all');
  const [reviewStatus, setReviewStatus] = useState<BookReviewStatusFilter>('needs-review');
  const [reviewIssue, setReviewIssue] = useState<BookReviewIssueFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [localBook, setLocalBook] = useState<{ name: string; size: number } | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!LOCAL_SERVER_FEATURES) return;
    const controller = new AbortController();
    void fetch('/__local-book/metadata', { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
      const value: unknown = await response.json();
      if (value && typeof value === 'object' && 'name' in value && 'size' in value && typeof value.name === 'string' && typeof value.size === 'number') setLocalBook({ name: value.name, size: value.size });
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const bookQuestions = questions.filter((question) => question.book?.datasetId === BOOK_DATASET_ID);
  const eligible = bookQuestions.filter((question) => isBookQuestionEligible(question, questions));
  const eligibleIds = new Set(eligible.map((question) => question.id));
  const needsReview = bookQuestions.length - eligible.length;
  const statusMismatch = bookQuestions.filter((question) => question.status === 'verified' && !eligibleIds.has(question.id)).length;
  const rows = bookQuestions.filter((question) => {
    const book = question.book!;
    return (category === 'all' || category === 'subjects' ? category === 'all' || book.section !== 'exam' : book.examRound && bookRoundKey(book.examRound) === category)
      && (subject === 'all' || book.subjectNo === Number(subject))
      && bookReviewStatusMatches(question, questions, reviewStatus, eligibleIds)
      && bookReviewIssueMatches(question, reviewIssue)
      && `${book.originalId} ${book.originalNumber} ${question.prompt}`.toLowerCase().includes(search.toLowerCase());
  }).sort((left, right) => left.book!.sourceOrder - right.book!.sourceOrder);
  const visibleRows = rows.slice(page * 30, (page + 1) * 30);
  const selectCategory = (value: string) => { setCategory(value); setPage(0); };

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await inspectFile(file);
  }
  async function inspectFile(file: File) {
    setBusy('inspect'); setArchive(null); setError(''); setResult(null);
    try {
      const prepared = await inspectBookArchive(file, setMessage);
      setArchive(prepared);
      setMessage('읽기 전용 검사가 끝났습니다. 전체 등록 버튼을 눌러야 저장·자동 검사가 실행됩니다.');
    } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); setMessage(''); }
    finally { setBusy(null); }
  }
  async function selectLocalBook() {
    if (!localBook || busy || !LOCAL_SERVER_FEATURES) return;
    setBusy('inspect'); setArchive(null); setError(''); setResult(null); setMessage('이 컴퓨터의 원본 ZIP을 불러오는 중 · 외부 업로드 없음');
    try {
      const response = await fetch('/__local-book/archive', { cache: 'no-store' });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/zip')) throw new Error('로컬 교재 파일을 불러오지 못했습니다. ZIP 선택 버튼으로 원본 파일을 선택해 주세요.');
      const blob = await response.blob();
      await inspectFile(new File([blob], localBook.name, { type: 'application/zip' }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(null); }
  }
  async function importArchive(automatic = false) {
    if (!archive || busy || archive.report.fatalErrors.length || archive.report.missingImages.length) return;
    cancelled.current = false; setBusy('import'); setError(''); setResult(null);
    let manifest: BookImportManifest | undefined;
    let committed = false;
    try {
      setMessage('검사한 ZIP과 현재 원본이 같은지 확인 중');
      const hash = await sha256Hex(await archive.file.arrayBuffer());
      if (hash !== archive.sha256) throw new Error('ZIP 내용이 검사 후 변경되었습니다. 파일을 다시 선택해 사전 검사해 주세요.');
      if (cancelled.current) throw new Error('가져오기를 중지했습니다.');
      const converted = convertBookData(archive.parsed);
      const imagePaths = new Map<string, { path: string; kind: BookImage['kind'] }>();
      for (const question of converted) {
        imagePaths.set(question.book!.reviewImageId, { path: bookReviewImagePath(question.book!.rawRecord), kind: 'review' });
        if (question.book!.sourceQuestionImageId) imagePaths.set(question.book!.sourceQuestionImageId, { path: bookQuestionImagePath(question.book!.rawRecord), kind: 'candidate-exam' });
      }
      manifest = { importId: randomBrowserId(), archiveName: archive.file.name, archiveHash: archive.sha256, sourceMeta: (archive.parsed as { meta?: unknown }).meta ?? null, counts: { total: converted.length, added: 0, skipped: 0, images: imagePaths.size }, status: 'staging', createdAt: new Date().toISOString() };
      await saveBookImportManifest(manifest);
      setProgress({ done: 0, total: imagePaths.size });
      let images: BookImage[] = [];
      let done = 0;
      for (const [id, image] of imagePaths) {
        if (cancelled.current) throw new Error('가져오기를 중지했습니다. 문항 등록 전이며 저장된 이미지는 재시도할 때 재사용됩니다.');
        images.push({ id, blob: await readBookImage(archive, image.path), kind: image.kind, createdAt: manifest.createdAt });
        if (images.length === 20 || done + images.length === imagePaths.size) {
          await saveBookImages(images);
          done += images.length; images = [];
          setProgress({ done, total: imagePaths.size });
          setMessage(`교재 JPG 저장 ${done.toLocaleString()} / ${imagePaths.size.toLocaleString()} · 아직 문항을 등록하지 않았습니다`);
        }
      }
      if (cancelled.current) throw new Error('문항 등록 전에 가져오기를 중지했습니다.');
      setMessage('이미지 연결 확인 후 검수 대기 문항 등록 중');
      setCommitting(true);
      const imported = await commitBookImport(converted, manifest);
      committed = true;
      let approved = 0;
      if (automatic) {
        setMessage('전체 문항 등록 완료 · 자동 승인 조건과 원본 이미지 연결을 검사하는 중');
        try {
          const bank = await getQuestions();
          const existingIds = new Set(questions.map((question) => question.id));
          const newIds = new Set(converted.filter((question) => !existingIds.has(question.id)).map((question) => question.id));
          const checked = autoApproveBookQuestions(bank, archive.sha256);
          const safe: Question[] = [];
          for (const question of checked.approved) {
            if (!newIds.has(question.id)) continue;
            const image = await getBookImage(question.book!.reviewImageId);
            if (!image || image.kind !== 'review' || !image.blob.size) continue;
            safe.push(question);
          }
          await saveQuestions(safe);
          approved = safe.length;
        } catch (reason) { setError(`문항 등록은 완료했습니다. 자동 승인 저장 실패로 검수 대기를 유지합니다: ${String(reason)}`); }
      }
      setResult({ ...imported, approved });
      try { await onImported(); } catch { setError('문항 등록은 완료했지만 화면을 갱신하지 못했습니다. 페이지를 새로고침해 주세요.'); }
      setMessage(`${imported.added.toLocaleString()}문항 등록 · 자동 승인 ${approved.toLocaleString()}문항 · 기존 ${imported.skipped.toLocaleString()}문항은 수정·검수 상태를 보존했습니다.`);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      setError(detail);
      if (manifest && !committed) await saveBookImportManifest({ ...manifest, status: 'failed', error: detail }).catch(() => undefined);
    } finally { setBusy(null); setCommitting(false); }
  }
  const report = archive?.report;
  return <section className="page-content book-import-page">
    <div className="page-heading"><div><span className="eyebrow">책 목차 그대로 · 로컬 저장</span><h1>교재 ZIP 가져오기</h1><p>6과목별 학습과 책의 세 실전 회차를 원래 번호와 순서로 보존합니다.</p></div></div>
    <div className="book-callout"><strong>먼저 읽기 전용 검사</strong><p>ZIP 원본과 기존 학습기록을 수정하지 않습니다. JPG는 기기에 Blob으로 저장하며, 정답이 있는 전체 원본은 검수 화면 또는 학습 중 정답을 확인한 뒤에만 표시합니다. 이 ZIP에는 PDF가 없어 OCR을 실행하지 않습니다.</p><p>현재 브라우저의 이 사이트 주소에 저장됩니다. 다른 기기·브라우저·주소에서는 교재를 각각 가져와야 합니다.</p></div>
    <div className="panel book-import-card"><div className="book-card-title"><h2>교재 데이터 선택</h2><span>산업안전기사_CBT_data.zip</span></div><label className={`button outline file-button ${busy ? 'disabled' : ''}`}>ZIP 선택 · 사전 검사<input type="file" accept=".zip" disabled={Boolean(busy)} onChange={(event) => void selectFile(event)}/></label>
      {localBook && <div className="book-import-action"><button className="button outline" disabled={Boolean(busy)} onClick={() => void selectLocalBook()}>Mac에 저장된 교재 불러오기</button><span>{localBook.name} · 외부 업로드 없이 읽기 전용 검사</span></div>}
      {busy && <p role="status">{message}</p>}{!busy && message && <p className="book-status" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      {archive && report && <div className="book-preflight"><div className="book-file-info"><strong>{archive.file.name}</strong><span>{(archive.file.size / 1024 / 1024).toFixed(1)} MB · questions.json 자동 탐색</span><details><summary>검사한 원본 SHA-256</summary><code>{archive.sha256}</code></details></div>
        <div className="book-count-columns"><div><h3>연도 미상 · 과목별 {report.unknownYears.toLocaleString()}문항</h3>{report.subjects.map((item) => <div className="book-count-row" key={item.subjectNo}><span>{item.subjectNo}. {item.subject}</span><strong>{item.count.toLocaleString()}</strong></div>)}</div><div><h3>책에 명시된 실전 회차</h3>{report.exams.map((item) => <div className="book-count-row" key={item.round}><span>{item.year}년 실전 {item.round}회차</span><strong>{item.count}</strong></div>)}<p className="book-small-note">2022년도 연습으로 선택합니다. 결번을 채우거나 번호를 다시 붙이지 않습니다.</p></div></div>
        <div className="book-quality-grid">{[['전체 문항', report.total], ['검수 플래그', report.flags], ['보기 빈칸', report.blankChoices], ['그림 보기', report.graphics], ['문제 그림·표', report.questionImages], ['수식 확인', report.formula], ['해설 참조 오류', report.referenceErrors], ['해설 내용 확인', report.missingExplanations], ['연결 이미지', report.imageCount]].map(([label, count]) => <div key={label}><span>{label}</span><strong>{Number(count).toLocaleString()}</strong></div>)}</div>
        <p>원본 ID 중복 {report.duplicateIds.length}건 · 누락 이미지 {report.missingImages.length}건 · 추가 확인 문항 {report.invalid.length}건</p>
        {report.questionImageCandidates > 0 && <p>문제용 후보 이미지 {report.questionImageCandidates.toLocaleString()}개를 해설용 원본과 분리해 저장합니다. 정답 미노출 검수 전에는 응시 화면에 표시하지 않습니다.</p>}
        {report.fatalErrors.length > 0 && <ul className="form-error">{report.fatalErrors.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
        <details><summary>검수 플래그와 참조·메타데이터 검사 내역</summary><ul>{Object.entries(report.flagCounts).map(([flag, count]) => <li key={flag}>{flag}: {count}문항</li>)}{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>{report.invalid.slice(0, 40).map((row) => <p key={`${row.originalId}:${row.index}`}><code>{row.originalId}</code> · {row.issues.join(' / ')}</p>)}{report.invalid.length > 40 && <p>앞의 40건만 표시합니다. 가져온 뒤 문항별 검수 화면에서 전체를 확인할 수 있습니다.</p>}</details>
        <details><summary>보존할 도서 메모</summary><pre>{JSON.stringify((archive.parsed as { meta?: { bookNotes?: unknown } }).meta?.bookNotes ?? [], null, 2)}</pre></details>
        <div className="book-import-action"><button className="button primary" disabled={Boolean(busy) || report.fatalErrors.length > 0 || report.missingImages.length > 0} onClick={() => void importArchive(true)}>전체 {report.total.toLocaleString()}문항 등록 · 자동 검사 후 승인</button><span>그림·수식·내용 누락·불확실한 분류는 검수 대기 · 기존 문항과 검수 상태 보존</span></div>
      </div>}
      {busy === 'import' && <div className="book-progress"><progress value={progress.done} max={progress.total || 1}/><button className="button outline" disabled={committing} onClick={() => { cancelled.current = true; }}>가져오기 중지</button></div>}
      {result && <p className="book-small-note">신규 등록 {result.added} · 자동 승인 {result.approved} · 기존 유지 {result.skipped} · 남은 문항은 검수 대기입니다.</p>}
    </div>
    <div className="panel book-import-card"><div className="book-card-title"><h2>기기에 가져온 교재 문항</h2><span>등록 {bookQuestions.length.toLocaleString()} · CBT 출제 가능 {eligible.length.toLocaleString()}</span></div><div className="book-review-totals"><span>검수 필요 <strong>{needsReview.toLocaleString()}</strong></span><span>원본 상태가 승인이나 출제 제외 <strong>{statusMismatch.toLocaleString()}</strong></span><span>검수 완료·출제 가능 <strong>{eligible.length.toLocaleString()}</strong></span></div><p>출제 가능 여부는 실제 CBT 승인 조건으로 계산합니다. 저장된 상태값이 승인이라도 조건을 통과하지 못하면 검수 대기에 표시하며, 저장된 상태는 바꾸지 않습니다.</p>
      <div className="book-review-filters"><label>책 목차<select value={category} onChange={(event) => selectCategory(event.target.value)}><option value="subjects">연도 미상 · 6과목별 학습</option>{BOOK_EXAM_ROUNDS.map((round) => <option key={round.round} value={bookRoundKey(round)}>{bookRoundLabel(round)}</option>)}<option value="all">교재 전체</option></select></label><label>과목<select value={subject} onChange={(event) => { setSubject(event.target.value); setPage(0); }}><option value="all">전체 과목</option>{SUBJECTS.legacy.map((label, index) => <option key={label} value={index + 1}>{index + 1}. {label}</option>)}</select></label><label>검수 상태<select value={reviewStatus} onChange={(event) => { setReviewStatus(event.target.value as BookReviewStatusFilter); setPage(0); }}><option value="needs-review">검수 필요 · {needsReview}</option><option value="eligible">출제 가능 · {eligible.length}</option><option value="all">전체</option></select></label><label>확인 항목<select value={reviewIssue} onChange={(event) => { setReviewIssue(event.target.value as BookReviewIssueFilter); setPage(0); }}><option value="all">모든 확인 항목</option><option value="visual">그림·보기 이미지</option><option value="formula">수식</option><option value="flags">원본 검수 플래그</option><option value="explanation">해설·참조</option><option value="metadata">번호·분류·출처 메타데이터</option><option value="symbol">기호·오탈자 의심</option></select></label><label>문항 검색<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="원본 ID·번호·지문"/></label></div>
      {visibleRows.length ? <div className="book-review-list">{visibleRows.map((question) => { const canPractice = eligibleIds.has(question.id); return <button key={question.id} onClick={() => onReview(question)}><div><strong>{question.book!.originalId} · 책 {question.book!.originalNumber}번</strong><span>{question.originalSubject} · {question.book!.source?.page ?? '미상'}쪽 · {canPractice ? question.book?.review?.automatic ? '자동 검사 승인 · CBT 출제 가능' : '원본 대조 승인 · CBT 출제 가능' : question.status === 'verified' ? '승인 상태 · 현재 승인 조건 미충족 · CBT 제외' : '검수 대기 · CBT 제외'}</span><p>{question.prompt}</p></div><small>{bookApprovalIssues(question, questions).length}개 확인 →</small></button>; })}</div> : <p className="book-empty">선택한 목차와 검수 조건에 맞는 문항이 없습니다. 다른 필터를 선택해 주세요.</p>}
      {rows.length > 30 && <div className="book-pagination"><button className="button outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>이전</button><span>{page + 1} / {Math.ceil(rows.length / 30)} · {rows.length}문항</span><button className="button outline" disabled={(page + 1) * 30 >= rows.length} onClick={() => setPage((value) => value + 1)}>다음</button></div>}
    </div>
  </section>;
}
