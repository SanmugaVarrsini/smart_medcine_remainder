'use strict';

/* =========================================================
   MedMinder - medicine reminders and emergency help
   All data is saved in this browser (localStorage).
   ========================================================= */

/* ---------- storage ---------- */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('medminder.' + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('medminder.' + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  }
};

let meds     = store.get('meds', []);
let contacts = store.get('contacts', []);
let log      = store.get('log', {});
let profile  = Object.assign(
  { name: '', blood: '', allergies: '', conditions: '', emergency: '112', snooze: 5 },
  store.get('profile', {})
);

/* ---------- helpers ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmt12 = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
const cleanPhone = p => p.replace(/[^\d+]/g, '');
// WhatsApp needs the country code. A plain 10 digit number is treated as Indian (+91). Change if needed.
const waNumber = p => { const d = p.replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };

/* ---------- today's doses ---------- */
const GRACE_MINUTES = 60; // after this many minutes an untaken dose is shown as missed

function dosesForToday() {
  const now = new Date();
  const key = dayKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const list = [];
  meds.forEach(med => med.times.forEach(time => {
    const k = `${key}|${med.id}|${time}`;
    let status;
    if (log[k] === 'taken') status = 'taken';
    else {
      const diff = nowMin - toMin(time);
      status = diff < 0 ? 'upcoming' : diff <= GRACE_MINUTES ? 'due' : 'missed';
    }
    list.push({ k, med, time, status });
  }));
  return list.sort((a, b) => toMin(a.time) - toMin(b.time));
}

function setTaken(k, taken) {
  if (taken) log[k] = 'taken'; else delete log[k];
  store.set('log', log);
  renderToday();
}

/* ---------- header ---------- */
function renderHeader() {
  const n = new Date();
  const h = n.getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('#greeting').textContent = profile.name ? `${part}, ${profile.name.split(' ')[0]}` : part;
  $('#today-date').textContent = n.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

/* ---------- Today tab ---------- */
function renderToday() {
  renderHeader();
  const doses = dosesForToday();
  const total = doses.length;
  const taken = doses.filter(d => d.status === 'taken').length;
  const next = doses.find(d => d.status === 'due') || doses.find(d => d.status === 'upcoming');

  // hero
  const R = 54, C = 2 * Math.PI * R;
  const offset = total ? C * (1 - taken / total) : C;
  const ring = `
    <div class="ring" role="img" aria-label="${taken} of ${total} doses taken today">
      <svg viewBox="0 0 140 140">
        <circle cx="70" cy="70" r="${R}" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="14"/>
        <circle cx="70" cy="70" r="${R}" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"
                stroke-dasharray="${C}" stroke-dashoffset="${offset}"/>
      </svg>
      <div class="ring-center"><strong>${taken} of ${total}</strong><span>taken</span></div>
    </div>`;

  let text;
  if (!total) {
    text = `<div><p class="hero-label">No medicines yet</p>
            <p class="hero-name" style="margin-top:6px">Add your first medicine to start reminders.</p>
            <button class="btn" type="button" data-goto="medicines">Add medicine</button></div>`;
  } else if (next) {
    const isDue = next.status === 'due';
    text = `<div><p class="hero-label">${isDue ? 'Take now' : 'Next medicine'}</p>
            <p class="hero-time">${fmt12(next.time)}</p>
            <p class="hero-name">${esc(next.med.name)} ${esc(next.med.dose)}</p>
            <p class="hero-note">${esc(next.med.food)}</p>
            ${isDue ? `<button class="btn" type="button" data-take="${esc(next.k)}">I took it</button>` : ''}</div>`;
  } else {
    const missed = doses.filter(d => d.status === 'missed').length;
    text = `<div><p class="hero-time" style="font-size:2.2rem">${missed ? 'Day finished' : 'All done'}</p>
            <p class="hero-name">${missed ? `${missed} dose${missed > 1 ? 's' : ''} missed today` : 'You took every dose today.'}</p></div>`;
  }
  $('#hero').innerHTML = text + ring;

  // timeline
  const labels = { taken: 'Taken', due: 'Take now', upcoming: 'Later', missed: 'Missed' };
  $('#timeline').innerHTML = total ? doses.map(d => `
    <li class="dose ${d.status}" style="--c:${esc(d.med.color)}">
      <span class="dose-time">${fmt12(d.time)}</span>
      <div class="dose-body">
        <strong>${esc(d.med.name)}</strong>
        <span>${esc([d.med.dose, d.med.food].filter(Boolean).join(', '))}</span>
      </div>
      <span class="badge">${labels[d.status]}</span>
      <div class="dose-actions">
        ${d.status === 'taken'
          ? `<button class="btn plain small" type="button" data-undo="${esc(d.k)}">Undo</button>`
          : `<button class="btn ${d.status === 'upcoming' ? 'ghost' : 'primary'} small" type="button" data-take="${esc(d.k)}">Mark as taken</button>`}
      </div>
    </li>`).join('')
    : `<li class="card empty-card"><p class="empty">Your doses for today will appear here.</p></li>`;

  renderWeek();
}

function renderWeek() {
  const perDay = meds.reduce((n, m) => n + m.times.length, 0);
  if (!perDay) {
    $('#week').innerHTML = '<p class="empty">Your 7 day history will appear once you add medicines.</p>';
    return;
  }
  let html = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    let taken = 0;
    meds.forEach(m => m.times.forEach(t => { if (log[`${key}|${m.id}|${t}`] === 'taken') taken++; }));
    const pct = Math.round((taken / perDay) * 100);
    const cls = pct < 50 ? 'low' : pct < 100 ? 'mid' : '';
    html += `<div class="bar ${cls}">
      <div class="bar-track"><div class="bar-fill" style="height:${pct}%"></div></div>
      <span class="bar-pct">${pct}%</span>
      <span class="bar-day">${i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short' })}</span>
    </div>`;
  }
  $('#week').innerHTML = html;
}

