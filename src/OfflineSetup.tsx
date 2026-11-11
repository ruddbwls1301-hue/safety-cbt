import { useEffect, useState } from 'react';
import { appUrl } from './lib/basePath';

export default function OfflineSetup({ onTransfer }: { onTransfer: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'unsupported'>('loading');
  const [waiting, setWaiting] = useState(false); const [protection, setProtection] = useState('');
  useEffect(() => {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) { setStatus('unsupported'); return; }
    let active = true; const cleanups: (() => void)[] = [];
    void navigator.serviceWorker.register(appUrl('sw.js'), { updateViaCache: 'none' }).then((registration) => {
      const refresh = () => { if (active) { setStatus(registration.active?.state === 'activated' ? 'ready' : 'loading'); setWaiting(Boolean(registration.waiting)); } };
      const follow = (worker: ServiceWorker | null) => { if (!worker) return; const changed = () => { if (worker.state === 'redundant' && !registration.active && active) setStatus('failed'); else refresh(); }; worker.addEventListener('statechange', changed); cleanups.push(() => worker.removeEventListener('statechange', changed)); };
      follow(registration.installing); follow(registration.active); refresh();
      const update = () => follow(registration.installing); registration.addEventListener('updatefound', update); cleanups.push(() => registration.removeEventListener('updatefound', update));
      void navigator.serviceWorker.ready.then(refresh);
    }).catch(() => { if (active) setStatus('failed'); });
    return () => { active = false; cleanups.forEach((cleanup) => cleanup()); };
  }, []);
  async function protect() {
    const granted = await navigator.storage?.persist?.().catch(() => false);
    setProtection(granted ? '기기 저장 공간 보호가 허용되었습니다.' : '브라우저가 영구 저장을 허용하지 않았습니다. 중요한 기록은 이전 파일로 백업해 주세요.');
  }
  return <section className="standalone-setup panel"><h2>내 휴대폰 CBT 앱</h2><p>로그인·연결 코드 없이 사용합니다. 교재와 기록은 이 기기에만 저장됩니다.</p>
    <p className={`offline-readiness ${status}`} role="status">{status === 'ready' ? '오프라인 앱 준비 완료' : status === 'loading' ? '오프라인 앱 파일을 저장하는 중 · 인터넷 연결을 유지해 주세요' : status === 'unsupported' ? 'HTTPS 주소에서 Safari로 열어 주세요.' : '앱 파일을 저장하지 못했습니다. 인터넷 연결 후 새로고침해 주세요.'}</p>
    {waiting && <p>업데이트가 준비되었습니다. 학습을 마치고 이 주소의 모든 앱 창을 닫은 뒤 다시 열면 적용됩니다.</p>}
    <ol><li>Safari 공유 메뉴 → 홈 화면에 추가 → 웹 앱으로 열기.</li><li>홈 화면 아이콘에서 앱을 열고 기기 이전 파일 또는 원본 교재 ZIP을 가져옵니다.</li><li>‘오프라인 앱 준비 완료’를 확인한 뒤 비행기 모드에서 다시 열어 보세요.</li></ol>
    <div className="standalone-actions"><button className="button primary" onClick={onTransfer}>기존 문제·기록 가져오기</button><button className="button outline" onClick={() => void protect()}>기기 저장 공간 보호 요청</button></div>
    {protection && <p role="status">{protection}</p>}<p className="setup-note">Mac을 켜둘 필요가 없습니다. 저장한 문제풀이·채점·복습은 오프라인으로 사용할 수 있습니다. PDF·OCR 도구는 추가 파일을 처음 불러올 때 인터넷 연결이 필요할 수 있습니다.</p>
  </section>;
}
