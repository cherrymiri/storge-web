/** DOM text layer: title, story prompt switching, hint, sound controls, loader. */
export class Overlay {
  constructor({ audio }) {
    this.top = document.getElementById('hud-top');
    this.bottom = document.getElementById('hud-bottom');
    this.loader = document.getElementById('loader');
    this.prompts = [...document.querySelectorAll('[data-prompt]')];
    this.audio = audio;
    this.currentPrompt = 'intro';
    this.hint = document.getElementById('hint');
    this.ending = document.getElementById('ending');
    this.answerKo = this.ending.querySelector('.answer-ko');
    this.replayBtn = document.getElementById('replay');
    this.replayBtn.addEventListener('click', () => { this.replayCb?.(); });
    this.sound = document.getElementById('sound');
    // touch-first devices (phones, tablets) get the swipe hint; it also switches on first real input
    const coarse = window.matchMedia?.('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !window.matchMedia?.('(hover: hover)').matches);
    this.setHintMode(coarse ? 'touch' : 'wheel');
    // any real user gesture anywhere on the page unlocks audio
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click']) {
      window.addEventListener(ev, () => { if (this.started) audio.unlock(); }, { capture: true, passive: true });   // before "체험 시작" only the button turns sound on
    }
    // "체험 시작": the press itself turns the sound on (a real click / tap, as every browser requires);
    // only when the sound is really running does the work begin
    this.start = document.getElementById('start');
    this.startBtn = document.getElementById('start-btn');
    this.startNote = document.getElementById('start-note');
    this.started = false;
    this.startBtn.addEventListener('click', () => this.pressStart());

    const btn = document.getElementById('sound-toggle');
    const vol = document.getElementById('sound-volume');
    btn.addEventListener('click', () => {
      const m = !audio.muted;
      audio.unlock();
      audio.setMuted(m);
      btn.setAttribute('aria-pressed', String(m));
      btn.setAttribute('aria-label', m ? '소리 켜기' : '소리 끄기');
    });
    vol.addEventListener('input', () => {
      audio.unlock();
      audio.setVolume(parseFloat(vol.value));
      if (audio.muted && parseFloat(vol.value) > 0) btn.click();
    });
  }

  showPrompt(id) {
    this.prompts.forEach((el) => el.classList.toggle('is-visible', el.dataset.prompt === id));
    this.currentPrompt = id;
  }

  setHintMode(mode) {
    if (this.hintMode === mode) return;
    this.hintMode = mode;
    this.hint.dataset.mode = mode;
  }

  /** 05: the hint line says "태엽을 다시 감아보세요." (same icon as in 01) */
  setHintPhase(phase) { this.hint.dataset.phase = phase || ''; }
  showHint() { this.bottom.classList.remove('is-hidden', 'is-quiet'); }
  hintTop() { return this.bottom.querySelector('.hint').getBoundingClientRect().top; }

  showSoundTip() {}

  onStart(cb) { this.startCb = cb; }

  async pressStart() {
    if (this.started || this._starting) return;          // repeated presses do nothing extra
    this._starting = true;
    this.audio.unlock(true);                             // inside the click: allowed to start sound
    this.startBtn.disabled = true;
    const ok = await this.audio.whenRunning(2000);
    this._starting = false;
    this.startBtn.disabled = false;
    if (!ok) { this.startNote.hidden = false; this.startBtn.focus(); return; }   // stays: try again
    this.started = true;
    this.startNote.hidden = true;
    this.start.classList.add('is-gone');
    this.startBtn.tabIndex = -1;
    setTimeout(() => { this.start.hidden = true; }, 500);
    this.showPrompt('intro');
    this.bottom.classList.remove('is-hidden');
    this.startCb?.();
  }

  // ---- 06 ending ----
  onReplay(cb) { this.replayCb = cb; }

  /** largest Korean size (≤ the design size) whose two lines fit in w × h */
  answerFit(w, h) {
    const e = this.ending;
    e.style.removeProperty('--answer-size');
    const base = parseFloat(getComputedStyle(this.answerKo).fontSize);
    const bw = this.answerKo.scrollWidth, bh = e.offsetHeight;
    return Math.floor(Math.min(base, base * w / bw, base * h / bh));
  }

