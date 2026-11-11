import { useEffect, useRef, useState, type RefObject } from 'react';
import { SYMBOL_GROUPS, insertAtSelection, type SymbolHint } from './lib/symbolReview';

type TextField = HTMLInputElement | HTMLTextAreaElement;

function symbolField(target: EventTarget | null): TextField | null {
  if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return null;
  return target.dataset.symbolField ? target : null;
}

/** Writes through the native setter so React's controlled onChange runs with the new value. */
function writeValue(field: TextField, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Inserts the clicked symbol at the caret of the last focused field marked with `data-symbol-field`.
 * It never replaces existing characters unless the person selected them first.
 */
export function SymbolPalette({ scope }: { scope: RefObject<HTMLElement | null> }) {
  const [group, setGroup] = useState(SYMBOL_GROUPS[0].id);
  const [targetLabel, setTargetLabel] = useState('');
  const [inserted, setInserted] = useState('');
  const target = useRef<TextField | null>(null);
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const onFocus = (event: FocusEvent) => {
      const field = symbolField(event.target);
      if (!field) return;
      target.current = field;
      setTargetLabel(field.dataset.symbolField ?? '');
    };
    root.addEventListener('focusin', onFocus);
    return () => root.removeEventListener('focusin', onFocus);
  }, [scope]);
  function insert(char: string, name: string) {
    const field = target.current;
    if (!field || !field.isConnected) { target.current = null; setTargetLabel(''); return; }
    const next = insertAtSelection(field.value, field.selectionStart, field.selectionEnd, char);
    writeValue(field, next.value);
    field.focus();
    field.setSelectionRange(next.caret, next.caret);
    setInserted(`${field.dataset.symbolField}에 ${name} ${char} 삽입`);
  }
  const symbols = SYMBOL_GROUPS.find((item) => item.id === group)?.symbols ?? [];
  return <section className="symbol-palette" aria-label="기호 입력 도구">
    <div className="symbol-palette-head"><strong>기호 입력</strong><span>{targetLabel ? `삽입 위치: ${targetLabel} · 커서 자리` : '먼저 수정할 칸을 선택하세요'}</span></div>
    <div className="symbol-groups" role="group" aria-label="기호 종류">{SYMBOL_GROUPS.map((item) => <button type="button" key={item.id} className={group === item.id ? 'active' : ''} aria-pressed={group === item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => setGroup(item.id)}>{item.label}</button>)}</div>
    <div className="symbol-buttons">{symbols.map((symbol) => <button type="button" key={symbol.char} disabled={!targetLabel} title={symbol.name} aria-label={`${symbol.name} ${symbol.char} 삽입`} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(symbol.char, symbol.name)}><span aria-hidden="true">{symbol.char}</span>{group === 'process' && <small>{symbol.name}</small>}</button>)}</div>
    <p className="symbol-palette-note">클릭한 기호만 커서 위치에 들어갑니다. 기존 글자는 자동으로 바뀌지 않습니다.</p>
    <span className="visually-hidden" role="status">{inserted}</span>
  </section>;
}

/** Non-blocking hints: fields a person should compare with the source. */
export function SymbolHintList({ hints }: { hints: SymbolHint[] }) {
  if (!hints.length) return null;
  return <div className="symbol-hints" role="note"><strong>기호·오탈자 확인 힌트 {hints.length}건 · 자동 수정 없음</strong><ul>{hints.map((hint, index) => <li key={`${hint.label}:${index}`}><b>{hint.label}</b> {hint.reason}</li>)}</ul><small>힌트는 일부 패턴만 찾습니다. 힌트가 없어도 원본 대조는 필요합니다.</small></div>;
}
