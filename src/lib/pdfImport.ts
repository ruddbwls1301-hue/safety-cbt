import { appUrl } from './basePath';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import { createWorker, OEM, PSM } from 'tesseract.js';
import type { PdfDraft, PdfExtractionMethod, PdfPageText, PdfSource } from '../types';
import { SUBJECTS } from '../constants';
import { makeId, normalizePrompt } from './questions';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ParsedQuestion = {
  questionNumber: number | null;
  prompt: string;
  choices: [string, string, string, string];
  answer: number | null;
  explanation: string;
  rawText: string;
};

type ProcessCallbacks = {
  signal?: AbortSignal;
  onPage: (page: number, drafts: PdfDraft[], pageText: PdfPageText) => Promise<void>;
  onOcrProgress?: (progress: number, status: string) => void;
};

function parseQuestionLead(line: string, previousNumber?: number): { number: number; inline: string; standalone: boolean } | undefined {
  const leader = String.raw`^[\s\p{P}\p{S}]{0,5}(?:Q\s*)?(?:[0Oo]\s*)?(\d{1,3})`;
  const standalone = line.match(new RegExp(`${leader}(?:번)?\\s*$`, 'iu'));
  const inline = line.match(new RegExp(`${leader}\\s*[.)、:]?\\s+(.+?)\\s*$`, 'iu'));
  const match = standalone ?? inline;
  if (!match) return undefined;
  let number = Number(match[1]);
  if (number > 120 && previousNumber !== undefined && previousNumber < 120) {
    const digits = match[1];
    const nextNumber = previousNumber + 1;
    if (Number(digits.slice(-3)) === nextNumber || Number(digits.slice(-2)) === nextNumber) number = nextNumber;
  }
  if (number < 1 || number > 120) return undefined;
  return { number, inline: standalone ? '' : inline?.[2] ?? '', standalone: Boolean(standalone) };
}

function parseEmbeddedSequentialLead(line: string, previousNumber: number): { number: number; inline: string; standalone: false } | undefined {
  const expected = previousNumber + 1;
  if (expected > 120) return undefined;
  for (const match of line.matchAll(/(?<!\d)\d{2,4}(?!\d)/g)) {
    const token = match[0];
    const number = [token.slice(-3), token.slice(-2)].map(Number).find((value) => value === expected);
    if (number === undefined) continue;
    const inline = line.slice((match.index ?? 0) + token.length).replace(/^[\s\p{P}\p{S}]{0,5}/u, '').trim();
    if (inline.replace(/[^가-힣]/g, '').length >= 5) return { number, inline, standalone: false };
  }
  return undefined;
}

function containsExplicitAnswer(lines: string[]): boolean {
  return lines.some((line) => /(?:정답|답)\s*[:：)）]?\s*[①②③④1-4]/.test(line));
}

function shouldStartQuestion(next: { number: number; standalone: boolean }, current: { number: number; lines: string[] } | undefined): boolean {
  if (!current) return true;
  if (containsExplicitAnswer(current.lines)) return true;
  const difference = next.number - current.number;
  if (difference > 0 && difference <= 4) return true;
  return next.standalone && difference < 0 && difference >= -3;
}

function markerNumber(marker: string): number {
  const circled = '①②③④'.indexOf(marker);
  if (circled >= 0) return circled + 1;
  return Number(marker.match(/[1-4]/)?.[0] ?? 0);
}

