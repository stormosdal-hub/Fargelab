/*
 * faner.js – fanene øverst på siden (Fargelab og Python)
 *
 * Hver fane er en knapp med role="tab" som viser panelet i aria-controls.
 * Piltastene flytter mellom fanene. Fanen står i adressen (#python), så den
 * er valgt igjen hvis du laster siden på nytt.
 *
 * Når du bytter fane, sendes hendelsen 'fane' på document med
 * detail = { id: 'fargelab' | 'python' }.
 */
(function () {
  'use strict';

  const tabs = Array.from(document.querySelectorAll('[role="tab"][data-fane]'));
  if (!tabs.length) return;

  function select(tab, { focus = false, updateUrl = true } = {}) {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    const id = tab.dataset.fane;
    if (updateUrl) {
      const hash = id === tabs[0].dataset.fane ? '' : '#' + id;
      try { history.replaceState(null, '', location.pathname + location.search + hash); } catch (_) { /* file:// i noen nettlesere */ }
    }
    document.dispatchEvent(new CustomEvent('fane', { detail: { id } }));
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', e => {
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (j === undefined) return;
      e.preventDefault();
      select(tabs[(j + tabs.length) % tabs.length], { focus: true });
    });
  });

  // Fanen i adressen (#python) velges ved oppstart, og når adressen endres
  // uten at siden lastes på nytt (for eksempel med tilbake-knappen)
  function fromHash() {
    const tab = tabs.find(t => '#' + t.dataset.fane === location.hash) || (location.hash ? null : tabs[0]);
    if (tab && tab.getAttribute('aria-selected') !== 'true') select(tab, { updateUrl: false });
  }
  fromHash();
  window.addEventListener('hashchange', fromHash);
})();
