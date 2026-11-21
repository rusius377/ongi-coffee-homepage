/**
 * @OnlyCurrentDoc
 */
/* =============================================================
   온기커피 · 예약 폼 서버 (Google Apps Script 웹 앱)
   -------------------------------------------------------------
   홈페이지 예약 폼이 보낸 내용을 검사해서
   ① 이 구글시트의 '예약' 탭에 한 줄 추가하고
   ② 사장님 이메일로 알림을 보내요.

   ※ 이 파일은 구글 Apps Script 편집기에 붙여 넣어서 써요.
     저장소에 있는 건 기록용 사본이고, 홈페이지(Vercel)에는 올라가지 않아요.

   ▶ 처음 설정 (구글 화면에서)
     1. 이 시트에서 [확장 프로그램 → Apps Script]를 열고 이 코드를 통째로 붙여 넣기 → 저장
     2. ⚙️ 프로젝트 설정 → 시간대: (GMT+09:00) 서울
     3. ⚙️ 프로젝트 설정 → 스크립트 속성 → OWNER_EMAIL = 알림 받을 이메일
     4. 위쪽 함수 목록에서 setup 선택 → 실행 → 권한 허용
     5. (선택) testReservation 실행 → 시트에 '테스트' 줄과 알림 메일이 오는지 확인
     6. 배포 → 새 배포 → 웹 앱 / 실행 사용자: 나 / 액세스 권한: 모든 사용자
     7. 나온 '…/exec' 주소를 js/main.js 의 RESERVATION.endpoint 에 넣기

   ▶ 코드를 고친 뒤에는 꼭
     배포 → 배포 관리 → ✏️ → 버전: 새 버전 → 배포
     (저장만 하면 웹 앱에 반영되지 않아요. '새 배포'를 누르면 주소가 바뀌어요)

   ▶ 홈페이지와 주고받는 약속
     보내는 값(POST, 일반 폼 형식):
       name, phone, date(YYYY-MM-DD), time(HH:MM), people, request(선택),
       consent('yes'), website(함정 칸 — 비어 있어야 함), elapsed(폼을 연 뒤 지난 ms)
     돌려주는 값(JSON):
       성공  { ok: true,  id: 'R-1121-007' }
       중복  { ok: false, code: 'duplicate', id: '처음 접수번호' }
       오류  { ok: false, code: 'invalid', field: '문제 있는 칸 이름' }
             { ok: false, code: 'rate_limited' | 'busy' | 'server' }
   ============================================================= */

/* ✏️ 예약 규칙 — 홈페이지 js/main.js 의 OPENING_HOURS · RESERVATION 과 똑같이 맞춰 주세요.
      (화면에서 막아도 누구나 이 주소로 직접 보낼 수 있어서, 여기서 한 번 더 검사해요) */
const CONFIG = {
  SHEET_NAME: '예약',
  TIME_ZONE: 'Asia/Seoul',

  FIRST_SLOT: '10:00',          // 첫 예약 시간 (여는 시간)
  LAST_SLOT: '20:00',           // 마지막 예약 시간 (닫기 1시간 전)
  SLOT_MINUTES: 30,             // 예약 시간 간격
  CLOSED_DAYS: [1],             // 쉬는 요일: 0=일, 1=월 … 6=토
  MAX_DAYS_AHEAD: 30,           // 오늘부터 며칠 뒤까지 예약 가능
  SAME_DAY_LEAD_MINUTES: 60,    // 당일 예약은 지금부터 몇 분 뒤 시간부터
  MAX_PEOPLE: 8,                // 이보다 많으면 전화로 안내

  NAME_MAX: 20,                 // 이름 최대 글자 수
  REQUEST_MAX: 200,             // 요청사항 최대 글자 수

  MIN_FILL_MS: 3000,            // 폼을 연 지 3초 안에 제출하면 로봇으로 판단
  DUPLICATE_WINDOW_SEC: 600,    // 같은 연락처·날짜·시간을 10분 안에 또 보내면 중복
  HOURLY_LIMIT: 30,             // 1시간에 받을 수 있는 최대 접수 수 (메일 한도 보호)

  RETENTION_DAYS: 30,           // 방문일이 지나고 며칠 뒤에 자동 삭제 (동의 문구의 보유 기간과 맞추기)
};

const STATUS = ['대기', '확정', '취소'];
const HEADERS = ['접수번호', '접수 시각', '처리 상태', '이름', '연락처', '방문 날짜', '방문 시간', '인원', '요청사항', '개인정보 동의', '사장님 메모'];
const COL = { STATUS: 3, VISIT_DATE: 6 }; // 1부터 세는 열 번호
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];