/* ---------- Medicines tab ---------- */
function renderMeds() {
  if (!meds.length) {
    $('#med-list').innerHTML = `
      <div class="card empty-card">
        <p class="empty">You have not added any medicines.</p>
        <button class="btn primary" type="button" id="empty-add-med">Add your first medicine</button>
        <button class="btn ghost" type="button" id="load-sample">Load sample data</button>
      </div>`;
    return;
  }
  $('#med-list').innerHTML = meds.map(m => `
    <article class="card med-card" style="--c:${esc(m.color)}">
      <div class="card-top">
        <div>
          <p class="card-title">${esc(m.name)}</p>
          <p class="hint">${esc([m.dose, m.food].filter(Boolean).join(', '))}</p>
        </div>
      </div>
      <ul class="chips">${m.times.map(t => `<li style="padding-right:14px">${fmt12(t)}</li>`).join('')}</ul>
      ${m.notes ? `<p style="margin-top:10px">${esc(m.notes)}</p>` : ''}
      <div class="card-actions">
        <button class="btn ghost small" type="button" data-edit-med="${esc(m.id)}">Edit</button>
        <button class="btn plain small" type="button" data-del-med="${esc(m.id)}">Delete</button>
      </div>
    </article>`).join('');
}

let editingMedId = null;
let formTimes = [];

function renderTimeChips() {
  $('#time-chips').innerHTML = formTimes.length
    ? formTimes.map((t, i) => `<li>${fmt12(t)}<button type="button" data-rm-time="${i}" aria-label="Remove ${fmt12(t)}">×</button></li>`).join('')
    : '<li class="hint">No times added yet</li>';
}

function openMedForm(id) {
  editingMedId = id || null;
  const med = meds.find(m => m.id === id);
  $('#med-title').textContent = med ? 'Edit medicine' : 'Add medicine';
  $('#m-name').value  = med ? med.name : '';
  $('#m-dose').value  = med ? med.dose : '';
  $('#m-food').value  = med ? med.food : 'After food';
  $('#m-notes').value = med ? med.notes : '';
  $('#m-time').value  = '08:00';
  const color = med ? med.color : '#0B6E6E';
  $$('input[name="color"]').forEach(r => { r.checked = r.value === color; });
  formTimes = med ? [...med.times] : [];
  $('#med-error').hidden = true;
  renderTimeChips();
  $('#med-dialog').showModal();
}