  /** size of the answer at the design size, on one line or wrapped after "그럼," */
  answerMetrics(wrapped = false) {
    const e = this.ending;
    e.style.removeProperty('--answer-size');
    e.classList.toggle('is-wrapped', wrapped);
    const base = parseFloat(getComputedStyle(this.answerKo.querySelector('.ans-l2')).fontSize);   // the main line sets the size
    const m = { base, wrapped, w: Math.max(this.answerKo.scrollWidth, e.querySelector('.answer-en').scrollWidth), h: e.offsetHeight };
    e.classList.toggle('is-wrapped', !!this.answerBox?.wrapped);
    return m;
  }

  /** centre the answer at (x, y) at a given Korean size (px) */
  setAnswer({ x, y, size, base, wrapped = false }) {
    const e = this.ending;
    e.style.left = `${x}px`; e.style.top = `${y}px`;
    e.classList.toggle('is-wrapped', wrapped);
    if (size < base) e.style.setProperty('--answer-size', `${size}px`); else e.style.removeProperty('--answer-size');
    this.answerBox = { x, y, size, wrapped };
  }

  /** the caption size (top prompt line) — the answer is always clearly larger */
  captionSize() { return parseFloat(getComputedStyle(this.prompts[0]).fontSize); }

  /** centre the answer at (x, y), shrinking the type only if it would not fit */
  placeAnswer({ x, y, maxWidth, maxHeight = 1e9 }) {
    const e = this.ending;
    e.style.left = `${x}px`; e.style.top = `${y}px`;
    const base = parseFloat(getComputedStyle(this.answerKo).fontSize);
    const size = this.answerFit(maxWidth, maxHeight);
    if (size < base) e.style.setProperty('--answer-size', `${Math.max(16, size)}px`);
    this.answerBox = { x, y, maxWidth, maxHeight };
  }

  showEnding(part) {
    if (part === 'ko') this.ending.classList.add('show-ko');
    if (part === 'en') this.ending.classList.add('show-en');
  }

  showReplay(on) {
    this.replayBtn.classList.toggle('is-visible', on);
    this.replayBtn.tabIndex = on ? 0 : -1;
  }

  endingState() {
    return { ko: this.ending.classList.contains('show-ko'), en: this.ending.classList.contains('show-en'), replay: this.replayBtn.classList.contains('is-visible') };
  }

  /** "다시 감기": the first screen again */
  reset() {
    this.ending.classList.add('instant'); this.replayBtn.classList.add('instant');
    this.ending.classList.remove('show-ko', 'show-en', 'is-wrapped');
    this.answerBox = null;
    this.showReplay(false);
    this.replayBtn.blur();
    requestAnimationFrame(() => requestAnimationFrame(() => { this.ending.classList.remove('instant'); this.replayBtn.classList.remove('instant'); }));
    this.showPrompt('intro');
    this.bottom.classList.remove('is-hidden', 'is-quiet');
    this.setHintPhase(null);
    this.showSoundTip(false);
  }

  quietHint(q = true) { this.bottom.classList.toggle('is-quiet', q); }
  /** after the break the winding hint no longer applies (kept in layout, just invisible) */
  hideHint() { this.bottom.classList.add('is-hidden'); }
  loaded() { this.loader.classList.add('is-done'); }

  /** pixel rect between title block and the score (or the hint) — the camera frames the 3D content inside it */
  safeRect(width, height, marginXFrac) {
    const topBox = this.top.getBoundingClientRect();
    const hint = this.bottom.querySelector('.hint').getBoundingClientRect();
    const gapTop = Math.max(14, height * 0.035), gapBottom = Math.max(12, height * 0.03);
    const mx = Math.max(16, width * marginXFrac);
    return {
      left: mx, right: width - mx,
      top: topBox.bottom + gapTop,
      bottom: Math.min(height, hint.top, this.scoreTop ?? Infinity) - gapBottom,
      width, height,
    };
  }
}