/* ===================== 1. 홈페이지 → 예약 접수 ===================== */

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};

    // ① 스팸: 함정 칸이 채워졌거나, 너무 빨리 제출됐거나, 시간 정보가 없으면
    //    → 로봇이 눈치채지 못하게 '성공'처럼 답하고 저장하지 않아요
    const elapsed = Number(p.elapsed);
    if (clean_(p.website) !== '' || !isFinite(elapsed) || elapsed < CONFIG.MIN_FILL_MS) {
      return json_({ ok: true, id: makeId_(now_(), Math.floor(Math.random() * 900) + 100) });
    }

    // ② 내용 검사
    const checked = validate_(p);
    if (checked.error) return json_({ ok: false, code: 'invalid', field: checked.error });
    const r = checked.data;

    // ③ 동시에 여러 건이 와도 한 건씩 처리
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return json_({ ok: false, code: 'busy' });

    let id;
    const cache = CacheService.getScriptCache();
    try {
      // ④ 같은 연락처 + 날짜 + 시간이 10분 안에 또 들어오면 중복
      const dupKey = 'dup:' + sha256_(r.phoneDigits + '|' + r.date + '|' + r.time);
      const prevId = cache.get(dupKey);
      if (prevId) return json_({ ok: false, code: 'duplicate', id: prevId });

      // ⑤ 1시간 접수 한도
      const rateKey = 'rate:' + Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyyMMddHH');
      const count = Number(cache.get(rateKey) || 0);
      if (count >= CONFIG.HOURLY_LIMIT) return json_({ ok: false, code: 'rate_limited' });

      // ⑥ 시트에 저장
      id = appendReservation_(r);
      cache.put(dupKey, id, CONFIG.DUPLICATE_WINDOW_SEC);
      cache.put(rateKey, String(count + 1), 3600);
    } finally {
      lock.releaseLock();
    }

    // ⑦ 알림 메일 — 실패해도 예약은 이미 저장됐으니 성공으로 답해요
    try {
      notifyOwner_(r, id);
    } catch (mailErr) {
      console.error('알림 메일 실패: ' + mailErr);
    }

    return json_({ ok: true, id: id });
  } catch (err) {
    console.error('예약 처리 실패: ' + (err && err.stack ? err.stack : err));
    return json_({ ok: false, code: 'server' });
  }
}

// 브라우저로 /exec 주소를 열면 작동 여부만 알려 줘요 (테스트용)
function doGet() {
  return json_({ ok: true, service: 'ongi-reservation' });
}


/* ===================== 2. 내용 검사 ===================== */

function validate_(p) {
  const now = now_();

  // 이름
  const name = clean_(p.name).replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > CONFIG.NAME_MAX) return { error: 'name' };

  // 연락처: 숫자만 남겨서 0으로 시작하는 9~11자리
  const phoneDigits = String(p.phone || '').replace(/\D/g, '');
  if (!/^0\d{8,10}$/.test(phoneDigits)) return { error: 'phone' };

  // 방문 날짜: 실제 있는 날짜 / 오늘 ~ 30일 뒤 / 휴무일 아님
  const date = clean_(p.date);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return { error: 'date' };
  const visitUtc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const visit = new Date(visitUtc);
  if (visit.getUTCFullYear() !== +m[1] || visit.getUTCMonth() !== +m[2] - 1 || visit.getUTCDate() !== +m[3]) {
    return { error: 'date' }; // 2월 30일 같은 없는 날짜
  }
  const daysAhead = Math.round((visitUtc - now.utcDay) / 86400000);
  if (daysAhead < 0 || daysAhead > CONFIG.MAX_DAYS_AHEAD) return { error: 'date' };
  const weekday = visit.getUTCDay();
  if (CONFIG.CLOSED_DAYS.indexOf(weekday) !== -1) return { error: 'date' };

  // 방문 시간: 예약 가능한 시간 칸 중 하나 / 당일이면 지금부터 1시간 뒤부터
  const time = clean_(p.time);
  if (!/^\d{2}:\d{2}$/.test(time)) return { error: 'time' };
  const t = toMinutes_(time);
  const first = toMinutes_(CONFIG.FIRST_SLOT);
  if (t < first || t > toMinutes_(CONFIG.LAST_SLOT) || (t - first) % CONFIG.SLOT_MINUTES !== 0) {
    return { error: 'time' };
  }
  if (daysAhead === 0 && t < now.minutes + CONFIG.SAME_DAY_LEAD_MINUTES) return { error: 'time' };

  // 인원
  const peopleText = clean_(p.people);
  if (!/^\d{1,2}$/.test(peopleText)) return { error: 'people' };
  const people = Number(peopleText);
  if (people < 1 || people > CONFIG.MAX_PEOPLE) return { error: 'people' };

  // 요청사항 (선택)
  const request = String(p.request || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim();
  if (request.length > CONFIG.REQUEST_MAX) return { error: 'request' };

  // 개인정보 동의 (필수)
  if (p.consent !== 'yes') return { error: 'consent' };

  return {
    data: {
      name: name,
      phoneDigits: phoneDigits,
      phone: formatPhone_(phoneDigits),
      date: date,
      dateLabel: date + ' (' + DAY_NAMES[weekday] + ')',
      shortDateLabel: (+m[2]) + '/' + (+m[3]) + '(' + DAY_NAMES[weekday] + ')',
      time: time,
      people: people,
      request: request,
    },
  };
}


