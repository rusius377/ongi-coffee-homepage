/* =============================================================
   온기커피 · main.js
   -------------------------------------------------------------
   이 파일은 편의 기능만 담당해요. 꺼져 있어도 모든 내용은 보입니다.
     1. 스크롤하면 섹션이 살짝 떠오르는 효과
     2. 휴대폰 메뉴 열기/닫기
     3. 스크롤 시 헤더 그림자
     4. '지금 영업 중' 자동 표시
     5. 갤러리 사진 크게 보기
     6. 아직 연결되지 않은 링크(href="#") 안내
     7. 푸터 연도 자동 표시
     8. 예약 폼 (구글시트로 보내기)

   ✏️ 영업시간이 바뀌면 바로 아래 OPENING_HOURS 만 고치면 돼요.
      (index.html 의 영업시간 표도 함께 고쳐 주세요)
   ✏️ 예약 규칙을 바꾸면 apps-script/Code.gs 의 CONFIG 도 똑같이 고치고 다시 배포해 주세요.
   ============================================================= */

const OPENING_HOURS = {
  open: '10:00',     // 여는 시간 (24시간 형식) — 첫 예약 시간이기도 해요
  close: '21:00',    // 닫는 시간
  closedDays: [1],   // 쉬는 요일: 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토  (예: 월·화 휴무면 [1, 2])
};

const RESERVATION = {
  // 구글 Apps Script 웹 앱 주소 (…/exec). 비워 두면 폼에서 '전화로 예약해 주세요' 안내가 떠요.
  endpoint: 'https://script.google.com/macros/s/AKfycbyBSCkkSAc3x-axbwh0uH_7DIp266cj_fBgCcGbPH40irevBlX5VPhP0lpmRR7Lc9d3/exec',
  lastSlot: '20:00',        // 마지막 예약 시간 (닫기 1시간 전)
  slotMinutes: 30,          // 예약 시간 간격(분)
  maxDaysAhead: 30,         // 오늘부터 며칠 뒤까지 예약 가능
  sameDayLeadMinutes: 60,   // 당일 예약은 지금부터 몇 분 뒤 시간부터
  maxPeople: 8,             // 최대 인원 (더 많으면 전화로 안내)
  phone: '02-000-0000',     // 접수에 실패했을 때 안내할 전화번호
};