/* ---------- Contacts tab ---------- */
function renderContacts() {
  if (!contacts.length) {
    $('#contact-list').innerHTML = `
      <div class="card empty-card">
        <p class="empty">Add your doctor and close relatives so help is one tap away.</p>
        <button class="btn primary" type="button" id="empty-add-contact">Add your first contact</button>
      </div>`;
    return;
  }
  $('#contact-list').innerHTML = contacts.map(c => `
    <article class="card">
      <div class="card-top">
        <div>
          <p class="card-title">${esc(c.name)}</p>
          ${c.note ? `<p class="hint">${esc(c.note)}</p>` : ''}
        </div>
        <span class="role ${c.role === 'Doctor' ? 'doctor' : c.role === 'Family' ? 'family' : ''}">${esc(c.role)}</span>
      </div>
      <p class="phone">${esc(c.phone)}</p>
      <div class="card-actions">
        <a class="btn primary small" href="tel:${esc(cleanPhone(c.phone))}">Call</a>
        <a class="btn ghost small" href="https://wa.me/${esc(waNumber(c.phone))}" target="_blank" rel="noopener">WhatsApp</a>
        <button class="btn plain small" type="button" data-edit-contact="${esc(c.id)}">Edit</button>
        <button class="btn plain small" type="button" data-del-contact="${esc(c.id)}">Delete</button>
      </div>
    </article>`).join('');
}

let editingContactId = null;

function openContactForm(id) {
  editingContactId = id || null;
  const c = contacts.find(x => x.id === id);
  $('#contact-title').textContent = c ? 'Edit contact' : 'Add contact';
  $('#c-name').value  = c ? c.name : '';
  $('#c-role').value  = c ? c.role : 'Doctor';
  $('#c-phone').value = c ? c.phone : '';
  $('#c-note').value  = c ? c.note : '';
  $('#contact-error').hidden = true;
  $('#contact-dialog').showModal();
}

/* ---------- My info tab ---------- */
function fillProfileForm() {
  $('#p-name').value      = profile.name;
  $('#p-blood').value     = profile.blood;
  $('#p-allergies').value = profile.allergies;
  $('#p-conditions').value = profile.conditions;
  $('#p-emergency').value = profile.emergency;
  $('#p-snooze').value    = String(profile.snooze);
}

/* =========================================================
   Alarm
   ========================================================= */
let audioCtx = null;
let soundTimer = null;
const ringing = new Set();   // dose keys that are ringing right now
const fired = new Set();     // dose keys that already rang in this session
const snoozedUntil = {};     // dose key -> timestamp

function enableAlarms() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
    beep();
  } catch { /* audio not supported */ }
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch { /* notifications not supported */ }
  $('#enable-alarms').hidden = true;
}

function beep() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.4);
}

function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch { /* speech not supported */ }
}

function alarmSentence() {
  const names = [...ringing].map(k => findDose(k)).filter(Boolean).map(d => `${d.med.name} ${d.med.dose}`);
  return `Time to take your medicine. ${names.join(', ')}.`;
}

function startSound() {
  stopSound();
  let count = 0;
  const cycle = () => {
    beep();
    setTimeout(beep, 400);
    if (count % 3 === 0) speak(alarmSentence());
    count++;
  };
  cycle();
  soundTimer = setInterval(cycle, 6000);
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
}

function stopSound() {
  clearInterval(soundTimer);
  soundTimer = null;
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
}

function findDose(k) { return dosesForToday().find(d => d.k === k); }

function renderAlarm() {
  const doses = [...ringing].map(findDose).filter(Boolean);
  if (!doses.length) { closeAlarm(); return; }
  $('#alarm-list').innerHTML = doses.map(d => `
    <li style="--c:${esc(d.med.color)}">
      <p class="name">${esc(d.med.name)}</p>
      <p>${esc([d.med.dose, d.med.food].filter(Boolean).join(', '))} at ${fmt12(d.time)}</p>
      ${d.med.notes ? `<p class="hint">${esc(d.med.notes)}</p>` : ''}
      <button class="btn primary" type="button" data-alarm-take="${esc(d.k)}">I took it</button>
    </li>`).join('');
}

