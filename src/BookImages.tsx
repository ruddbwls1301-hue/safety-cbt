import { useEffect, useState } from 'react';
import { getBookImage } from './lib/db';
import type { Question } from './types';

export function BookImageFigure({ url, purpose, alt, onLoad, onError }: { url: string; purpose: 'review' | 'exam' | 'candidate-exam'; alt: string; onLoad?: () => void; onError?: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  return <figure className="book-image-view"><figcaption><button type="button" className="image-zoom-button" aria-label={`${alt} ${zoomed ? '화면에 맞추기' : '확대'}`} aria-pressed={zoomed} onClick={() => setZoomed((value) => !value)}>{zoomed ? '화면에 맞추기' : '이미지 확대'}</button><a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${alt} 원본 크기로 보기 (새 탭)`}>원본 크기로 보기 · 새 탭</a></figcaption><div className={`book-image-frame ${zoomed ? 'zoomed' : ''}`}><img className={`book-stored-image ${purpose}`} src={url} alt={alt} decoding="async" onLoad={onLoad} onError={onError}/></div></figure>;
}

export function BookStoredImage({ imageId, purpose, alt, onReady }: { imageId?: string; purpose: 'review' | 'exam' | 'candidate-exam'; alt: string; onReady?: (ready: boolean) => void }) {
  const [url, setUrl] = useState('');
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let active = true;
    let created = '';
    setUrl(''); setMissing(false);
    onReady?.(false);
    if (imageId) void getBookImage(imageId).then((image) => {
      if (!active) return;
      if (!image || image.kind !== purpose || !image.blob.size) { setMissing(true); return; }
      created = URL.createObjectURL(image.blob); setUrl(created);
    }).catch(() => { if (active) setMissing(true); });
    return () => { active = false; if (created) URL.revokeObjectURL(created); };
  }, [imageId, purpose]);
  if (!imageId) return null;
  if (missing) return <p className="form-error" role="alert">{purpose === 'exam' ? '확인된 시험용 이미지를 찾지 못했습니다. 전체 정답 이미지는 표시하지 않습니다.' : '검수용 이미지가 이 기기에 없습니다. 원본 ZIP을 다시 가져와 이미지 연결을 복원해 주세요.'}</p>;
  return url ? <BookImageFigure key={`${purpose}:${imageId}`} url={url} purpose={purpose} alt={alt} onLoad={() => onReady?.(true)} onError={() => { setMissing(true); onReady?.(false); }}/> : <p className="book-small-note" role="status">이미지 불러오는 중...</p>;
}
export function BookExamImage({ question }: { question: Question }) {
  const book = question.book;
  if (!book?.review?.examImageSafe || !book.examImageId || book.examImageId === book.reviewImageId) return null;
  return <BookStoredImage imageId={book.examImageId} purpose="exam" alt="검수된 문제와 보기 이미지"/>;
}
export function bookExplanationText(question: Question, questions: Question[]): string {
  let current = question;
  const seen = new Set([current.id]);
  while (current.book?.explanationRef) {
    const reference = current.book.explanationRef;
    const next = questions.find((item) => item.book?.datasetId === current.book?.datasetId && item.book?.originalId === reference);
    if (!next || seen.has(next.id)) return `${question.explanation}\n해설 참조 확인 필요: ${reference}`;
    seen.add(next.id); current = next;
  }
  return current === question ? question.explanation || '원본 교재 데이터에 해설이 제공되지 않았습니다.' : `${question.explanation}\n\n[${current.book?.originalId} 해설]\n${current.explanation}`;
}