function parseBlock(number: number | null, lines: string[]): ParsedQuestion {
  const rawText = lines.join('\n').trim();
  const cleanedLines = [...lines];
  if (cleanedLines.length) cleanedLines[0] = cleanedLines[0].replace(/^\s*[\s\p{P}\p{S}]{0,5}(?:Q\s*)?(?:[0Oo]\s*)?\d{1,4}(?:번)?\s*[.)、:]?\s*/iu, '');
  const choices: [string, string, string, string] = ['', '', '', ''];
  const promptLines: string[] = [];
  const explanationLines: string[] = [];
  let inChoices = false;
  let inExplanation = false;
  let activeChoice = 0;
  let answer: number | null = null;
  const choiceMarker = /(?:^|\s)(①|②|③|④|[1-4]\s*[.)、])\s*/g;

  for (const rawLine of cleanedLines) {
    const line = rawLine.trim();
    if (!line) continue;
    const answerMatch = line.match(/(?:정답|답)\s*[:：)）]?\s*([①②③④1-4])/);
    if (answerMatch) answer = markerNumber(answerMatch[1]);
    const explanationMatch = line.match(/(?:^|\s)해설\s*[:：]?\s*/);
    if (explanationMatch) {
      inExplanation = true;
      inChoices = false;
      const rest = line.slice((explanationMatch.index ?? 0) + explanationMatch[0].length).trim();
      if (rest && !/(?:정답|답)\s*[:：)）]?\s*[①②③④1-4]/.test(rest)) explanationLines.push(rest);
      continue;
    }
    if (/(?:정답|답)\s*[:：)）]?\s*[①②③④1-4]/.test(line)) continue;
    if (inExplanation) {
      explanationLines.push(line);
      continue;
    }

    const markers = [...line.matchAll(choiceMarker)];
    if (!markers.length) {
      if (inChoices && activeChoice) choices[activeChoice - 1] += `${choices[activeChoice - 1] ? ' ' : ''}${line}`;
      else promptLines.push(line);
      continue;
    }
    inChoices = true;
    for (let index = 0; index < markers.length; index++) {
      const marker = markers[index];
      const start = (marker.index ?? 0) + marker[0].length;
      const end = markers[index + 1]?.index ?? line.length;
      const choiceIndex = markerNumber(marker[1]);
      activeChoice = choiceIndex;
      const part = line.slice(start, end).trim();
      if (part) choices[choiceIndex - 1] += `${choices[choiceIndex - 1] ? ' ' : ''}${part}`;
    }
  }

  return {
    questionNumber: number,
    prompt: promptLines.join('\n').replace(/^\s*\d{1,3}\s*/, '').trim(),
    choices: choices.map((choice) => choice.trim()) as [string, string, string, string],
    answer,
    explanation: explanationLines.join('\n').trim(),
    rawText,
  };
}

export function parseQuestionText(text: string): ParsedQuestion[] {
  const lines = text.replace(/\r/g, '\n').replace(/[\t\u00a0]+/g, ' ').split('\n').map((line) => line.trim()).filter(Boolean);
  const blocks: { number: number; lines: string[] }[] = [];
  let active: { number: number; lines: string[] } | undefined;
  for (const line of lines) {
    let lead = parseQuestionLead(line, active?.number);
    if (active && (!lead || !shouldStartQuestion(lead, active))) {
      lead = parseEmbeddedSequentialLead(line, active.number) ?? lead;
    }
    if (lead && shouldStartQuestion(lead, active)) {
      active = { number: lead.number, lines: [lead.standalone ? String(lead.number) : `${lead.number}. ${lead.inline}`] };
      blocks.push(active);
    } else if (active) {
      active.lines.push(line);
    }
  }
  const questionCue = /[?？]|다음\s*(?:중|에서|과)|옳|틀리|아니|않|해당|적절|알맞|바르|무엇|어느|어떤|설명.{0,20}(?:것|점|방법|내용)/u;
  return blocks.map((block) => parseBlock(block.number, block.lines))
    .filter((item) => item.prompt.trim().length >= 8 && questionCue.test(item.prompt));
}

export function inferImportDefaults(filename: string): { year: number | null; round: string } {
  const years = [...new Set(filename.match(/(?:19|20)\d{2}/g) ?? [])].map(Number);
  const roundMatch = filename.match(/(?:제\s*)?([1-9]\d?)\s*회(?:차)?/);
  return {
    year: years.length === 1 ? years[0] : null,
    round: roundMatch ? `${roundMatch[1]}회` : '',
  };
}

function detectSubjectLabel(text: string): { originalSubject: string; label?: string } {
  const labels = [...text.matchAll(/(?:제\s*)?[1-6]\s*과목\s*([^\n]+)/g)].map((match) => match[1].trim());
  const labelCandidate = labels.at(-1)?.replace(/\s{2,}.*/, '').trim();
  const label = labelCandidate && normalizePrompt(labelCandidate).length >= 8 ? labelCandidate : undefined;
  const compactText = normalizePrompt(text);
  const matches = SUBJECTS.legacy.filter((subject) => {
    const compactSubject = normalizePrompt(subject);
    return compactText.includes(compactSubject) || compactText.includes(compactSubject.slice(0, Math.min(10, compactSubject.length)));
  });
  if (matches.length === 1) return { originalSubject: matches[0], ...(label ? { label } : {}) };
  if (matches.length > 1) return { originalSubject: '', label: '복수 과목 표기 · 페이지 확인 필요' };
  if (!label) return { originalSubject: '' };
  const compactLabel = normalizePrompt(label);
  const match = SUBJECTS.legacy.find((subject) => normalizePrompt(subject) === compactLabel);
  return { originalSubject: match ?? '', label };
}

