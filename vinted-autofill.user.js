// ==UserScript==
// @name         AbzVault → Vinted autofill
// @namespace    abzvault
// @version      1.4
// @description  Vult een nieuwe Vinted-advertentie automatisch in met data uit AbzVault.
// @match        https://www.vinted.nl/items/new*
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const MARKER = '#abzvault=';

  function readPayload() {
    const hash = location.hash || '';
    if (!hash.startsWith(MARKER)) return null;
    try {
      return JSON.parse(decodeURIComponent(hash.slice(MARKER.length)));
    } catch (e) {
      console.error('AbzVault autofill: kon data niet lezen uit URL', e);
      return null;
    }
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function waitFor(selector, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('timeout: ' + selector)); }, timeout);
    });
  }

  function nativeValueSetter(el) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, 'value').set;
  }

  function setNativeValue(el, value) {
    const setter = nativeValueSetter(el);
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function typeChar(el, char) {
    const setter = nativeValueSetter(el);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    setter.call(el, el.value + char);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
  }

  async function typeInto(el, text) {
    el.focus();
    setNativeValue(el, '');
    for (const char of String(text)) {
      typeChar(el, char);
      await sleep(25);
    }
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Vinted's radio/checkbox rows are custom-styled: walk up from the native
  // <input> until we hit an ancestor that actually carries the row's visible text, then click that.
  function findOptionRow(input, minLen = 3) {
    let node = input;
    for (let i = 0; i < 6 && node; i++) {
      if (node.textContent && node.textContent.trim().length > minLen) return node;
      node = node.parentElement;
    }
    return null;
  }

  function findRadioRowByText(matchFn) {
    const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
    for (const radio of radios) {
      const row = findOptionRow(radio);
      if (row && matchFn(row.textContent.trim())) return row;
    }
    return null;
  }

  function findCheckboxRowExact(naam) {
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    for (const box of boxes) {
      const row = findOptionRow(box, 1);
      if (row && row.textContent.trim().toLowerCase() === naam.trim().toLowerCase()) return { row, box };
    }
    return null;
  }

  async function fillCategorie(zoekterm, padBevat) {
    if (!zoekterm) return false;
    const trigger = document.getElementById('category');
    if (!trigger) return false;
    trigger.click();
    const searchBox = await waitFor('#catalog-search-input', 3000).catch(() => null);
    if (!searchBox) return false;
    await typeInto(searchBox, zoekterm);
    await sleep(1000); // debounce + netwerk

    const row = findRadioRowByText(text =>
      text.startsWith(zoekterm) && (!padBevat || text.includes(padBevat))
    ) || findRadioRowByText(text => text.startsWith(zoekterm));

    if (row) { row.click(); return true; }
    return false;
  }

  async function fillStaat(staatTekst) {
    if (!staatTekst) return false;
    const trigger = document.getElementById('condition');
    if (!trigger) return false;
    trigger.click();
    await sleep(400);
    const row = findRadioRowByText(text => text.startsWith(staatTekst));
    if (row) { row.click(); return true; }
    return false;
  }

  async function fillMaterialen(lijst) {
    if (!lijst || !lijst.length) return 0;
    const trigger = document.getElementById('material');
    if (!trigger) return 0;
    trigger.click();
    await sleep(400);
    let count = 0;
    for (const naam of lijst) {
      const found = findCheckboxRowExact(naam);
      if (found) { found.row.click(); count++; await sleep(200); }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    return count;
  }

  async function fillUniseks(waarde) {
    if (!waarde) return false;
    const cb = document.getElementById('unisex');
    if (!cb) return false;
    if (!cb.checked) cb.click();
    return true;
  }

  async function fillKleuren(lijst) {
    if (!lijst || !lijst.length) return 0;
    const trigger = document.getElementById('color');
    if (!trigger) return 0;
    trigger.click();
    await sleep(400);
    let count = 0;
    for (const naam of lijst) {
      const el = Array.from(document.querySelectorAll('[role="checkbox"]'))
        .find(e => e.textContent.trim().toLowerCase() === naam.trim().toLowerCase());
      if (el) { el.click(); count++; await sleep(200); }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    return count;
  }

  async function fillVerzendformaat(naam) {
    if (!naam) return false;
    const row = findRadioRowByText(text => text.startsWith(naam));
    if (row) { row.click(); return true; }
    return false;
  }

  async function fillMaat(naam) {
    if (!naam) return false;
    const trigger = document.getElementById('size');
    if (!trigger) return false;
    trigger.click();
    await sleep(400);
    const el = Array.from(document.querySelectorAll('[role="checkbox"], [role="radio"]'))
      .find(e => e.textContent.trim().toLowerCase() === naam.trim().toLowerCase());
    if (!el) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return false; }
    el.click();
    await sleep(200);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    return true;
  }

  function showToast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.position = 'fixed';
    el.style.bottom = '20px';
    el.style.right = '20px';
    el.style.maxWidth = '320px';
    el.style.background = '#1a1a1a';
    el.style.color = '#f2ede4';
    el.style.padding = '12px 16px';
    el.style.borderRadius = '10px';
    el.style.zIndex = '999999';
    el.style.font = '14px/1.4 sans-serif';
    el.style.boxShadow = '0 6px 20px rgba(0,0,0,.35)';
    el.style.border = '1px solid #c9a24b';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  async function run() {
    const data = readPayload();
    if (!data) return;

    // Guard against the same script being installed/enabled more than once in
    // Tampermonkey: two simultaneous runs fight over the same fields (e.g. both
    // click the category trigger at once, closing what the other just opened).
    if (window.__abzvaultAutofillRunning) return;
    window.__abzvaultAutofillRunning = true;

    // Clear the hash immediately so a refresh doesn't re-trigger the fill.
    history.replaceState(null, '', location.pathname + location.search);

    try {
      const title = await waitFor('#title').catch(() => null);
      const description = await waitFor('#description').catch(() => null);
      const price = await waitFor('#price').catch(() => null);

      if (title && data.titel) setNativeValue(title, data.titel);
      if (description && data.beschrijving) setNativeValue(description, data.beschrijving);
      if (price && data.prijs != null) await typeInto(price, String(data.prijs).replace('.', ','));

      let categorieOk = false;
      let staatOk = false;
      let materiaalCount = 0;
      let kleurCount = 0;
      let verzendOk = false;
      let unisekOk = false;
      let maatOk = false;
      if (data.categorieZoekterm) {
        categorieOk = await fillCategorie(data.categorieZoekterm, data.categoriePad);
        if (categorieOk) {
          await sleep(500);
          if (data.uniseks) unisekOk = await fillUniseks(data.uniseks);
          if (data.staat) staatOk = await fillStaat(data.staat);
          if (data.maat) maatOk = await fillMaat(data.maat);
          await sleep(300);
          if (data.materialen && data.materialen.length) materiaalCount = await fillMaterialen(data.materialen);
          await sleep(300);
          if (data.kleuren && data.kleuren.length) kleurCount = await fillKleuren(data.kleuren);
        }
      }
      if (data.verzendformaat) verzendOk = await fillVerzendformaat(data.verzendformaat);

      const gedaan = ['titel', 'beschrijving', 'prijs'];
      if (categorieOk) gedaan.push('categorie');
      if (unisekOk) gedaan.push('uniseks');
      if (staatOk) gedaan.push('staat');
      if (maatOk) gedaan.push('maat');
      if (materiaalCount) gedaan.push('materiaal');
      if (kleurCount) gedaan.push('kleur');
      if (verzendOk) gedaan.push('verzendformaat');
      const missend = [];
      if (data.categorieZoekterm && !categorieOk) missend.push('categorie');
      if (data.staat && categorieOk && !staatOk) missend.push('staat');
      if (data.maat && categorieOk && !maatOk) missend.push('maat');
      if (data.materialen && data.materialen.length && materiaalCount < data.materialen.length) missend.push('materiaal');
      if (data.kleuren && data.kleuren.length && kleurCount < data.kleuren.length) missend.push('kleur');
      if (data.verzendformaat && !verzendOk) missend.push('verzendformaat');

      let msg = 'AbzVault: ' + gedaan.join(', ') + ' ingevuld. Nu nog foto\'s toevoegen';
      if (missend.length) msg += ' — en handmatig: ' + missend.join(', ');
      msg += '.';
      showToast(msg);
    } catch (err) {
      console.error('AbzVault autofill fout:', err);
      showToast('AbzVault: er ging iets mis (' + err.message + '). Rest handmatig invullen.');
    }
  }

  run();
})();
