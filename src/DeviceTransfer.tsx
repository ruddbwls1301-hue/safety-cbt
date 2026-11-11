import { useState, type ChangeEvent } from 'react';
import { getDeviceSnapshot, importDeviceSnapshot } from './lib/db';
import { createDevicePackage, inspectDevicePackage, type DeviceSnapshot } from './lib/devicePackage';

export default function DeviceTransfer({ onImported }: { onImported: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [message, setMessage] = useState(''); const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [prepared, setPrepared] = useState<DeviceSnapshot | null>(null);
  const update = (done: number, total: number) => setProgress({ done, total });
  async function download() {
    setBusy(true); setError(''); setMessage('이 기기의 문제·학습기록·원본 파일을 읽는 중');
    try {
      const snapshot = await getDeviceSnapshot();
      const blob = await createDevicePackage(snapshot, update);
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `industrial-safety-device-${new Date().toISOString().slice(0, 10)}.zip`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(`${snapshot.questionBank.length.toLocaleString()}문항 · 이미지 ${snapshot.bookImages.length.toLocaleString()}개 · 학습기록을 이전 파일로 저장했습니다. 기존 자료는 그대로 남아 있습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  async function inspect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setBusy(true); setPrepared(null); setError(''); setMessage('이전 파일의 문항·이미지·학습기록을 읽기 전용 검사 중');
    try { setPrepared(await inspectDevicePackage(file, update)); setMessage('검사가 끝났습니다. 아래 가져오기 버튼을 눌러야 이 주소에 저장됩니다.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  async function restore() {
    if (!prepared || busy) return;
    setBusy(true); setError(''); setMessage('빈 저장소 확인 후 모든 자료를 함께 저장하는 중');
    try { await importDeviceSnapshot(prepared); setMessage('이전을 완료했습니다.'); setPrepared(null); onImported(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <section className="page-content device-transfer" aria-busy={busy}>
    <div className="page-heading"><div><span className="eyebrow">파일로 직접 이전 · 서버 업로드 없음</span><h1>기기 이전·백업</h1><p>문제와 승인 상태, 이미지, 답안·북마크·응시 이력을 함께 보존합니다.</p></div></div>
    <div className="panel"><h2>1. 원래 주소에서 이전 파일 저장</h2><p>기존 4183 주소에서 실행하세요. 이미지는 base64 JSON 대신 ZIP 안의 원본 파일로 담습니다. 기기 저장 자료를 삭제하거나 바꾸지 않습니다.</p><button className="button primary" disabled={busy} onClick={() => void download()}>이미지·학습기록 포함 이전 파일 저장</button><p className="setup-note">파일은 이 기기에 내려받습니다. 다른 기기로 옮길 때는 AirDrop이나 파일 앱을 이용하세요.</p></div>
    <div className="panel"><h2>2. 새 모바일 주소에서 가져오기</h2><p>새 주소를 Safari에서 홈 화면에 추가한 다음, 홈 화면의 앱을 열고 이전 파일을 선택하세요. 기존 자료가 있는 주소에는 가져오지 않으며 덮어쓰지 않습니다.</p><label className="button outline file-button">이전 ZIP 선택·검사<input type="file" accept=".zip,application/zip" disabled={busy} onChange={(event) => void inspect(event)}/></label>
      {prepared && <div className="transfer-preview"><strong>검사 완료</strong><p>문항 {prepared.questionBank.length.toLocaleString()}개 · 교재 이미지 {prepared.bookImages.length.toLocaleString()}개 · 학습기록 {prepared.userData.length}개 · PDF 원본 {prepared.pdfFiles.length}개</p><button className="button primary" disabled={busy} onClick={() => void restore()}>빈 새 주소에 자료 가져오기</button></div>}
    </div>
    {busy && <progress aria-label="기기 이전 진행률" value={progress.done} max={progress.total || 1}/>}
    {message && <p role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <p className="setup-note">파일에는 개인 학습기록과 교재가 포함됩니다. 원본 주소와 새 주소의 기록은 자동 동기화되지 않습니다. 앱의 PDF·OCR 원본도 함께 이전하며, 진행 중인 시험의 원래 시간 기준은 그대로 보존합니다.</p>
  </section>;
}