function showAlarm() {
  renderAlarm();
  const dlg = $('#alarm-dialog');
  if (!dlg.open && ringing.size) {
    dlg.showModal();
    startSound();
    notify('Time for your medicine', alarmSentence());
  }
}

function closeAlarm() {
  const dlg = $('#alarm-dialog');
  if (dlg.open) dlg.close();
  stopSound();
}

function snoozeAll() {
  const until = Date.now() + Number(profile.snooze || 5) * 60000;
  ringing.forEach(k => { snoozedUntil[k] = until; });
  ringing.clear();
  closeAlarm();
}

function checkAlarms() {
  const now = Date.now();
  let added = false;
  dosesForToday().forEach(d => {
    if (d.status !== 'due' || ringing.has(d.k)) return;
    if (!fired.has(d.k)) {
      fired.add(d.k); ringing.add(d.k); added = true;
    } else if (snoozedUntil[d.k] && now >= snoozedUntil[d.k]) {
      delete snoozedUntil[d.k]; ringing.add(d.k); added = true;
    }
  });
  if (added) showAlarm();
}

/* =========================================================
   Emergency help
   ========================================================= */
function sosMessage(coords) {
  let msg = `EMERGENCY! ${profile.name || 'An elderly person'} needs help immediately.`;
  if (coords) msg += ` Location: https://maps.google.com/?q=${coords.latitude},${coords.longitude}`;
  if (profile.blood) msg += ` Blood group: ${profile.blood}.`;
  if (profile.allergies) msg += ` Allergies: ${profile.allergies}.`;
  return msg;
}

function renderSOS(state) {
  // state: null = finding location, false = not available, object = coordinates
  $('#sos-status').textContent =
    state === null ? 'Finding your location so it can be sent with the message...'
    : state === false ? 'Location is not available. Messages will be sent without it.'
    : 'Your location is ready and will be added to the messages.';

  const msg = encodeURIComponent(sosMessage(state || null));
  const number = esc(cleanPhone(profile.emergency || '112'));
  const people = contacts.map(c => `
    <div class="sos-person">
      <strong>${esc(c.name)}</strong> <span class="hint">${esc(c.role)}</span>
      <div class="row">
        <a class="btn primary small" href="tel:${esc(cleanPhone(c.phone))}">Call</a>
        <a class="btn ghost small" href="sms:${esc(cleanPhone(c.phone))}?body=${msg}">Text</a>
        <a class="btn ghost small" href="https://wa.me/${esc(waNumber(c.phone))}?text=${msg}" target="_blank" rel="noopener">WhatsApp</a>
      </div>
    </div>`).join('');

  $('#sos-actions').innerHTML =
    `<a class="btn danger sos-call" href="tel:${number}">Call ${esc(profile.emergency || '112')}</a>` +
    (people || '<p class="hint">Add contacts in the Contacts tab to send them an alert from here.</p>');

  const rows = [
    ['Name', profile.name], ['Blood group', profile.blood],
    ['Allergies', profile.allergies], ['Conditions', profile.conditions]
  ].filter(r => r[1]);
  const current = dosesForToday();
  const medList = [...new Set(meds.map(m => `${m.name} ${m.dose}`.trim()))].join(', ');
  if (medList) rows.push(['Medicines', medList]);
  $('#sos-info').innerHTML = rows.length
    ? `<h3>Medical information</h3><dl>${rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>`
    : '<p class="hint">Fill in the My info tab to show medical details here.</p>';
  void current;
}

function openSOS() {
  renderSOS(null);
  $('#sos-dialog').showModal();
  if (!navigator.geolocation) { renderSOS(false); return; }
  navigator.geolocation.getCurrentPosition(
    pos => renderSOS(pos.coords),
    () => renderSOS(false),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

/* =========================================================
   Events
   ========================================================= */
function showTab(name) {
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('.panel').forEach(p => { p.hidden = p.id !== 'tab-' + name; });
  window.scrollTo({ top: 0 });
}

$$('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$$('[data-close]').forEach(b => b.addEventListener('click', () => $('#' + b.dataset.close).close()));

// Today tab buttons
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.take)  setTaken(t.dataset.take, true);
  if (t.dataset.undo)  setTaken(t.dataset.undo, false);
  if (t.dataset.goto)  { showTab(t.dataset.goto); openMedForm(); }
  if (t.dataset.alarmTake) {
    setTaken(t.dataset.alarmTake, true);
    ringing.delete(t.dataset.alarmTake);
    renderAlarm();
  }
});