(function () {
  'use strict';

  const TIME_ZONE = 'Asia/Seoul'; // 해외에서 접속해도 한국 시간 기준으로 판단
  const DAY_NAMES = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const desktopQuery = window.matchMedia('(min-width: 1024px)');

  /* ---------- 1. 스크롤 등장 효과 ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  /* ---------- 2. 휴대폰 메뉴 ---------- */
  const navToggle = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-nav]');

  function setNav(open) {
    if (!navToggle || !nav) return;
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    nav.classList.toggle('is-open', open);
  }

  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      setNav(navToggle.getAttribute('aria-expanded') !== 'true');
    });
    nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setNav(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        setNav(false);
        navToggle.focus();
      }
    });
    document.addEventListener('click', (e) => {
      if (nav.classList.contains('is-open') && !nav.contains(e.target) && !navToggle.contains(e.target)) {
        setNav(false);
      }
    });
    desktopQuery.addEventListener('change', () => setNav(false));
  }

  /* ---------- 3. 헤더 그림자 ---------- */
  const header = document.querySelector('[data-header]');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- 4. 지금 영업 중 표시 ---------- */
  const statusEls = document.querySelectorAll('[data-open-status]');

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  // 지금 한국 시간: 요일(0=일), 자정부터 지난 분, 오늘 날짜(UTC 자정 기준 숫자 — 날짜 계산용)
  function getSeoulNow() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    const dayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')];
    return {
      day: dayIndex,
      minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
      date: Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))),
    };
  }

  // 다음 영업일 이름: 내일이면 '내일', 아니면 '화요일' 처럼
  function nextOpenDayLabel(today) {
    for (let i = 1; i <= 7; i += 1) {
      const day = (today + i) % 7;
      if (!OPENING_HOURS.closedDays.includes(day)) {
        return i === 1 ? '내일' : DAY_NAMES[day];
      }
    }
    return '';
  }

  function getStatus() {
    const { day, minutes } = getSeoulNow();
    const open = toMinutes(OPENING_HOURS.open);
    const close = toMinutes(OPENING_HOURS.close);

    if (OPENING_HOURS.closedDays.includes(day)) {
      return { isOpen: false, text: `오늘은 정기 휴무 · ${nextOpenDayLabel(day)} ${OPENING_HOURS.open} 오픈` };
    }
    if (minutes < open) {
      return { isOpen: false, text: `영업 준비 중 · 오늘 ${OPENING_HOURS.open} 오픈` };
    }
    if (minutes < close) {
      return { isOpen: true, text: `지금 영업 중 · ${OPENING_HOURS.close}까지` };
    }
    return { isOpen: false, text: `영업 종료 · ${nextOpenDayLabel(day)} ${OPENING_HOURS.open} 오픈` };
  }

  function renderStatus() {
    const status = getStatus();
    statusEls.forEach((el) => {
      el.classList.toggle('is-open', status.isOpen);
      el.classList.toggle('is-closed', !status.isOpen);
      const text = el.querySelector('.status__text');
      if (text) text.textContent = status.text;
    });
  }

  if (statusEls.length) {
    renderStatus();
    setInterval(renderStatus, 60 * 1000); // 1분마다 다시 확인
  }

  /* ---------- 5. 갤러리 크게 보기 ---------- */
  const lightbox = document.querySelector('[data-lightbox]');
  const galleryItems = Array.from(document.querySelectorAll('[data-gallery-item]'));

  if (lightbox && galleryItems.length && typeof lightbox.showModal === 'function') {
    const lbImg = lightbox.querySelector('[data-lightbox-img]');
    const lbCaption = lightbox.querySelector('[data-lightbox-caption]');
    const lbCount = lightbox.querySelector('[data-lightbox-count]');
    const lbStage = lightbox.querySelector('[data-lightbox-stage]');
    let current = 0;
    let lastTrigger = null;

    function show(index) {
      current = (index + galleryItems.length) % galleryItems.length;
      const item = galleryItems[current];
      const thumb = item.querySelector('img');
      const alt = thumb ? thumb.alt : '';
      lbImg.src = item.getAttribute('href');
      lbImg.alt = alt;
      lbCaption.textContent = alt;
      lbCount.textContent = `${current + 1} / ${galleryItems.length}`;
    }

    galleryItems.forEach((item, index) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        lastTrigger = item;
        show(index);
        lightbox.showModal();
      });
    });

    lightbox.querySelector('[data-lightbox-close]').addEventListener('click', () => lightbox.close());
    lightbox.querySelector('[data-lightbox-prev]').addEventListener('click', () => show(current - 1));
    lightbox.querySelector('[data-lightbox-next]').addEventListener('click', () => show(current + 1));

    // 사진 바깥 어두운 곳을 누르면 닫기
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox || e.target === lbStage) lightbox.close();
    });

    // 키보드: ← → 로 넘기기 (Esc 닫기는 브라우저가 기본으로 처리)
    lightbox.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
    });

    // 휴대폰: 좌우로 밀어서 넘기기
    let touchStartX = null;
    lightbox.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    lightbox.addEventListener('touchend', (e) => {
      if (touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) show(dx > 0 ? current - 1 : current + 1);
      touchStartX = null;
    });

    // 닫으면 누른 사진으로 포커스 되돌리기
    lightbox.addEventListener('close', () => {
      if (lastTrigger) lastTrigger.focus();
    });
  }

  /* ---------- 6. 아직 연결되지 않은 링크 안내 ---------- */
  const toast = document.querySelector('[data-toast]');
  let toastTimer = null;

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }

  document.querySelectorAll('[data-link-pending]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = (link.getAttribute('href') || '').trim();
      if (href === '' || href === '#') {
        e.preventDefault();
        showToast(link.dataset.linkPending || '아직 링크가 연결되지 않았어요.');
      }
    });
  });

  /* ---------- 7. 푸터 연도 ---------- */
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---------- 8. 예약 폼 ---------- */
  const reserve = document.querySelector('[data-reserve]');
  if (reserve) initReservation(reserve);

  function initReservation(root) {
    const form = root.querySelector('[data-reserve-form]');
    const dateSel = form.querySelector('[data-reserve-date]');
    const timeSel = form.querySelector('[data-reserve-time]');
    const peopleSel = form.querySelector('[data-reserve-people]');
    const requestEl = form.querySelector('[data-reserve-request]');
    const countEl = form.querySelector('[data-reserve-count]');
    const alertEl = form.querySelector('[data-reserve-alert]');
    const submitBtn = form.querySelector('[data-reserve-submit]');
    const done = root.querySelector('[data-reserve-done]');
    const doneTitle = root.querySelector('[data-reserve-done-title]');
    const doneDesc = root.querySelector('[data-reserve-done-desc]');
    const summary = root.querySelector('[data-reserve-summary]');

    const DAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];
    const DAY_MS = 24 * 60 * 60 * 1000;
    const TIMEOUT_MS = 15000;               // 15초 안에 답이 없으면 실패로 안내
    const DUP_WINDOW_MS = 10 * 60 * 1000;   // 같은 연락처·날짜·시간 10분 안 재전송 막기
    const DUP_STORE_KEY = 'ongi-reserve-last';
    const SUBMIT_LABEL = submitBtn.textContent;
    const pageOpenedAt = Date.now();        // 스팸 방지: 열자마자 제출하면 서버가 걸러요
    let sending = false;

    const pad = (n) => String(n).padStart(2, '0');
    const toHHMM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
    const digitsOf = (text) => text.replace(/\D/g, '');
    // 전각 숫자(０１０)·여러 가지 줄표(－ – —)를 보통 숫자와 하이픈으로
    const toHalfWidth = (text) => text
      .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[\uFF0D\u2010-\u2015\u2212]/g, '-');
    // 눈에 안 보이는 글자(폭 없는 공백, 글자 방향 문자, 한글 채움 문자 등) — 이것만으로 된 이름은 막아요
    // (apps-script/Code.gs 의 INVISIBLE 과 같은 목록)
    const INVISIBLE = /[\s\u00AD\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]/g;

    // 오류 칸·안내로 이동: 화면 가운데로 스크롤 (아이폰은 상단 고정 헤더를 고려하지 않아서 직접 맞춰요)
    function focusAndReveal(el) {
      el.focus({ preventScroll: true });
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    }

    // --- 예약 가능한 날짜·시간 계산 (한국 시간 기준) ---
    function slotsFor(offset, now) {
      const slots = [];
      const last = toMinutes(RESERVATION.lastSlot);
      for (let t = toMinutes(OPENING_HOURS.open); t <= last; t += RESERVATION.slotMinutes) {
        if (offset !== 0 || t >= now.minutes + RESERVATION.sameDayLeadMinutes) slots.push(toHHMM(t));
      }
      return slots;
    }

    function availableDates() {
      const now = getSeoulNow();
      const list = [];
      for (let i = 0; i <= RESERVATION.maxDaysAhead; i += 1) {
        const d = new Date(now.date + i * DAY_MS);
        if (OPENING_HOURS.closedDays.includes(d.getUTCDay())) continue;
        const slots = slotsFor(i, now);
        if (!slots.length) continue;
        const tag = i === 0 ? ' · 오늘' : i === 1 ? ' · 내일' : '';
        list.push({
          value: d.toISOString().slice(0, 10),
          label: `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${DAY_SHORT[d.getUTCDay()]})${tag}`,
          slots,
        });
      }
      return list;
    }

    function fillSelect(select, placeholder, items) {
      const keep = select.value;
      select.replaceChildren(new Option(placeholder, ''));
      items.forEach((it) => select.add(new Option(it.label, it.value)));
      select.value = items.some((it) => it.value === keep) ? keep : '';
    }

    function refreshChoices() {
      const dates = availableDates();
      fillSelect(dateSel, '날짜 선택', dates);
      const picked = dates.find((d) => d.value === dateSel.value);
      const slots = picked ? picked.slots : slotsFor(-1, getSeoulNow()); // 날짜 전엔 전체 시간
      fillSelect(timeSel, '시간 선택', slots.map((s) => ({ value: s, label: s })));
      return dates;
    }

    for (let n = 1; n <= RESERVATION.maxPeople; n += 1) peopleSel.add(new Option(`${n}명`, String(n)));
    refreshChoices();

    // --- 오류 표시 ---
    const MESSAGES = {
      name: '이름을 입력해 주세요.',
      phone: '연락처를 숫자로 정확히 입력해 주세요. (예: 010-1234-5678)',
      date: '방문 날짜를 골라 주세요.',
      dateGone: '선택한 날짜는 이제 예약할 수 없어요. 다시 골라 주세요.',
      time: '방문 시간을 골라 주세요.',
      timeGone: '선택한 시간은 이제 예약할 수 없어요. 다시 골라 주세요.',
      people: `인원을 골라 주세요. (${RESERVATION.maxPeople}명까지, 그 이상은 전화로)`,
      request: '요청사항은 200자까지 쓸 수 있어요.',
      consent: '개인정보 수집·이용에 동의해 주세요.',
    };

    function setError(field, message) {
      const input = form.elements.namedItem(field);
      const box = form.querySelector(`[data-error-for="${field}"]`);
      if (box) box.textContent = message || '';
      if (input) {
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    }

    function clearErrors() {
      Object.keys(MESSAGES).forEach((f) => setError(f, ''));
    }

    // role="alert" 상자: 같은 문구가 다시 떠도 화면 낭독기가 읽도록 비웠다가 채워요
    function showAlert(build) {
      alertEl.replaceChildren();
      if (build) setTimeout(() => build(alertEl), 60);
    }

    function showFailure(reason) {
      const lead = {
        offline: '인터넷 연결이 끊겨 있어요.',
        notReady: '온라인 예약은 아직 준비 중이에요.',
        failed: '예약 요청을 보내지 못했어요.',
      }[reason];
      showAlert((box) => {
        const tel = document.createElement('a');
        tel.href = `tel:${digitsOf(RESERVATION.phone)}`;
        tel.textContent = RESERVATION.phone;
        const retry = reason === 'notReady' ? '' : ' 잠시 후 다시 보내시거나';
        box.append(`${lead}${retry} 전화(`, tel, ')로 예약해 주세요.');
      });
    }

    // --- 입력할 때마다 ---
    form.addEventListener('input', (e) => {
      if (e.target.name) setError(e.target.name, '');
      if (e.target === requestEl) countEl.textContent = `${requestEl.value.length} / 200자`;
    });
    form.addEventListener('change', (e) => {
      if (e.target === dateSel) refreshChoices();
      if (e.target.name) setError(e.target.name, '');
    });
    // 탭을 오래 열어 뒀다가 돌아오면 지난 시간을 목록에서 빼요
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !sending) refreshChoices();
    });

    // --- 검사 ---
    function collect() {
      return {
        name: form.elements.namedItem('name').value.trim().replace(/\s+/g, ' '),
        phone: toHalfWidth(form.elements.namedItem('phone').value).trim(),
        date: dateSel.value,
        time: timeSel.value,
        people: peopleSel.value,
        request: requestEl.value.trim(),
        consent: form.elements.namedItem('consent').checked,
      };
    }

    function validate(data) {
      const errors = {};
      if (!data.name.replace(INVISIBLE, '')) errors.name = MESSAGES.name;
      if (!/^0\d{8,10}$/.test(digitsOf(data.phone))) errors.phone = MESSAGES.phone;
      // 폼을 오래 열어 둔 사이 날짜·시간이 지났는지 다시 확인
      const selDate = data.date;
      const selTime = data.time;
      const dates = refreshChoices();
      const picked = dates.find((d) => d.value === selDate);
      if (!selDate) errors.date = MESSAGES.date;
      else if (!picked) errors.date = MESSAGES.dateGone;
      if (!selTime) errors.time = MESSAGES.time;
      else if (picked && !picked.slots.includes(selTime)) errors.time = MESSAGES.timeGone;
      if (!data.people) errors.people = MESSAGES.people;
      if (data.request.length > 200) errors.request = MESSAGES.request;
      if (!data.consent) errors.consent = MESSAGES.consent;
      return errors;
    }

    // --- 같은 예약 다시 보내기 막기 (이 탭에서만, 저장이 막힌 브라우저에선 건너뜀) ---
    function readLast() {
      try { return JSON.parse(sessionStorage.getItem(DUP_STORE_KEY)); } catch (e) { return null; }
    }
    function saveLast(key, id) {
      try { sessionStorage.setItem(DUP_STORE_KEY, JSON.stringify({ key, id, at: Date.now() })); } catch (e) { /* 무시 */ }
    }

    function setSending(on) {
      sending = on;
      submitBtn.setAttribute('aria-disabled', String(on)); // disabled 대신: 포커스를 잃지 않게
      submitBtn.textContent = on ? '보내는 중…' : SUBMIT_LABEL;
      form.setAttribute('aria-busy', String(on));
    }

    async function send(payload) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        // 일반 폼 형식으로 보내야 브라우저 사전 확인(CORS) 없이 Apps Script가 받아요
        const res = await fetch(RESERVATION.endpoint, {
          method: 'POST',
          body: new URLSearchParams(payload),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    }

    function showDone(data, id, already) {
      const picked = dateSel.selectedOptions[0];
      doneTitle.textContent = already ? '이미 접수된 예약이에요' : '예약 요청이 접수됐어요';
      doneDesc.textContent = already
        ? `방금 같은 내용으로 보내 주신 예약이 있어요. 접수번호 ${id} · 내용을 바꾸시려면 전화로 알려 주세요.`
        : `접수번호 ${id}`;
      summary.replaceChildren();
      [['날짜', picked ? picked.text.replace(/ · .*$/, '') : data.date], ['시간', data.time], ['인원', `${data.people}명`]]
        .forEach(([k, v]) => {
          const dt = document.createElement('dt');
          const dd = document.createElement('dd');
          dt.textContent = k;
          dd.textContent = v;
          summary.append(dt, dd);
        });
      form.hidden = true;
      done.hidden = false;
      focusAndReveal(doneTitle);
    }

    // --- 제출 ---
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (sending) return; // 연타 방지
      showAlert(null);
      clearErrors();

      const data = collect();
      const errors = validate(data);
      Object.keys(errors).forEach((f) => setError(f, errors[f]));
      const firstBad = Object.keys(MESSAGES).find((f) => errors[f]);
      if (firstBad) {
        focusAndReveal(form.elements.namedItem(firstBad));
        return;
      }

      const dupKey = [digitsOf(data.phone), data.date, data.time].join('|');
      const last = readLast();
      if (last && last.key === dupKey && Date.now() - last.at < DUP_WINDOW_MS) {
        showDone(data, last.id, true);
        return;
      }
      if (!RESERVATION.endpoint) return showFailure('notReady');
      if (navigator.onLine === false) return showFailure('offline');

      setSending(true);
      try {
        const result = await send({
          name: data.name,
          phone: data.phone,
          date: data.date,
          time: data.time,
          people: data.people,
          request: data.request,
          consent: 'yes',
          website: form.elements.namedItem('website').value,
          elapsed: String(Date.now() - pageOpenedAt),
        });
        if (result && (result.ok || result.code === 'duplicate') && result.id) {
          saveLast(dupKey, result.id);
          showDone(data, result.id, !result.ok);
        } else if (result && result.code === 'invalid' && MESSAGES[result.field]) {
          // 화면 검사는 통과했는데 서버가 거절 (예: 그 사이 시간이 지남)
          refreshChoices();
          const gone = { date: MESSAGES.dateGone, time: MESSAGES.timeGone }[result.field];
          setError(result.field, gone || MESSAGES[result.field]);
          focusAndReveal(form.elements.namedItem(result.field));
        } else {
          showFailure('failed');
        }
      } catch (err) {
        showFailure(navigator.onLine === false ? 'offline' : 'failed');
      } finally {
        setSending(false);
      }
    });

    root.querySelector('[data-reserve-again]').addEventListener('click', () => {
      form.reset();
      clearErrors();
      showAlert(null);
      refreshChoices();
      countEl.textContent = '0 / 200자';
      done.hidden = true;
      form.hidden = false;
      focusAndReveal(form.elements.namedItem('name'));
    });

    root.hidden = false; // JavaScript가 켜져 있을 때만 폼을 보여 줘요
  }
})();