/* ===================== 3. 시트에 저장 ===================== */

function appendReservation_(r) {
  const sheet = getSheet_();
  const now = now_();
  const id = nextId_(now);
  const row = sheet.getLastRow() + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);

  const values = [
    id,
    now.text,                     // 접수 시각
    STATUS[0],                    // 처리 상태: 대기
    safeCell_(r.name),
    r.phone,
    r.dateLabel,
    r.time,
    r.people,
    safeCell_(r.request),
    '동의 (' + now.text.slice(11, 16) + ')',
    '',                           // 사장님 메모
  ];

  // 전부 '글자'로 저장해요 (연락처 맨 앞 0, 날짜가 엉뚱하게 바뀌지 않게). 인원만 숫자.
  const formats = HEADERS.map(function (_, i) { return i === 7 ? '0' : '@'; });
  const range = sheet.getRange(row, 1, 1, HEADERS.length);
  range.setNumberFormats([formats]);
  range.setValues([values]);
  sheet.getRange(row, COL.STATUS).setDataValidation(statusRule_());
  return id;
}

// 접수번호: R-월일-그날 순번 (예: R-1121-007)
function nextId_(now) {
  const props = PropertiesService.getScriptProperties();
  const today = now.text.slice(0, 10);
  const seq = props.getProperty('SEQ_DATE') === today ? Number(props.getProperty('SEQ_NUM') || 0) + 1 : 1;
  props.setProperties({ SEQ_DATE: today, SEQ_NUM: String(seq) });
  return makeId_(now, seq);
}

function makeId_(now, seq) {
  return 'R-' + now.text.slice(5, 7) + now.text.slice(8, 10) + '-' + ('00' + seq).slice(-3);
}

// 시트 수식 주입 방지: = + - @ 로 시작하면 앞에 ' 를 붙여 그냥 글자로 저장
function safeCell_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}


/* ===================== 4. 사장님께 알림 메일 ===================== */

function notifyOwner_(r, id) {
  const to = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  if (!to) {
    console.warn('OWNER_EMAIL 이 비어 있어서 알림 메일을 보내지 않았어요. (프로젝트 설정 → 스크립트 속성)');
    return;
  }
  if (MailApp.getRemainingDailyQuota() < 1) {
    console.warn('오늘 보낼 수 있는 메일 한도를 다 써서 알림을 보내지 않았어요. 시트를 직접 확인해 주세요.');
    return;
  }

  const sheet = getSheet_();
  const sheetUrl = sheet.getParent().getUrl() + '#gid=' + sheet.getSheetId();
  const subject = '[온기커피] 새 예약 요청 · ' + r.shortDateLabel + ' ' + r.time + ' · ' + r.people + '명';
  const body = [
    '새 예약 요청이 들어왔어요. 확인 후 시트에서 처리 상태를 바꿔 주세요.',
    '',
    '접수번호   ' + id,
    '이름       ' + r.name,
    '연락처     ' + r.phone,
    '방문       ' + r.dateLabel + ' ' + r.time,
    '인원       ' + r.people + '명',
    '요청사항   ' + (r.request || '없음'),
    '',
    '예약 시트 열기: ' + sheetUrl,
    '',
    '※ 데모용 예약 폼에서 보낸 알림이에요.',
  ].join('\n');

  MailApp.sendEmail({ to: to, subject: subject, body: body, name: '온기커피 예약 알림' });
}


