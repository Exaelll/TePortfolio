(() => {
  const folders = [...document.querySelectorAll('.folder')];
  const tabs    = [...document.querySelectorAll('.folder-tab')];
  const stack   = document.querySelector('.folder-stack');
  const nav     = document.querySelector('.drawer nav');
  const experience = document.getElementById('experience');
  const projectContainer = document.querySelector('.project-container');
  const projectCount = document.getElementById('project-count');
  const contactForm = document.getElementById('contact-form');
  if (!folders.length || !stack || !nav) return;
  const folderIndex = new Map(folders.map((folder, index) => [folder, index]));

  /* ---------- Configuration ---------- */
  const DURATION = 420;                          // ms
  const EASING   = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const PITCH    = -68;                          // deg, fall forward toward the viewer
  const SCALE    = 0.98;                         // 1.00 -> 0.98

  /* Scroll-to-advance: must rest at the edge, then keep scrolling */
  const EDGE_DWELL    = 400;                     // ms at the edge before advancing is allowed
  const OVERSCROLL_PX = 160;                     // extra wheel distance needed
  const TIMELINE_TARGET_POSITION = 0.3;          // keep selected entry above the history marker line

  const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const mobileQuery = matchMedia('(max-width: 900px)');

  let active  = null;
  let busy    = false;
  let pending = null;
  let pendingTimelineId = null;

  /* ---------- Folder and navigation helpers ---------- */
  const folderFor = (id) => {
    const el = id ? document.getElementById(id) : null;
    return el ? el.closest('.folder') : null;
  };

  const setActiveTab = (id) => {
    tabs.forEach((t) => {
      if (t.getAttribute('href') === '#' + id) t.setAttribute('aria-current', 'true');
      else t.removeAttribute('aria-current');
    });
  };

  const setHash = (id) => {
    if (location.hash !== '#' + id) history.pushState(null, '', '#' + id);
  };

  // Bring the tabs into view before a transition so the fold is visible
  const revealNav = () => {
    const top = nav.getBoundingClientRect().top;
    if (top < 0) window.scrollTo({ top: window.scrollY + top - 12, behavior: 'instant' });
  };

  const scrollToTimelineItem = (target) => {
    const targetTop = target.getBoundingClientRect().top;
    const targetPosition = window.innerHeight * TIMELINE_TARGET_POSITION;
    window.scrollTo({
      top: window.scrollY + targetTop - targetPosition,
      behavior: 'smooth'
    });
  };

  /* ---------- Folder animation ---------- */
  // Home pitches forward and down, shadow broadens, then it settles away
  const foldFrames = (H, S) => {
    const rad    = (PITCH * Math.PI) / 180;
    const N      = Math.max(1800, H * 3);                         // perspective distance
    const squash = Math.cos(rad) * N / (N - H * Math.sin(rad));   // folded height incl. perspective
    const shift  = Math.max(0, S - H * squash);                   // drop it to the bottom of the drawer
    return [
      {
        transform: `translateY(0) perspective(${N}px) rotateX(0deg) scale(1)`,
        boxShadow: '0 0 0 rgba(0,0,0,0)',
        opacity: 1,
        offset: 0
      },
      { opacity: 1, offset: 0.8 },
      {
        transform: `translateY(${shift}px) perspective(${N}px) rotateX(${PITCH}deg) scale(${SCALE})`,
        boxShadow: '0 30px 60px rgba(0,0,0,0.35)',
        opacity: 0,
        offset: 1
      }
    ];
  };

  // The folder underneath rises into the reading plane
  const settleFrames = [
    { transform: `scale(${SCALE})`, filter: 'brightness(0.88)' },
    { transform: 'scale(1)',        filter: 'brightness(1)' }
  ];

  /* ---------- Folder switching ---------- */
  function afterSwitch(to, hadFocus) {
    resetEdge();
    updateHistory();
    if (to.id === 'experience' && pendingTimelineId) {
      const timelineId = pendingTimelineId;
      pendingTimelineId = null;
      requestAnimationFrame(() => {
        const timelineTarget = document.getElementById(timelineId);
        if (timelineTarget) scrollToTimelineItem(timelineTarget);
      });
    }
    if (hadFocus) {                       // keep keyboard focus in the new folder
      to.tabIndex = -1;
      to.focus({ preventScroll: true });
    }
  }

  // Reduced motion: instant. Mobile: short opacity fade.
  function swap(from, to, fade) {
    const hadFocus = from.contains(document.activeElement);
    from.classList.remove('is-active');
    to.classList.add('is-active');
    active = to;
    if (fade) to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    afterSwitch(to, hadFocus);
  }

  // Desktop: the fold
  function fold(from, to) {
    busy = true;
    const hadFocus = from.contains(document.activeElement);
    const forward  = folderIndex.get(to) > folderIndex.get(from);

    from.classList.remove('is-active');
    from.classList.add('is-outgoing', forward ? 'is-front' : 'is-back');
    to.classList.add('is-incoming',   forward ? 'is-back'  : 'is-front');

    const S    = stack.offsetHeight;
    const H    = (forward ? from : to).offsetHeight;
    const opts = { duration: DURATION, easing: EASING, fill: 'both' };
    const rev  = { ...opts, direction: 'reverse' };

    // Forward:  current folds away, next settles up.
    // Backward: target unfolds back into view, current settles down.
    const anims = forward
      ? [from.animate(foldFrames(H, S), opts), to.animate(settleFrames, opts)]
      : [to.animate(foldFrames(H, S), rev),    from.animate(settleFrames, rev)];

    Promise.allSettled(anims.map((a) => a.finished)).then(() => {
      anims.forEach((a) => a.cancel());
      from.classList.remove('is-outgoing', 'is-front', 'is-back');
      to.classList.remove('is-incoming', 'is-front', 'is-back');
      to.classList.add('is-active');
      active = to;
      busy = false;
      afterSwitch(to, hadFocus);

      if (pending) {
        const p = pending;
        pending = null;
        goTo(p.id, p.push);
      }
    });
  }

  function goTo(id, push = true) {
    const to = folderFor(id);
    if (!to) return;
    if (busy) { pending = { id: to.id, push }; return; }
    if (push) setHash(to.id);
    if (to === active) return;

    revealNav();
    setActiveTab(to.id);

    if (reduceQuery.matches)      swap(active, to, false);
    else if (mobileQuery.matches) swap(active, to, true);
    else                          fold(active, to);
  }

  function goToTimelineItem(id) {
    const target = document.getElementById(id);
    if (!target || !experience) return;

    setHash(id);
    if (active === experience) {
      scrollToTimelineItem(target);
      return;
    }

    pendingTimelineId = id;
    goTo('experience', false);
  }

  /* ---------- Tab and in-page folder navigation ---------- */
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    if (a.closest('.history-index')) {
      e.preventDefault();
      goToTimelineItem(id);
      return;
    }
    const folder = folderFor(id);
    // Only folder links animate; links to items inside a folder scroll normally
    if (folder && folder.id === id) {
      e.preventDefault();
      goTo(id);
    }
  });

  /* ---------- Browser history and hash navigation ---------- */
  const fromHash = () => {
    const id = location.hash.slice(1);
    const f = folderFor(id) || (location.hash ? null : folders[0]);
    if (!f) return;
    if (f.id === 'experience' && id !== f.id) {
      if (active === f) {
        const timelineTarget = document.getElementById(id);
        if (timelineTarget) scrollToTimelineItem(timelineTarget);
        return;
      }
      pendingTimelineId = id;
      goTo(f.id, false);
      return;
    }
    goTo(f.id, false);
  };
  window.addEventListener('hashchange', fromHash);
  window.addEventListener('popstate', fromHash);

  /* ---------- Scroll-to-advance navigation ---------- */
  let edgeSince = performance.now();
  let edgeDirection = null;
  let overscroll = 0;
  let lastWheel = 0;

  function resetEdge() {
    edgeDirection = null;
    edgeSince = performance.now();
    overscroll = 0;
  }

  window.addEventListener('wheel', (e) => {
    if (busy || e.ctrlKey || reduceQuery.matches || mobileQuery.matches) return;

    const dir = e.deltaY > 0 ? 1 : -1;
    const bounds = active ? active.getBoundingClientRect() : null;
    const atTop = bounds ? bounds.top >= -2 : window.scrollY <= 0;
    const atBottom = bounds
      ? bounds.bottom <= window.innerHeight + 2
      : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    const atEdge = dir === 1 ? atBottom : atTop;
    if (!atEdge) {
      edgeDirection = null;
      overscroll = 0;
      return;
    }

    const now = performance.now();
    if (edgeDirection !== dir) {
      edgeDirection = dir;
      edgeSince = now;
      overscroll = 0;
      return;
    }
    if (now - edgeSince < EDGE_DWELL) return;           // let momentum scrolling settle first
    if (now - lastWheel > 300) overscroll = 0;          // treat a pause as a new gesture
    lastWheel = now;
    overscroll += Math.abs(e.deltaY);

    if (overscroll >= OVERSCROLL_PX) {
      overscroll = 0;
      const next = folders[folderIndex.get(active) + dir];
      if (next) goTo(next.id);
    }
  }, { passive: true });

  /* ---------- Experience timeline highlighting ---------- */
  const items = [...document.querySelectorAll('.timeline-item')];
  const indexLinks = new Map(
    items.map((it) => [it, document.querySelector(`.history-index a[href="#${it.id}"]`)])
  );
  let currentTimelineItem = null;

  function setCurrent(current) {
    if (current === currentTimelineItem) return;
    currentTimelineItem = current;
    items.forEach((it) => {
      const on = it === current;
      it.classList.toggle('is-current', on);
      const link = indexLinks.get(it);
      if (link) link.classList.toggle('is-current', on);
    });
  }

  function updateHistory() {
    if (!items.length) return;
    if (!experience || !(experience.classList.contains('is-active') || experience.classList.contains('is-incoming'))) return;
    const line = window.innerHeight * 0.4;
    let current = items[0];
    items.forEach((it) => {
      if (it.getBoundingClientRect().top <= line) current = it;
    });
    setCurrent(current);
  }
  /* ---------- Project count ---------- */
  function updateProjectCount() {
    if (!projectContainer || !projectCount) return;

    const count = projectContainer.querySelectorAll('.project-item').length;
    projectCount.textContent = `${String(count).padStart(2, '0')} PROJECTS`;
  }

  /* ---------- Contact form email ---------- */
  if (contactForm) {
    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!contactForm.reportValidity()) return;

      const formData = new FormData(contactForm);
      const name = String(formData.get('name') || '').trim();
      const email = String(formData.get('email') || '').trim();
      const message = String(formData.get('message') || '').trim();
      const subject = `Portfolio message from ${name}`;
      const body = `Name: ${name}\nEmail: ${email}\n\n${message}`;

      window.location.href = `mailto:yofiel1te@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }

  /* ---------- Shared scroll updates ---------- */
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { updateHistory(); ticking = false; });
  }, { passive: true });

  /* ---------- Project count updates ---------- */
  if (projectContainer) {
    new MutationObserver(updateProjectCount).observe(projectContainer, { childList: true });
  }

  /* ---------- Initial state ---------- */
  const hashId = location.hash.slice(1);
  const start  = folderFor(hashId) || folders[0];
  start.classList.add('is-active');
  active = start;
  setActiveTab(start.id);

  const inner = hashId && document.getElementById(hashId);
  if (inner && inner !== start) inner.scrollIntoView();

  updateHistory();
  updateProjectCount();
  resetEdge();
  document.documentElement.classList.add('js');
})();