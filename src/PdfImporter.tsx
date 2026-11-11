import { useEffect, useMemo, useRef, useState } from 'react';
import { approvePdfDraft, createPdfImport, deletePdfImport, getPdfDrafts, getPdfFile, getPdfPageTexts, getPdfSources, restartPdfImport, savePdfDraft, savePdfPage, savePdfSource } from './lib/db';
import { draftIssues, inspectPdf, processPdfSource, promptSimilarity, renderPdfPage } from './lib/pdfImport';
import { makeId } from './lib/questions';
import { SUBJECTS } from './constants';
import type { PdfDraft, PdfPageText, PdfSource, Question } from './types';

type Props = {
  questions: Question[];
  onQuestionApproved: (question: Question) => void;
};

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function PdfImporter({ questions, onQuestionApproved }: Props) {
  const [sources, setSources] = useState<PdfSource[]>([]);
  const [drafts, setDrafts] = useState<PdfDraft[]>([]);
  const [pageTexts, setPageTexts] = useState<PdfPageText[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedDraftId, setSelectedDraftId] = useState('');
  const [selectedPageNumber, setSelectedPageNumber] = useState(0);
  const [editDraft, setEditDraft] = useState<PdfDraft>();
  const [file, setFile] = useState<File>();
  const [filePageCount, setFilePageCount] = useState(0);
  const [pageStart, setPageStart] = useState('1');
  const [pageEnd, setPageEnd] = useState('1');
  const [defaultSubject, setDefaultSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ page: 0, ocr: 0, status: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState<{ x: number; y: number; width: number; height: number }>();
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const selectedSource = sources.find((source) => source.id === selectedSourceId);
  const selectedSourceKey = selectedSource?.id;
  const selectedSourcePageStart = selectedSource?.pageStart;
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId);
  const activeDraft = editDraft?.id === selectedDraftId ? editDraft : selectedDraft;
  const activePageNumber = activeDraft?.sourcePage ?? (selectedPageNumber || selectedSource?.pageStart || 1);
  const activePageText = pageTexts.find((item) => item.sourcePage === activePageNumber);
  const selectedDraftIndex = drafts.findIndex((draft) => draft.id === selectedDraftId);
  const issues = activeDraft ? draftIssues(activeDraft, Boolean(activeDraft.duplicateOf)) : [];
  const blockingIssues = issues.filter((issue) => !['OCR 신뢰도 낮음', '중복 의심'].includes(issue));
  const sourceDrafts = useMemo(() => drafts.filter((draft) => draft.sourceId === selectedSourceId), [drafts, selectedSourceId]);
  const pendingCount = sourceDrafts.filter((draft) => draft.status === 'pending').length;
  const questionCount = sourceDrafts.length;

  useEffect(() => {
    void reloadSources();
  }, []);

  useEffect(() => {
    if (!selectedSourceKey || activePageNumber < (selectedSourcePageStart ?? 1)) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const controller = new AbortController();
    setCrop(undefined);
    setCropMode(false);
    void getPdfFile(selectedSourceKey).then((blob) => {
      if (!blob) throw new Error('저장된 PDF 원본을 찾지 못했습니다.');
      if (!cancelled) return renderPdfPage(blob, activePageNumber, canvas, 760, controller.signal);
      return undefined;
    }).catch((reason) => {
      if (!cancelled) setError(`원본 페이지를 표시하지 못했습니다. ${String(reason)}`);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [selectedSourceKey, selectedSourcePageStart, activePageNumber, activePageText?.id]);

  async function reloadSources(keepId = selectedSourceId) {
    const saved = await getPdfSources();
    saved.sort((left, right) => right.importedAt.localeCompare(left.importedAt));
    setSources(saved);
    const nextId = saved.some((source) => source.id === keepId) ? keepId : saved[0]?.id ?? '';
    setSelectedSourceId(nextId);
    if (nextId) await selectSource(nextId);
    else { setDrafts([]); setSelectedDraftId(''); setEditDraft(undefined); }
  }

  async function selectSource(id: string) {
    setSelectedSourceId(id);
    const rows = await getPdfDrafts(id);
    const pageRows = await getPdfPageTexts(id);
    rows.sort((left, right) => left.sourcePage - right.sourcePage || left.sequence - right.sequence);
    setDrafts(rows);
    setPageTexts(pageRows);
    setSelectedPageNumber(rows[0]?.sourcePage ?? pageRows[0]?.sourcePage ?? sources.find((source) => source.id === id)?.pageStart ?? 1);
    const current = rows.find((draft) => draft.id === selectedDraftId) ?? rows[0];
    setSelectedDraftId(current?.id ?? '');
    setEditDraft(current ? { ...current, choices: [...current.choices] as PdfDraft['choices'] } : undefined);
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    setError('');
    setMessage('');
    if (!chosen) return;
    if (chosen.type !== 'application/pdf' && !chosen.name.toLowerCase().endsWith('.pdf')) {
      setError('PDF 파일만 가져올 수 있습니다.');
      return;
    }
    if (chosen.size > 250 * 1024 * 1024) {
      setError('250MB 이하 PDF를 선택해 주세요. 큰 파일은 페이지를 나눠 저장하는 것을 권장합니다.');
      return;
    }
    setBusy(true);
    try {
      const count = await inspectPdf(chosen);
      setFile(chosen);
      setFilePageCount(count);
      setPageStart('1');
      setPageEnd(String(count));
      setDefaultSubject('');
    } catch (reason) {
      setError(`PDF를 열 수 없습니다. 암호화되었거나 손상된 파일인지 확인해 주세요. ${String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function beginImport(existing?: PdfSource) {
    setError('');
    setMessage('');
    let source = existing;
    if (!source) {
      if (!file) return;
      const from = Number(pageStart);
      const to = Number(pageEnd);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > filePageCount) {
        setError(`페이지 범위를 1~${filePageCount} 안에서 확인해 주세요.`);
        return;
      }
      const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
      const free = estimate?.quota && estimate.usage !== undefined ? estimate.quota - estimate.usage : undefined;
      if (free !== undefined && free < file.size * 1.1 && !window.confirm('브라우저 저장 공간이 부족할 수 있습니다. PDF 저장이 실패해도 기존 문제와 학습 기록은 유지됩니다. 계속할까요?')) return;
      source = {
        id: makeId(), name: file.name, size: file.size, pageCount: filePageCount,
        pageStart: from, pageEnd: to, lastProcessedPage: from - 1, importedAt: new Date().toISOString(),
        status: 'processing', defaultYear: null, defaultRound: '',
        defaultOriginalSubject: defaultSubject,
      };
      try {
        await createPdfImport(source, file);
      } catch (reason) {
        setError(`PDF 원본을 로컬에 저장하지 못했습니다. 저장 공간을 확인해 주세요. 기존 학습 데이터는 변경되지 않았습니다. ${String(reason)}`);
        return;
      }
      setFile(undefined);
      setSources((rows) => [source!, ...rows]);
      setSelectedSourceId(source.id);
      setSelectedPageNumber(source.pageStart);
      setDrafts([]);
      setPageTexts([]);
      setSelectedDraftId('');
      setEditDraft(undefined);
    }
    await runProcessing(source);
  }

  async function runProcessing(initialSource: PdfSource) {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    setProgress({ page: initialSource.lastProcessedPage, ocr: 0, status: 'PDF를 여는 중' });
    let source: PdfSource = { ...initialSource, status: 'processing' };
    delete source.error;
    await savePdfSource(source);
    setSources((rows) => rows.map((item) => item.id === source.id ? source : item));
    try {
      const blob = await getPdfFile(source.id);
      if (!blob) throw new Error('저장된 PDF 원본을 찾지 못했습니다.');
      const priorDrafts = await getPdfDrafts();
      const candidates = [
        ...questions.map((question) => ({ id: question.id, prompt: question.prompt })),
        ...priorDrafts.map((draft) => ({ id: draft.id, prompt: draft.prompt })),
      ];
      await processPdfSource(source, blob, {
        signal: controller.signal,
        onOcrProgress: (ocr, status) => setProgress((current) => ({ ...current, ocr, status })),
        onPage: async (page, found, pageText) => {
          const augmented = found.map((draft) => {
            let duplicate: { id: string; similarity: number } | undefined;
            for (const candidate of candidates) {
              const similarity = promptSimilarity(draft.prompt, candidate.prompt);
              if (similarity >= 0.88 && (!duplicate || similarity > duplicate.similarity)) duplicate = { id: candidate.id, similarity };
            }
            const next = { ...draft, ...(duplicate ? { duplicateOf: duplicate.id } : {}) };
            next.issues = draftIssues(next, Boolean(duplicate));
            candidates.push({ id: next.id, prompt: next.prompt });
            return next;
          });
          source = { ...source, lastProcessedPage: page };
          await savePdfPage(source, augmented, pageText);
          setProgress({ page, ocr: 1, status: '페이지 저장 완료' });
          setSources((rows) => rows.map((item) => item.id === source.id ? source : item));
          setDrafts((rows) => {
            const byId = new Map(rows.map((draft) => [draft.id, draft]));
            for (const draft of augmented) byId.set(draft.id, draft);
            return [...byId.values()].sort((left, right) => left.sourcePage - right.sourcePage || left.sequence - right.sequence);
          });
          setPageTexts((rows) => [...rows.filter((item) => item.sourcePage !== page), pageText].sort((left, right) => left.sourcePage - right.sourcePage));
          if (!selectedDraftId && augmented[0]) {
            setSelectedDraftId(augmented[0].id);
            setEditDraft(augmented[0]);
          }
        },
      });
      source = { ...source, status: 'complete', lastProcessedPage: source.pageEnd };
      await savePdfSource(source);
      const savedDrafts = await getPdfDrafts(source.id);
      setMessage(`PDF 처리가 끝났습니다. ${initialSource.pageStart}~${initialSource.pageEnd}쪽에서 ${savedDrafts.length}개 문항을 저장했습니다.`);
    } catch (reason) {
      source = { ...source, status: 'failed', error: String(reason) };
      await savePdfSource(source).catch(() => undefined);
      setError(`PDF 처리 중 문제가 생겼습니다. 저장한 페이지까지는 보존했으며 이어서 처리할 수 있습니다. ${String(reason)}`);
    } finally {
      abortRef.current = undefined;
      setBusy(false);
      await reloadSources(initialSource.id);
    }
  }

  function cancelImport() {
    abortRef.current?.abort();
  }

  async function restartSelectedSource() {
    if (!selectedSource) return;
    if (questions.some((question) => question.sourceDocumentId === selectedSource.id)) {
      setError('승인된 문항이 연결된 PDF는 처음부터 다시 처리할 수 없습니다.');
      return;
    }
    if (!window.confirm(`“${selectedSource.name}”에서 저장된 검수 대기 추출 결과를 지우고 ${selectedSource.pageStart}쪽부터 다시 처리할까요? PDF 원본, 승인 문제와 학습 기록은 유지됩니다.`)) return;
    try {
      const reset = await restartPdfImport(selectedSource.id);
      await reloadSources(reset.id);
      await runProcessing(reset);
    } catch (reason) {
      setError(`PDF 재처리를 시작하지 못했습니다. 저장한 초안은 유지됩니다. ${String(reason)}`);
    }
  }

  async function removeSelectedSource() {
    if (!selectedSource) return;
    if (questions.some((question) => question.sourceDocumentId === selectedSource.id)) {
      setError('승인 문항이 원본 PDF를 참조하고 있어 삭제를 막았습니다. 문제은행의 원본 연결을 먼저 확인해 주세요.');
      return;
    }
    if (!window.confirm(`“${selectedSource.name}” 원본 PDF와 이 문서의 추출 초안을 이 기기에서 삭제할까요? 기존 문제은행과 학습 기록은 유지됩니다.`)) return;
    try {
      await deletePdfImport(selectedSource.id);
      setMessage('선택한 PDF 원본과 검수 초안을 삭제했습니다. 기존 문제와 학습 기록은 유지했습니다.');
      await reloadSources('');
    } catch (reason) {
      setError(`PDF를 삭제하지 못했습니다. ${String(reason)}`);
    }
  }

  async function saveCurrentDraft() {
    if (!activeDraft) return;
    const next = { ...activeDraft, issues: draftIssues(activeDraft, Boolean(activeDraft.duplicateOf)) };
    await savePdfDraft(next);
    setDrafts((rows) => rows.map((draft) => draft.id === next.id ? next : draft));
    setEditDraft(next);
    setMessage('검수 내용을 이 기기에 저장했습니다. 아직 CBT 문제은행에는 등록되지 않았습니다.');
    setError('');
  }

  async function approveCurrentDraft() {
    if (!activeDraft || !selectedSource) return;
    const next = { ...activeDraft, issues: draftIssues(activeDraft, Boolean(activeDraft.duplicateOf)) };
    const blocked = next.issues.filter((issue) => !['OCR 신뢰도 낮음', '중복 의심'].includes(issue));
    if (blocked.length) {
      setError(`승인 전에 확인해 주세요: ${blocked.join(' · ')}`);
      return;
    }
    if (next.duplicateOf && !window.confirm('기존 문항과 중복될 가능성이 있습니다. 원문과 정답을 확인했고 별도 문항으로 등록할까요?')) return;
    const question: Question = {
      id: makeId(), year: next.year, round: next.round.trim(), originalSubject: next.originalSubject,
      ...(next.currentSubject ? { currentSubject: next.currentSubject } : {}), prompt: next.prompt.trim(),
      choices: next.choices.map((choice) => choice.trim()), answer: next.answer!, explanation: next.explanation.trim(),
      status: 'verified', source: selectedSource.name, sourcePage: next.sourcePage, sourceDocumentId: selectedSource.id,
      ...(next.imageDataUrl ? { imageDataUrl: next.imageDataUrl } : {}), ...(next.duplicateOf ? { duplicateOf: next.duplicateOf } : {}), createdAt: new Date().toISOString(),
    };
    try {
      await savePdfDraft(next);
      await approvePdfDraft(question, next.id);
      setDrafts((rows) => rows.map((draft) => draft.id === next.id ? { ...next, status: 'verified' } : draft));
      setEditDraft({ ...next, status: 'verified' });
      onQuestionApproved(question);
      setMessage(`문제은행에 승인 등록했습니다. 원본 ${selectedSource.name} ${next.sourcePage}쪽`);
      setError('');
    } catch (reason) {
      setError(`승인 등록에 실패했습니다. 검수 결과는 대기 상태로 유지됩니다. ${String(reason)}`);
    }
  }

  function selectDraft(draft: PdfDraft) {
    setSelectedDraftId(draft.id);
    setSelectedPageNumber(draft.sourcePage);
    setEditDraft({ ...draft, choices: [...draft.choices] as PdfDraft['choices'] });
    setError('');
    setCrop(undefined);
  }

  async function createManualDraft() {
    if (!selectedSource || !activePageText) return;
    const draft: PdfDraft = {
      id: `${selectedSource.id}:${activePageNumber}:manual-${makeId()}`, sourceId: selectedSource.id,
      sourcePage: activePageNumber, sequence: drafts.filter((item) => item.sourcePage === activePageNumber).length + 1,
      questionNumber: null, year: null, round: '',
      originalSubject: selectedSource.defaultOriginalSubject, prompt: '', choices: ['', '', '', ''], answer: null,
      explanation: '', rawText: activePageText.text, confidence: activePageText.confidence,
      extractionMethod: activePageText.extractionMethod, status: 'pending', issues: [], createdAt: new Date().toISOString(),
    };
    draft.issues = draftIssues(draft);
    await savePdfDraft(draft);
    setDrafts((rows) => [...rows, draft]);
    setSelectedDraftId(draft.id);
    setEditDraft(draft);
    setMessage(`${activePageNumber}쪽에서 수동 검수 문항 초안을 만들었습니다.`);
  }

  function updateDraft<K extends keyof PdfDraft>(key: K, value: PdfDraft[K]) {
    setEditDraft((current) => current ? { ...current, [key]: value } : current);
  }

  function pointerPosition(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  }

  function startCrop(event: React.PointerEvent<HTMLDivElement>) {
    if (!cropMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    setDragStart(point);
    setCrop({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function moveCrop(event: React.PointerEvent<HTMLDivElement>) {
    if (!cropMode || !dragStart) return;
    const point = pointerPosition(event);
    setCrop({ x: Math.min(dragStart.x, point.x), y: Math.min(dragStart.y, point.y), width: Math.abs(dragStart.x - point.x), height: Math.abs(dragStart.y - point.y) });
  }

  function finishCrop(event: React.PointerEvent<HTMLDivElement>) {
    moveCrop(event);
    setDragStart(undefined);
  }

  function attachCrop() {
    const sourceCanvas = canvasRef.current;
    if (!sourceCanvas || !crop || crop.width < 0.02 || crop.height < 0.02) {
      setError('원본 페이지에서 이미지·표·수식 영역을 드래그해 선택해 주세요.');
      return;
    }
    const output = document.createElement('canvas');
    output.width = Math.round(sourceCanvas.width * crop.width);
    output.height = Math.round(sourceCanvas.height * crop.height);
    const context = output.getContext('2d');
    if (!context) return;
    context.drawImage(sourceCanvas, Math.round(sourceCanvas.width * crop.x), Math.round(sourceCanvas.height * crop.y), output.width, output.height, 0, 0, output.width, output.height);
    updateDraft('imageDataUrl', output.toDataURL('image/png'));
    setCropMode(false);
    setMessage('선택한 원본 영역을 문항 이미지에 첨부했습니다. 저장 또는 승인하면 CBT에서도 표시됩니다.');
  }

  const noSources = sources.length === 0;
  const progressPercent = selectedSource ? Math.max(0, Math.min(100, Math.round((selectedSource.lastProcessedPage - selectedSource.pageStart + 1) / (selectedSource.pageEnd - selectedSource.pageStart + 1) * 100))) : 0;

  return <section className="page-content pdf-import-page">
    <div className="page-heading"><div><span className="eyebrow">로컬 PDF 추출 · 검수</span><h1>PDF 기출 가져오기</h1><p>원본 PDF는 이 브라우저에 저장되고, 한국어 OCR도 기기 안에서 실행됩니다.</p></div></div>
    <div className="pdf-privacy-note"><strong>개인정보와 원본 보호</strong><span>PDF를 외부 서버에 업로드하지 않습니다. 추출 도중 오류가 나도 기존 문제은행·응시 이력은 변경되지 않으며, 처리한 페이지는 이어서 검수할 수 있습니다.</span></div>

    <div className="pdf-upload-card">
      <div className="pdf-upload-top"><div><span className="step-index">01</span><h2>기출 PDF 선택</h2><p>텍스트 PDF는 텍스트 레이어를 읽고, 스캔 PDF는 로컬 OCR로 페이지를 읽습니다.</p></div><label className="button outline file-button"><span>PDF 선택</span><input type="file" accept="application/pdf,.pdf" onChange={(event) => void handleFile(event)} disabled={busy}/></label></div>
      {file && <div className="pdf-file-config">
        <div className="pdf-file-info"><strong>{file.name}</strong><span>{formatBytes(file.size)} · {filePageCount}쪽</span></div>
        <div className="editor-grid"><label>시작 쪽<input type="number" min="1" max={filePageCount} value={pageStart} onChange={(event) => setPageStart(event.target.value)}/></label><label>끝 쪽<input type="number" min="1" max={filePageCount} value={pageEnd} onChange={(event) => setPageEnd(event.target.value)}/></label></div>
        <label>전체 기본 과목 <span className="optional">책 전체에 한 과목만 실린 경우</span><select value={defaultSubject} onChange={(event) => setDefaultSubject(event.target.value)}><option value="">자동 감지 · 불확실하면 문항별 검수</option>{SUBJECTS.legacy.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
        <p className="pdf-form-hint">책 전체를 한 번에 처리할 수 있습니다. 분류는 과목 기준이며, 연도와 회차는 저장하거나 묶지 않습니다. 검수 완료 전까지 문제은행과 CBT 출제에 포함되지 않습니다.</p>
        <button className="button primary" onClick={() => void beginImport()} disabled={busy}><span>{busy ? '준비 중...' : '이 범위 추출 시작'}</span></button>
      </div>}
      {busy && <p className="pdf-busy-label">{progress.status || 'PDF 준비 중'} · {progress.page || 0}쪽 · OCR {Math.round(progress.ocr * 100)}%</p>}
    </div>

    {sources.length > 0 && <>
      <div className="pdf-source-section"><div className="section-heading"><div><span className="eyebrow">가져온 PDF</span><h2>원본과 검수 대기</h2></div><span className="pdf-source-total">{sources.length}개 문서</span></div>
        <div className="pdf-source-list">{sources.map((source) => {
          const count = drafts.filter((draft) => draft.sourceId === source.id).length;
          const pending = drafts.filter((draft) => draft.sourceId === source.id && draft.status === 'pending').length;
          return <button key={source.id} className={`pdf-source-row ${source.id === selectedSourceId ? 'active' : ''}`} onClick={() => void selectSource(source.id)}><span className="pdf-file-icon">PDF</span><span className="pdf-source-name"><strong>{source.name}</strong><small>{source.pageStart}–{source.pageEnd}쪽 · {formatBytes(source.size)} · {count}문항 / 미검수 {pending}</small></span><span className={`pdf-status ${source.status}`}>{source.status === 'complete' ? '처리 완료' : source.status === 'failed' ? '중단 · 이어하기' : '처리 중'}</span></button>;
        })}</div>
      </div>

      {selectedSource && <div className="pdf-review-card">
        <div className="pdf-review-header"><div><span className="eyebrow">02 · 원본 대조 검수</span><h2>{selectedSource.name}</h2><p>{selectedSource.lastProcessedPage >= selectedSource.pageStart ? `${selectedSource.lastProcessedPage} / ${selectedSource.pageEnd}쪽 처리 · ` : ''}{pendingCount}개 검수 대기 · {questionCount - pendingCount}개 승인됨</p></div><div className="pdf-review-actions">{busy ? <button className="button outline" onClick={cancelImport}>처리 중지</button> : selectedSource.status !== 'complete' ? <button className="button primary" onClick={() => void beginImport(selectedSource)}>{selectedSource.lastProcessedPage >= selectedSource.pageStart ? '중단 위치부터 계속' : '추출 다시 시작'}</button> : null}<button className="button outline" onClick={() => void restartSelectedSource()} disabled={busy}>처음부터 다시 추출</button><button className="button outline danger-outline" onClick={() => void removeSelectedSource()} disabled={busy || questions.some((question) => question.sourceDocumentId === selectedSource.id)}>PDF 원본 삭제</button></div></div>
        {(selectedSource.status !== 'complete' || progress.page > 0) && <div className="pdf-progress"><div><span style={{ width: `${progressPercent}%` }}/></div><small>{selectedSource.lastProcessedPage} / {selectedSource.pageEnd}쪽 ({progressPercent}%)</small></div>}
        {selectedSource.error && <p className="pdf-error-inline">최근 처리: {selectedSource.error}</p>}
        {selectedSource.status === 'failed' && <p className="pdf-resume-hint">처리된 페이지와 검수 내용은 저장되어 있습니다. 실패 페이지부터 이어서 처리할 수 있습니다.</p>}
        {sourceDrafts.length > 0 ? <div className="pdf-review-layout">
          <div className="pdf-preview-column">
            <div className="pdf-panel-heading"><div><strong>원본 PDF · {activePageNumber}쪽</strong><small>이미지, 표, 수식은 이 원본에서 확대해 확인하세요.</small></div><span className="pdf-page-count">{activePageNumber} / {selectedSource.pageCount}</span></div>
            <div className={`pdf-canvas-frame ${cropMode ? 'crop-active' : ''}`} onPointerDown={startCrop} onPointerMove={moveCrop} onPointerUp={finishCrop} onPointerCancel={finishCrop}>
              <canvas ref={canvasRef} aria-label="원본 PDF 페이지 미리보기" />
              {cropMode && <div className="pdf-crop-overlay" aria-hidden="true">{crop && <span style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}/>}</div>}
            </div>
            <div className="pdf-crop-tools">{cropMode ? <><span>문항 이미지·표·수식 영역을 드래그하세요.</span><button className="button primary small" onClick={attachCrop}>선택 영역 첨부</button><button className="text-button" onClick={() => { setCropMode(false); setCrop(undefined); }}>취소</button></> : <button className="button outline small" onClick={() => { setCropMode(true); setCrop(undefined); }}>원본에서 이미지·표·수식 선택</button>}</div>
            {activeDraft?.imageDataUrl && <div className="pdf-attached-preview"><div><strong>문항에 첨부할 원본 이미지</strong><button className="text-button danger-text" onClick={() => updateDraft('imageDataUrl', undefined)}>삭제</button></div><img src={activeDraft.imageDataUrl} alt="문항에 첨부한 PDF 영역"/></div>}
          </div>
          <div className="pdf-draft-column">
            <div className="pdf-panel-heading"><div><strong>추출 결과 · {sourceDrafts.length}문항</strong><small>한 페이지에서 인식된 문항을 선택하세요.</small></div></div>
            <div className="pdf-draft-list">{sourceDrafts.map((draft, index) => <button key={draft.id} className={`pdf-draft-row ${draft.id === selectedDraftId ? 'active' : ''}`} onClick={() => selectDraft(draft)}><span className="pdf-draft-number">{draft.questionNumber ?? '—'}</span><span className="pdf-draft-copy"><strong>{draft.prompt || '문제 지문 확인 필요'}</strong><small>{draft.sourcePage}쪽 · {draft.extractionMethod === 'ocr' ? `OCR ${draft.confidence}%` : '텍스트 PDF'} · {draft.issues.length ? `${draft.issues.length}개 확인 필요` : '기본 항목 감지됨'}</small></span><span className={`status-pill ${draft.status}`}>{draft.status === 'verified' ? '승인' : `검수 ${index + 1}`}</span></button>)}</div>
            {activeDraft && <div className="pdf-draft-editor">
              <div className="pdf-draft-editor-title"><div><span className="eyebrow">문항 {activeDraft.questionNumber ?? '번호 미검출'}</span><h3>추출 내용 수정</h3></div><span className={`status-pill ${activeDraft.status}`}>{activeDraft.status === 'verified' ? '문제은행 등록' : '검수 대기'}</span></div>
              {activeDraft.detectedSubjectLabel && <div className="pdf-detected-label"><strong>원문 과목 표기</strong><span>{activeDraft.detectedSubjectLabel}</span><small>표기가 기존 과목 체계와 다를 수 있어 원본 과목에 자동 지정하지 않았습니다.</small></div>}
              {issues.length > 0 && <div className="pdf-issue-list"><strong>자동 확인 항목</strong><div>{issues.map((issue) => <span className={['OCR 신뢰도 낮음', '중복 의심'].includes(issue) ? 'warning' : 'blocking'} key={issue}>{issue}</span>)}</div><small>정답 표식이 읽히지 않은 문항은 정답을 추정하지 않았습니다. 문항을 검수하고 직접 선택해야 승인할 수 있습니다.</small></div>}
              <div className="pdf-source-page-field"><span>원본 페이지</span><strong>{activeDraft.sourcePage}쪽</strong></div>
              <label className="pdf-field">원본 과목<select disabled={activeDraft.status === 'verified'} value={activeDraft.originalSubject} onChange={(event) => updateDraft('originalSubject', event.target.value)}><option value="">선택 필요</option>{SUBJECTS.legacy.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
              <label className="pdf-field">2027 개정 과목 · 확인된 경우에만 선택<select disabled={activeDraft.status === 'verified'} value={activeDraft.currentSubject ?? ''} onChange={(event) => updateDraft('currentSubject', event.target.value || undefined)}><option value="">미분류 · 개정 시험에 출제하지 않음</option>{SUBJECTS.revised.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
              <label className="pdf-field">문제 지문<textarea disabled={activeDraft.status === 'verified'} rows={4} value={activeDraft.prompt} onChange={(event) => updateDraft('prompt', event.target.value)}/></label>
              <div className="pdf-choice-fields"><strong>보기 · 정답은 원문 표식이 없으면 직접 확인</strong>{activeDraft.choices.map((choice, index) => <label className="pdf-choice-field" key={index}><span>{index + 1}</span><input disabled={activeDraft.status === 'verified'} value={choice} onChange={(event) => updateDraft('choices', activeDraft.choices.map((item, i) => i === index ? event.target.value : item) as PdfDraft['choices'])}/><input disabled={activeDraft.status === 'verified'} type="radio" name={`pdf-answer-${activeDraft.id}`} checked={activeDraft.answer === index + 1} onChange={() => updateDraft('answer', index + 1)} aria-label={`${index + 1}번 정답`}/></label>)}</div>
              <label className="pdf-field">해설<textarea disabled={activeDraft.status === 'verified'} rows={4} value={activeDraft.explanation} onChange={(event) => updateDraft('explanation', event.target.value)}/></label>
              <details className="pdf-raw-text"><summary>페이지 OCR 원문 보기 · {activeDraft.extractionMethod === 'ocr' ? `신뢰도 ${activeDraft.confidence}%` : '텍스트 레이어'}</summary><pre>{activeDraft.rawText || '페이지에서 읽은 텍스트가 없습니다.'}</pre></details>
              {activeDraft.status === 'pending' && <div className="pdf-editor-actions"><button className="button outline" onClick={() => void saveCurrentDraft()}>검수 내용 저장</button><button className="button primary" onClick={() => void approveCurrentDraft()} disabled={blockingIssues.length > 0}>확인 후 문제은행 승인 <span>→</span></button></div>}
              {activeDraft.status === 'verified' && <div className="pdf-approved-note">문제은행에 등록되었습니다. 이후 수정은 문제은행의 문항 편집에서 할 수 있습니다.</div>}
            </div>}
          </div>
        </div> : pageTexts.length > 0 ? <div className="pdf-empty-review-layout"><div className="pdf-preview-column"><div className="pdf-panel-heading"><div><strong>원본 PDF · {activePageNumber}쪽</strong><small>원본의 도형·표·수식은 선택 영역을 문항 이미지로 저장할 수 있습니다.</small></div><label className="pdf-page-select">쪽<select value={selectedPageNumber} onChange={(event) => setSelectedPageNumber(Number(event.target.value))}>{pageTexts.map((item) => <option key={item.id} value={item.sourcePage}>{item.sourcePage}</option>)}</select></label></div><div className="pdf-canvas-frame"><canvas ref={canvasRef} aria-label="원본 PDF 페이지 미리보기" /></div></div><div className="pdf-no-drafts pdf-page-text-panel"><strong>{busy ? `${progress.page}쪽을 처리하고 있습니다` : '문항 경계를 자동으로 구분하지 못했습니다'}</strong><p>OCR 원문을 확인해 직접 문항 초안을 만들 수 있습니다. 번호가 없거나 형식이 다른 부분은 정답을 추정하지 않습니다.</p><details open><summary>{activePageText?.extractionMethod === 'ocr' ? `OCR 원문 · 신뢰도 ${activePageText.confidence}%` : 'PDF 텍스트 레이어 원문'}</summary><pre>{activePageText?.text || '읽은 텍스트가 없습니다.'}</pre></details>{activePageText && <button className="button outline small" onClick={() => void createManualDraft()}>이 쪽에서 문항 초안 만들기</button>}</div></div> : <div className="pdf-no-drafts"><strong>{busy ? `${progress.page}쪽을 처리하고 있습니다` : '추출된 문항이 아직 없습니다'}</strong><p>{selectedSource.status === 'complete' ? '페이지에서 인식된 텍스트가 없습니다. PDF 페이지를 확인하거나 다른 범위로 가져와 주세요.' : '페이지를 처리하면 원본과 추출 결과가 여기에 표시됩니다.'}</p></div>}
      </div>}
    </>}
    {noSources && !file && <div className="pdf-empty-state"><strong>검수할 PDF가 없습니다</strong><p>PDF를 선택하면 우선 이 기기에 원본을 저장합니다. 추출 문항은 전부 검수 대기로 시작합니다.</p></div>}
    {(error || message) && <div className={`pdf-toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}<button className="icon-button" onClick={() => { setError(''); setMessage(''); }} aria-label="알림 닫기">×</button></div>}
  </section>;
}

export function findNearDuplicate(prompt: string, questions: Question[], drafts: PdfDraft[]): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const candidate of [...questions, ...drafts]) {
    if (candidate.prompt === prompt) return candidate.id;
    const score = promptSimilarity(prompt, candidate.prompt);
    if (score >= 0.88 && (!best || score > best.score)) best = { id: candidate.id, score };
  }
  return best?.id;
}

export function getApprovalIssues(draft: PdfDraft): string[] {
  return draftIssues(draft, Boolean(draft.duplicateOf)).filter((issue) => !['OCR 신뢰도 낮음', '중복 의심'].includes(issue));
}
