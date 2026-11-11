import { useEffect, useState } from 'react';
import { LOCAL_SERVER_FEATURES } from './lib/runtimeFlags';

type PhoneConnection = { enabled: boolean; urls: string[]; pairingCode: string };

export default function PhoneConnect({ onImport }: { onImport: () => void }) {
  const [connection, setConnection] = useState<PhoneConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const onComputer = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
  const hosted = !LOCAL_SERVER_FEATURES;
  useEffect(() => {
    if (!onComputer || !LOCAL_SERVER_FEATURES) { setLoading(false); return; }
    const controller = new AbortController();
    void fetch('/__local-book/network', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('휴대폰 연결 정보를 불러오지 못했습니다. 서버 시작 파일로 실행한 뒤 다시 확인해 주세요.');
      const value = await response.json();
      if (typeof value.enabled !== 'boolean' || !Array.isArray(value.urls) || value.urls.some((url: unknown) => typeof url !== 'string') || typeof value.pairingCode !== 'string') throw new Error('연결 정보를 확인해 주세요.');
      setConnection(value);
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason instanceof Error ? reason.message : reason)); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [onComputer]);
  return <section className="page-content phone-connect">
    <div className="page-heading"><div><span className="eyebrow">{hosted ? '어디서나 학습' : '같은 Wi-Fi에서 학습'}</span><h1>휴대폰 연결</h1><p>{hosted ? '휴대폰에서도 같은 웹사이트 주소를 열어 학습하세요.' : 'Mac과 휴대폰을 같은 Wi-Fi에 연결하고 Mac의 학습 서버를 실행해 두세요.'}</p></div></div>
    {hosted ? <div className="panel"><h2>휴대폰에서 이 주소를 여세요</h2><div className="phone-addresses"><a href={window.location.origin}>{window.location.origin}</a></div><ol><li>휴대폰 Safari 또는 Chrome에서 위 주소를 엽니다.</li><li>휴대폰에 보관한 교재 ZIP을 선택하고 가져오기를 실행합니다.</li><li>과목과 20문항 묶음을 선택해 학습합니다.</li><li>Safari의 공유 메뉴 또는 Chrome의 설치 메뉴에서 홈 화면에 추가할 수 있습니다.</li></ol><button className="button primary" onClick={onImport}>교재 ZIP 가져오기</button><p className="setup-note">교재와 학습 기록은 이 브라우저에 저장됩니다. PC와 휴대폰은 자동으로 동기화되지 않으며, 기존 PC 기록은 원래 주소에 보존됩니다. 중요한 기록은 JSON으로 백업해 두세요.</p><p className="setup-note">HTTPS에서 앱과 교재를 한 번 불러온 뒤 오프라인 학습을 사용할 수 있습니다.</p></div> : !onComputer ? <div className="panel"><h2>이 휴대폰에서 학습하기</h2><p>연결 코드로 접속을 마쳤습니다. 교재를 한 번 가져오면 이 브라우저의 문제은행에 저장됩니다.</p><button className="button primary" onClick={onImport}>교재 가져오기</button><p className="setup-note">PC와 휴대폰의 답안·북마크·응시 기록은 각각 저장됩니다.</p></div> : <div className="panel">
      {loading && <p role="status">연결 정보를 불러오는 중...</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {connection && connection.enabled && connection.urls.length > 0 ? <><h2>휴대폰 브라우저에서 이 주소를 여세요</h2><div className="phone-addresses">{connection.urls.map((url) => <a key={url} href={url}>{url}</a>)}</div><p>휴대폰에 나타나는 연결 화면에 아래 코드를 입력하세요.</p><div className="phone-code"><span>연결 코드</span><strong>{connection.pairingCode}</strong></div><ol><li>Mac과 휴대폰을 같은 Wi-Fi에 연결합니다.</li><li>휴대폰 Safari 또는 Chrome에서 위 주소를 입력합니다.</li><li>연결 코드를 입력한 뒤 ‘교재 ZIP → 이 컴퓨터의 교재 불러오기 → 전체 등록’을 실행합니다.</li><li>과목과 20문항 묶음을 선택해 학습합니다.</li></ol><p className="setup-note">휴대폰에서 localhost는 휴대폰 자신을 가리킵니다. 위의 Mac 주소를 사용하세요. 주소나 연결 코드는 서버 재실행 또는 Wi-Fi 변경 시 달라질 수 있습니다.</p></> : !loading && !error && <><h2>연결 가능한 Wi-Fi 주소가 없습니다</h2><p>Mac을 Wi-Fi에 연결한 뒤 서버 시작 파일을 다시 실행해 주세요.</p></>}
    </div>}
  </section>;
}
