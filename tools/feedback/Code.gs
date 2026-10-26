// Arch Canvas 피드백 받기 (구글 시트 + Apps Script)
// 1) 구글 시트를 하나 만들고 [확장 프로그램 > Apps Script] 에 이 코드를 그대로 붙여 넣는다.
// 2) [배포 > 새 배포 > 유형: 웹 앱] · 다음 사용자 인증 정보로 실행: 나 · 액세스 권한이 있는 사용자: 모든 사용자 → [배포]
// 3) 나온 웹 앱 URL(https://script.google.com/macros/s/…/exec)을 앱의 FEEDBACK_URL 에 넣는다.
// 피드백은 이 시트의 '피드백' 탭에 한 줄씩 쌓이고, NOTIFY 가 true 면 내 Gmail 로 알림이 간다.

const NOTIFY = true;

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.hp) return out({ ok: true });   // 사람 눈에 안 보이는 칸이 채워져 있으면 자동 스팸
    const text = cut(d.text, 4000);
    if (!text.trim()) return out({ ok: false, error: 'empty' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('피드백') || ss.insertSheet('피드백');
    if (sh.getLastRow() === 0) {
      sh.appendRow(['받은 시각', '종류', '내용', '보낸 사람', '버전', '앱', '환경']);
      sh.setFrozenRows(1);
    }
    const row = [new Date(), cut(d.kind, 10), text, cut(d.name, 60), cut(d.version, 20), cut(d.app, 10), cut(d.env, 600)];
    sh.appendRow(row.map((v, i) => (i === 0 ? v : safe(v))));
    if (NOTIFY) {
      MailApp.sendEmail(
        Session.getEffectiveUser().getEmail(),
        `[Arch Canvas 피드백] [${row[1]}] ${text.split('\n')[0].slice(0, 60)}`,
        `${text}\n\n보낸 사람: ${row[3] || '-'}\n버전: ${row[4]} (${row[5]})\n${row[6]}\n\n모아 보기: ${ss.getUrl()}`
      );
    }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 브라우저로 주소를 열면 살아 있는지만 알려 준다
function doGet() {
  return out({ ok: true, app: 'arch-canvas-feedback' });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function cut(v, n) {
  return String(v == null ? '' : v).slice(0, n);
}
// = + - @ 로 시작하면 시트가 수식으로 읽으므로 글자로 넣는다
function safe(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