// Medicines
$('#add-med').addEventListener('click', () => openMedForm());
$('#med-list').addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.id === 'empty-add-med') openMedForm();
  if (t.id === 'load-sample') loadSample();
  if (t.dataset.editMed) openMedForm(t.dataset.editMed);
  if (t.dataset.delMed) {
    const med = meds.find(m => m.id === t.dataset.delMed);
    if (med && confirm(`Delete ${med.name}?`)) {
      meds = meds.filter(m => m.id !== med.id);
      store.set('meds', meds);
      renderMeds(); renderToday();
    }
  }
});

$('#add-time').addEventListener('click', () => {
  const v = $('#m-time').value;
  if (!v || formTimes.includes(v)) return;
  formTimes.push(v);
  formTimes.sort((a, b) => toMin(a) - toMin(b));
  renderTimeChips();
});
$('#time-chips').addEventListener('click', e => {
  const t = e.target.closest('[data-rm-time]');
  if (!t) return;
  formTimes.splice(Number(t.dataset.rmTime), 1);
  renderTimeChips();
});

$('#med-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#m-name').value.trim();
  const err = $('#med-error');
  if (!name) { err.textContent = 'Please type the medicine name.'; err.hidden = false; return; }
  // include the time still sitting in the time box if the person forgot to press "Add time"
  if (!formTimes.length && $('#m-time').value) formTimes.push($('#m-time').value);
  if (!formTimes.length) { err.textContent = 'Please add at least one time.'; err.hidden = false; return; }
  const data = {
    id: editingMedId || newId(),
    name,
    dose: $('#m-dose').value.trim(),
    food: $('#m-food').value,
    notes: $('#m-notes').value.trim(),
    color: ($('input[name="color"]:checked') || {}).value || '#0B6E6E',
    times: [...formTimes].sort((a, b) => toMin(a) - toMin(b))
  };
  const i = meds.findIndex(m => m.id === data.id);
  if (i >= 0) meds[i] = data; else meds.push(data);
  store.set('meds', meds);
  $('#med-dialog').close();
  renderMeds(); renderToday();
});

// Contacts
$('#add-contact').addEventListener('click', () => openContactForm());
$('#contact-list').addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.id === 'empty-add-contact') openContactForm();
  if (t.dataset.editContact) openContactForm(t.dataset.editContact);
  if (t.dataset.delContact) {
    const c = contacts.find(x => x.id === t.dataset.delContact);
    if (c && confirm(`Delete ${c.name}?`)) {
      contacts = contacts.filter(x => x.id !== c.id);
      store.set('contacts', contacts);
      renderContacts();
    }
  }
});

$('#contact-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#c-name').value.trim();
  const phone = $('#c-phone').value.trim();
  const err = $('#contact-error');
  if (!name) { err.textContent = 'Please type a name.'; err.hidden = false; return; }
  if (cleanPhone(phone).replace('+', '').length < 3) { err.textContent = 'Please type a valid phone number.'; err.hidden = false; return; }
  const data = { id: editingContactId || newId(), name, phone, role: $('#c-role').value, note: $('#c-note').value.trim() };
  const i = contacts.findIndex(c => c.id === data.id);
  if (i >= 0) contacts[i] = data; else contacts.push(data);
  store.set('contacts', contacts);
  $('#contact-dialog').close();
  renderContacts();
});

// My info
$('#profile-form').addEventListener('submit', e => {
  e.preventDefault();
  profile = {
    name: $('#p-name').value.trim(),
    blood: $('#p-blood').value,
    allergies: $('#p-allergies').value.trim(),
    conditions: $('#p-conditions').value.trim(),
    emergency: $('#p-emergency').value.trim() || '112',
    snooze: Number($('#p-snooze').value)
  };
  store.set('profile', profile);
  renderHeader();
  const saved = $('#profile-saved');
  saved.hidden = false;
  setTimeout(() => { saved.hidden = true; }, 2500);
});

