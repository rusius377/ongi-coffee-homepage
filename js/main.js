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

   ✏️ 영업시간이 바뀌면 바로 아래 OPENING_HOURS 만 고치면 돼요.
      (index.html 의 영업시간 표도 함께 고쳐 주세요)
   ============================================================= */

const OPENING_HOURS = {
  open: '10:00',     // 여는 시간 (24시간 형식)
  close: '21:00',    // 닫는 시간
  closedDays: [1],   // 쉬는 요일: 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토  (예: 월·화 휴무면 [1, 2])
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

  function getSeoulNow() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    const dayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')];
    return { day: dayIndex, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
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
})();