export function draftIssues(draft: Pick<PdfDraft, 'year' | 'round' | 'originalSubject' | 'prompt' | 'choices' | 'answer' | 'explanation' | 'confidence'>, duplicate = false): string[] {
  const issues: string[] = [];
  if (!draft.originalSubject.trim()) issues.push('원본 과목 미확인');
  if (!draft.prompt.trim()) issues.push('문제 지문 누락');
  if (draft.choices.length !== 4 || draft.choices.some((choice) => !choice.trim())) issues.push('보기 누락');
  if (!draft.answer || draft.answer < 1 || draft.answer > 4) issues.push('정답 표식 미검출');
  if (!draft.explanation.trim()) issues.push('해설 누락');
  if (draft.confidence < 75) issues.push('OCR 신뢰도 낮음');
  if (duplicate) issues.push('중복 의심');
  return issues;
}

export function promptSimilarity(left: string, right: string): number {
  const a = normalizePrompt(left);
  const b = normalizePrompt(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 8) return 0;
  const grams = (value: string) => new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  const overlap = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
  return overlap / (leftGrams.size + rightGrams.size - overlap);
}

export function createDraftsForPage(source: PdfSource, page: number, text: string, confidence: number, method: PdfExtractionMethod): PdfDraft[] {
  const subject = detectSubjectLabel(text);
  return parseQuestionText(text).map((parsed, sequence) => {
    const draft: PdfDraft = {
      id: `${source.id}:${page}:${sequence + 1}`,
      sourceId: source.id,
      sourcePage: page,
      sequence: sequence + 1,
      questionNumber: parsed.questionNumber,
      year: source.defaultYear,
      round: source.defaultRound,
      originalSubject: source.defaultOriginalSubject || subject.originalSubject,
      ...(subject.label ? { detectedSubjectLabel: subject.label } : {}),
      prompt: parsed.prompt,
      choices: parsed.choices,
      answer: parsed.answer,
      explanation: parsed.explanation,
      rawText: parsed.rawText,
      confidence,
      extractionMethod: method,
      status: 'pending',
      issues: [],
      createdAt: new Date().toISOString(),
    };
    draft.issues = draftIssues(draft);
    return draft;
  });
}

async function loadPdf(blob: Blob) {
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), wasmUrl: appUrl('pdfjs/wasm/') });
  return { document: await task.promise, destroy: () => task.destroy() };
}

export async function inspectPdf(file: File): Promise<number> {
  const loaded = await loadPdf(file);
  const pageCount = loaded.document.numPages;
  await loaded.destroy();
  return pageCount;
}