// Alarm
$('#enable-alarms').addEventListener('click', enableAlarms);
$('#test-alarm').addEventListener('click', () => {
  enableAlarms();
  beep(); setTimeout(beep, 400);
  speak('This is a test. Time to take your medicine.');
});
$('#snooze').addEventListener('click', snoozeAll);
$('#alarm-dialog').addEventListener('close', () => {
  stopSound();
  if (ringing.size) snoozeAll();   // closed with Escape: treat as snooze
});

// Emergency
$('#sos').addEventListener('click', openSOS);

/* ---------- sample data ---------- */
function loadSample() {
  meds = [
    { id: newId(), name: 'Metformin', dose: '500 mg', food: 'After food', notes: 'White round tablet', color: '#0B6E6E', times: ['08:00', '20:00'] },
    { id: newId(), name: 'Amlodipine', dose: '5 mg', food: 'Any time', notes: 'For blood pressure', color: '#3E5BC9', times: ['09:00'] },
    { id: newId(), name: 'Vitamin D3', dose: '1 capsule', food: 'With food', notes: '', color: '#B4531B', times: ['13:00'] }
  ];
  contacts = [
    { id: newId(), name: 'Dr. Sharma', role: 'Doctor', phone: '+91 98765 43210', note: 'Family physician' },
    { id: newId(), name: 'Rahul', role: 'Family', phone: '+91 91234 56789', note: 'Son' }
  ];
  store.set('meds', meds);
  store.set('contacts', contacts);
  renderAll();
}

/* ---------- start ---------- */
function renderAll() {
  renderToday();
  renderMeds();
  renderContacts();
}

let lastMinute = -1;
function tick() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (now.getMinutes() !== lastMinute) {
    lastMinute = now.getMinutes();
    renderToday();
  }
  checkAlarms();
}

fillProfileForm();
renderAll();
$('#enable-alarms').hidden = false;   // browsers need one tap before they allow sound
tick();
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });


/* =========================================================
   Installable app, notifications and calendar alarms
   ========================================================= */

// Service worker: offline support and notifications that work on phones.
let swRegistration = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => { swRegistration = reg; })
      .catch(() => { /* works fine without it, just no offline mode */ });
  });
}

function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const options = { body, tag: 'medminder', renotify: true, requireInteraction: true, vibrate: [300, 150, 300] };
    if (swRegistration) swRegistration.showNotification(title, options);
    else new Notification(title, options);
  } catch { /* notifications not available */ }
}

// Install button
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  $('#install-app').hidden = false;
});
$('#install-app').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#install-app').hidden = true;
});
window.addEventListener('appinstalled', () => {
  $('#install-hint').textContent = 'MedMinder is installed on this phone.';
  $('#install-app').hidden = true;
});
if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
  $('#install-hint').textContent = 'MedMinder is installed on this phone.';
} else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
  $('#install-hint').textContent = 'On iPhone: tap the Share button in Safari, then choose Add to Home Screen.';
}

// Calendar file (.ics): the phone's calendar rings daily even when the app is closed.
function icsText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsFold(line) {
  const out = [];
  while (line.length > 73) { out.push(line.slice(0, 73)); line = ' ' + line.slice(73); }
  out.push(line);
  return out.join('\r\n');
}
function icsStamp(date, time) {
  const [h, m] = time.split(':');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(h)}${pad(m)}00`;
}

function exportCalendar() {
  if (!meds.length) { alert('Add a medicine first, then download the alarms.'); return; }
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MedMinder//Medicine reminders//EN', 'CALSCALE:GREGORIAN'];

  meds.forEach(m => m.times.forEach(t => {
    const endMin = toMin(t) + 10;
    const end = `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${m.id}-${t.replace(':', '')}@medminder`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(now, t)}`,
      `DTEND:${icsStamp(now, end)}`,
      'RRULE:FREQ=DAILY',
      `SUMMARY:${icsText('Take ' + m.name + (m.dose ? ' ' + m.dose : ''))}`,
      `DESCRIPTION:${icsText([m.food, m.notes].filter(Boolean).join('. '))}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText('Time to take ' + m.name)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT'
    );
  }));
  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.map(icsFold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'medminder-alarms.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$('#export-ics').addEventListener('click', exportCalendar);