/* ===================== 5. 처음 한 번 실행: 시트 꾸미기 ===================== */

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(CONFIG.TIME_ZONE);

  const sheet = getSheet_();
  const lastCol = HEADERS.length;

  // 제목 줄
  sheet.getRange(1, 1, 1, lastCol)
    .setValues([HEADERS])
    .setFontWeight('bold')
    .setBackground('#F3EBE2')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  // 열 너비 · 줄바꿈
  [100, 140, 80, 90, 120, 130, 75, 50, 260, 110, 200].forEach(function (w, i) {
    sheet.setColumnWidth(i + 1, w);
  });
  sheet.getRange(2, 9, sheet.getMaxRows() - 1, 1).setWrap(true); // 요청사항

  // 처리 상태: 대기/확정/취소 드롭다운
  sheet.getRange(2, COL.STATUS, sheet.getMaxRows() - 1, 1).setDataValidation(statusRule_());

  // 처리 상태 색깔 (열 전체에 걸어서 새 줄에도 적용돼요)
  const statusCol = sheet.getRange('C:C');
  const others = sheet.getConditionalFormatRules().filter(function (rule) {
    return !rule.getRanges().some(function (rg) { return rg.getA1Notation() === statusCol.getA1Notation(); });
  });
  const color = function (text, bg, font) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(text).setBackground(bg).setFontColor(font)
      .setRanges([statusCol]).build();
  };
  sheet.setConditionalFormatRules(others.concat([
    color('대기', '#FFF4CC', '#6B4E00'),
    color('확정', '#DCF2E0', '#1E5B2E'),
    color('취소', '#ECECEC', '#666666'),
  ]));

  // 지난 예약 자동 삭제: 매일 새벽 4시 (중복으로 생기지 않게 기존 것은 지우고 다시 만들어요)
  ScriptApp.getProjectTriggers()
    .filter(function (tr) { return tr.getHandlerFunction() === 'cleanupOldReservations'; })
    .forEach(function (tr) { ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('cleanupOldReservations').timeBased().everyDays(1).atHour(4).inTimezone(CONFIG.TIME_ZONE).create();

  // 마무리 안내 (실행 로그에 보여요)
  const owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  console.log('✅ 시트 준비 완료: ' + ss.getUrl());
  console.log(owner ? '✅ 알림 받을 메일: ' + owner : '⚠️ OWNER_EMAIL 이 비어 있어요. 프로젝트 설정 → 스크립트 속성에서 추가해 주세요.');
  if (Session.getScriptTimeZone() !== CONFIG.TIME_ZONE) {
    console.log('⚠️ 프로젝트 시간대가 ' + Session.getScriptTimeZone() + ' 이에요. 프로젝트 설정에서 (GMT+09:00) 서울로 바꿔 주세요.');
  }
}


/* ===================== 6. 매일 자동 실행: 지난 예약 삭제 ===================== */

function cleanupOldReservations() {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return;

  const cutoff = now_().utcDay - CONFIG.RETENTION_DAYS * 86400000;
  const dates = sheet.getRange(2, COL.VISIT_DATE, last - 1, 1).getValues();
  let removed = 0;

  // 아래에서 위로 지워야 줄 번호가 밀리지 않아요
  for (let i = dates.length - 1; i >= 0; i--) {
    const v = dates[i][0];
    const text = v instanceof Date ? Utilities.formatDate(v, CONFIG.TIME_ZONE, 'yyyy-MM-dd') : String(v);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (m && Date.UTC(+m[1], +m[2] - 1, +m[3]) < cutoff) {
      sheet.deleteRow(i + 2);
      removed++;
    }
  }
  console.log('지난 예약 ' + removed + '건 삭제');
}


/* ===================== 7. 편집기에서 실행해 보는 테스트 ===================== */

// 실제 홈페이지 없이 예약 한 건을 넣어 봐요. 시트에 '테스트' 줄과 알림 메일이 오면 성공.
// (10분 안에 다시 실행하면 중복으로 막혀요 — 정상이에요)
function testReservation() {
  const now = now_();
  let d = new Date(now.utcDay + 86400000);
  while (CONFIG.CLOSED_DAYS.indexOf(d.getUTCDay()) !== -1) d = new Date(d.getTime() + 86400000);

  const result = doPost({
    parameter: {
      name: '테스트',
      phone: '010-0000-0000',
      date: Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd'),
      time: '14:00',
      people: '2',
      request: '창가 자리 부탁드려요 (테스트)',
      consent: 'yes',
      website: '',
      elapsed: '5000',
    },
  });
  console.log(result.getContent());
}


/* ===================== 도우미 ===================== */

function getSheet_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME, 0);
}

function statusRule_() {
  return SpreadsheetApp.newDataValidation().requireValueInList(STATUS, true).setAllowInvalid(false).build();
}

// 지금 한국 시간: 글자, 오늘 날짜(UTC 자정 기준 숫자), 자정부터 지난 분
function now_() {
  const text = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
  return {
    text: text,
    utcDay: Date.UTC(+text.slice(0, 4), +text.slice(5, 7) - 1, +text.slice(8, 10)),
    minutes: toMinutes_(text.slice(11, 16)),
  };
}

function toMinutes_(hhmm) {
  const parts = hhmm.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function clean_(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

// 010-1234-5678 / 02-123-4567 / 031-123-4567 처럼 하이픈 넣기
function formatPhone_(d) {
  if (d.indexOf('02') === 0) return d.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3');
  return d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
}

function sha256_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