function textFromItems(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  return items.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`).join('').replace(/[ \t]+\n/g, '\n').trim();
}

type CanvasRenderTask = { cancel: () => void; promise: Promise<unknown> };
const previewRenderTasks = new WeakMap<HTMLCanvasElement, CanvasRenderTask>();

export async function renderPdfPage(blob: Blob, pageNumber: number, canvas: HTMLCanvasElement, maxWidth = 760, signal?: AbortSignal): Promise<void> {
  const priorTask = previewRenderTasks.get(canvas);
  if (priorTask) {
    priorTask.cancel();
    await priorTask.promise.catch(() => undefined);
    previewRenderTasks.delete(canvas);
  }
  if (signal?.aborted) return;
  const loaded = await loadPdf(blob);
  try {
    if (signal?.aborted) return;
    const page = await loaded.document.getPage(pageNumber);
    if (signal?.aborted) return;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.8, maxWidth / base.width);
    const viewport = page.getViewport({ scale });
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이 브라우저에서 PDF 미리보기를 표시할 수 없습니다.');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    const renderTask = page.render({ canvas, canvasContext: context, viewport });
    previewRenderTasks.set(canvas, renderTask);
    const cancelOnAbort = () => renderTask.cancel();
    signal?.addEventListener('abort', cancelOnAbort, { once: true });
    try {
      await renderTask.promise;
    } catch (reason) {
      if (!signal?.aborted) throw reason;
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
      if (previewRenderTasks.get(canvas) === renderTask) previewRenderTasks.delete(canvas);
    }
  } finally {
    await loaded.destroy();
  }
}

async function makeOcrWorker(onProgress?: ProcessCallbacks['onOcrProgress']) {
  const worker = await createWorker('kor', OEM.LSTM_ONLY, {
    workerPath: tesseractWorkerUrl,
    langPath: appUrl('ocr/lang'),
    corePath: appUrl('ocr/core'),
    gzip: true,
    workerBlobURL: true,
    logger: (message) => onProgress?.(message.progress, message.status),
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' });
  return worker;
}

export async function processPdfSource(source: PdfSource, blob: Blob, callbacks: ProcessCallbacks): Promise<void> {
  const loaded = await loadPdf(blob);
  let ocrWorker: Awaited<ReturnType<typeof makeOcrWorker>> | undefined;
  try {
    for (let pageNumber = Math.max(source.pageStart, source.lastProcessedPage + 1); pageNumber <= source.pageEnd; pageNumber++) {
      if (callbacks.signal?.aborted) throw new DOMException('사용자가 PDF 처리를 중단했습니다.', 'AbortError');
      const page = await loaded.document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = textFromItems(content.items as Array<{ str?: string; hasEOL?: boolean }>);
      let recognizedText = text;
      let confidence = 100;
      let method: PdfExtractionMethod = 'text-layer';
      if (text.replace(/\s/g, '').length < 60) {
        method = 'ocr';
        const viewport = page.getViewport({ scale: Math.max(2.2, 1850 / page.getViewport({ scale: 1 }).width) });
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error(`PDF ${pageNumber}쪽을 렌더링할 수 없습니다.`);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        ocrWorker ??= await makeOcrWorker(callbacks.onOcrProgress);
        await ocrWorker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' });
        const fullResult = await ocrWorker.recognize(canvas.toDataURL('image/png'), { rotateAuto: true }, { text: true });
        recognizedText = fullResult.data.text;
        confidence = Math.max(0, Math.min(100, Math.round(fullResult.data.confidence ?? 0)));
        const recognizedQuestionCount = parseQuestionText(recognizedText).length;
        if (recognizedText.replace(/\s/g, '').length < 120 || confidence < 88 || recognizedQuestionCount < 4) {
          const halfWidth = Math.floor(canvas.width / 2);
          const regions = [
            { x: 0, y: 0, width: halfWidth, height: canvas.height },
            { x: halfWidth, y: 0, width: canvas.width - halfWidth, height: canvas.height },
          ];
          const regionTexts: string[] = [];
          const regionConfidences: number[] = [];
          for (const region of regions) {
            const cropped = globalThis.document.createElement('canvas');
            cropped.width = region.width;
            cropped.height = region.height;
            const croppedContext = cropped.getContext('2d');
            if (croppedContext) {
              croppedContext.drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
              await ocrWorker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: '1', user_defined_dpi: '300' });
              const regionResult = await ocrWorker.recognize(cropped.toDataURL('image/png'), { rotateAuto: true }, { text: true });
              regionTexts.push(regionResult.data.text);
              regionConfidences.push(Math.max(0, Math.min(100, Math.round(regionResult.data.confidence ?? 0))));
            }
            cropped.width = 0;
            cropped.height = 0;
          }
          const regionText = regionTexts.filter(Boolean).join('\n');
          const regionConfidence = regionConfidences.length ? Math.round(regionConfidences.reduce((total, value) => total + value, 0) / regionConfidences.length) : 0;
          const score = (value: string, valueConfidence: number) => value.replace(/\s/g, '').length * valueConfidence;
          if (score(regionText, regionConfidence) > score(recognizedText, confidence)) {
            recognizedText = regionText;
            confidence = regionConfidence;
          }
        }
        canvas.width = 0;
        canvas.height = 0;
      }
      const drafts = createDraftsForPage(source, pageNumber, recognizedText, confidence, method);
      await callbacks.onPage(pageNumber, drafts, {
        id: `${source.id}:${pageNumber}`, sourceId: source.id, sourcePage: pageNumber,
        text: recognizedText, confidence, extractionMethod: method, questionCount: drafts.length,
      });
      page.cleanup();
    }
  } finally {
    await ocrWorker?.terminate();
    await loaded.destroy();
  }
}
