// ============ NOTIFICATIONS ============
// Push notifications when the OTHER person adds something new. Nothing fires for
// your own entries, and edits never notify — only genuinely new records.
//
// How the pieces fit:
//   - This file gets a device token from Firebase Cloud Messaging and saves it to
//     the NotifyDevices tab, together with this person's per-module preferences.
//   - Apps Script sends to the other person's devices whenever a new row lands
//     (see notifyNewRecords_ in google-apps-script-full.gs).
//   - sw.js receives the push and draws the notification. It deliberately does NOT
//     import the Firebase SDK: messages are sent data-only, so the service worker
//     handles a plain Web Push event, which is far less machinery in the background.
//
// Everything here is best-effort. A browser that can't do push, a declined
// permission prompt, or an iPhone running the app in Safari rather than from the
// home screen all end up in a clearly-explained state rather than an error.

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAYBecrP5oGaqnax4AKDg1YBY8Xk6nqSr4',
  authDomain: 'homebase-cd3cb.firebaseapp.com',
  projectId: 'homebase-cd3cb',
  storageBucket: 'homebase-cd3cb.firebasestorage.app',
  messagingSenderId: '182694302399',
  appId: '1:182694302399:web:f56b2f28caccf300572c0a'
};

// The public half of the Web Push key pair. Public by design — it ships inside the
// app's JavaScript, exactly like the config above. The private half lives only in
// the Apps Script property, never here.
const FIREBASE_VAPID_KEY = 'BOCIeK2ENLmhtRSshd9LIoXMP90xlztiJxgo_B2HVlIzqgtLlQcqcx39sUDT4itfingWujPUB3KlNn9AEVpdraY';

// Which modules can notify, and what each is called on the settings screen. The key
// is what Apps Script checks against the device's saved preferences.
const NOTIFY_MODULES = [
  { key: 'finance', label: 'Finance entries', icon: 'ti-report-money' },
  { key: 'jazz', label: 'Jazz entries and updates', icon: 'ti-paw' },
  { key: 'noah', label: 'Noah entries and updates', icon: 'ti-mood-kid' },
  { key: 'weight', label: 'Weigh-ins', icon: 'ti-scale' }
];

const Notify = {
  _messaging: null,
  _sdkLoading: null,

  // A stable per-device id, so re-registering the same phone updates its row
  // instead of piling up a new one every time the token is refreshed.
  deviceId() {
    let id = localStorage.getItem('hb_device_id');
    if (!id) { id = 'dev-' + uid(); localStorage.setItem('hb_device_id', id); }
    return id;
  },

  // A human-readable label so a stale row is identifiable later.
  deviceLabel() {
    const ua = navigator.userAgent;
    const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device';
    const installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    return os + (installed ? ' (installed)' : ' (browser)');
  },

  supported() {
    return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  },

  // iPhone only allows push from a home-screen install, so a Safari tab can never
  // ask — worth saying plainly instead of letting the prompt silently not appear.
  iosNeedsInstall() {
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    return isIOS && !installed;
  },

  permission() {
    return this.supported() ? Notification.permission : 'unsupported';
  },

  async localRecord() {
    return (await DB.get('notifyDevices', this.deviceId())) || null;
  },

  async isOnHere() {
    const rec = await this.localRecord();
    return !!(rec && rec.token && !rec.disabled && this.permission() === 'granted');
  },

  // The Firebase SDK is only pulled in when someone actually turns notifications on,
  // rather than on every app start — it's a sizeable download for a feature most
  // sessions never touch.
  loadSdk() {
    if (window.firebase && window.firebase.messaging) return Promise.resolve();
    if (this._sdkLoading) return this._sdkLoading;
    const add = (src) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
    this._sdkLoading = add('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js')
      .then(() => add('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js'));
    return this._sdkLoading;
  },

  async messaging() {
    await this.loadSdk();
    if (!this._messaging) {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      this._messaging = firebase.messaging();
    }
    return this._messaging;
  },

  // Turns notifications on for THIS device: asks permission, gets a token, and
  // saves the device row. Returns a plain { ok, reason } so the settings screen can
  // explain what happened rather than just failing.
  async enableHere() {
    if (!this.supported()) return { ok: false, reason: 'unsupported' };
    if (this.iosNeedsInstall()) return { ok: false, reason: 'ios-install' };
    let permission = Notification.permission;
    if (permission === 'default') {
      try { permission = await Notification.requestPermission(); } catch (e) { return { ok: false, reason: 'error', error: e.message }; }
    }
    if (permission === 'denied') return { ok: false, reason: 'denied' };
    if (permission !== 'granted') return { ok: false, reason: 'dismissed' };

    try {
      const registration = await navigator.serviceWorker.ready;
      const messaging = await this.messaging();
      const token = await messaging.getToken({ vapidKey: FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration });
      if (!token) return { ok: false, reason: 'no-token' };
      const existing = await this.localRecord();
      const rec = {
        id: this.deviceId(),
        email: Auth.email || '',
        token,
        label: this.deviceLabel(),
        prefs: existing && existing.prefs ? existing.prefs : { finance: true, jazz: true, noah: true, weight: false },
        disabled: false,
        updatedAt: new Date().toISOString(),
        synced: false
      };
      await DB.put('notifyDevices', rec);
      await Sync.pushEntry('NotifyDevices', rec);
      await DB.put('notifyDevices', rec);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'error', error: e.message };
    }
  },

  // Turns this device off without touching the other person's settings or your
  // other devices: the row stays but is marked disabled, so Apps Script skips it.
  async disableHere() {
    const rec = await this.localRecord();
    if (!rec) return;
    rec.disabled = true;
    rec.updatedAt = new Date().toISOString();
    rec.synced = false;
    await DB.put('notifyDevices', rec);
    await Sync.pushEntry('NotifyDevices', rec);
    await DB.put('notifyDevices', rec);
    try {
      const messaging = await this.messaging();
      await messaging.deleteToken();
    } catch (e) { /* the row is already disabled, which is what actually matters */ }
  },

  async setPref(key, value) {
    const rec = await this.localRecord();
    if (!rec) return;
    rec.prefs = rec.prefs || {};
    rec.prefs[key] = value;
    rec.updatedAt = new Date().toISOString();
    rec.synced = false;
    await DB.put('notifyDevices', rec);
    await Sync.pushEntry('NotifyDevices', rec);
    await DB.put('notifyDevices', rec);
  },

  // Asks Apps Script to push a message back to this device, which is the only way
  // to prove the whole chain works end to end rather than just the permission part.
  async sendTest() {
    const rec = await this.localRecord();
    if (!rec || !rec.token) return { ok: false, error: 'This device isn\'t registered yet.' };
    const url = await Sync.getUrl();
    const token = await Auth.ensureToken();
    if (!url || !token) return { ok: false, error: 'Not connected.' };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'notifyTest', deviceId: rec.id, token })
      });
      const data = await res.json();
      return data && data.ok ? { ok: true } : { ok: false, error: (data && data.error) || 'Unknown error' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  // A token can be rotated by the browser at any time. Re-registering on each app
  // start when notifications are already on keeps the stored one current, otherwise
  // notifications quietly stop arriving months later with nothing to show why.
  async refreshTokenIfOn() {
    try {
      if (this.permission() !== 'granted') return;
      const rec = await this.localRecord();
      if (!rec || rec.disabled) return;
      const registration = await navigator.serviceWorker.ready;
      const messaging = await this.messaging();
      const token = await messaging.getToken({ vapidKey: FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration });
      if (token && token !== rec.token) {
        rec.token = token;
        rec.updatedAt = new Date().toISOString();
        rec.synced = false;
        await DB.put('notifyDevices', rec);
        await Sync.pushEntry('NotifyDevices', rec);
        await DB.put('notifyDevices', rec);
      }
    } catch (e) { /* best effort — never block app start on this */ }
  }
};

// ---------- settings screen ----------

async function renderNotificationsSettings() {
  const rec = await Notify.localRecord();
  const on = await Notify.isOnHere();
  const permission = Notify.permission();
  const other = Auth.email === 'nassimb@gmail.com' ? 'Safia' : 'Nassim';

  let statusBlock;
  if (!Notify.supported()) {
    statusBlock = `<div class="card tight" style="background:var(--line)">
      <p style="font-size:13px"><i class="ti ti-bell-off"></i> This browser can't do notifications. Try the installed app instead.</p>
    </div>`;
  } else if (Notify.iosNeedsInstall()) {
    statusBlock = `<div class="card tight" style="background:var(--gold-soft)">
      <p style="font-size:13px;font-weight:600;color:#8a6412"><i class="ti ti-device-mobile"></i> Add Homebase to your Home Screen first</p>
      <p style="font-size:12px;color:#8a6412;margin-top:4px">iPhone only allows notifications from the installed app. Tap Share, then Add to Home Screen, then open Homebase from there and come back to this screen.</p>
    </div>`;
  } else if (permission === 'denied') {
    statusBlock = `<div class="card tight" style="background:var(--red-soft)">
      <p style="font-size:13px;font-weight:600;color:var(--red)"><i class="ti ti-bell-x"></i> Notifications are blocked</p>
      <p style="font-size:12px;color:var(--red);margin-top:4px">Homebase can't ask again from here. Turn them on in your phone's Settings → Notifications → Homebase, then come back.</p>
    </div>`;
  } else if (on) {
    statusBlock = `<div class="card tight" style="background:var(--sage-soft)">
      <p style="font-size:13px;font-weight:600;color:#0F6E56"><i class="ti ti-bell-ringing"></i> Notifications on for this device</p>
      <p style="font-size:12px;color:#0F6E56;margin-top:4px">${esc(rec.label || 'This device')}</p>
    </div>`;
  } else {
    statusBlock = `<div class="card tight">
      <p style="font-size:13px;font-weight:600"><i class="ti ti-bell-off"></i> Notifications are off on this device</p>
      <p style="font-size:12px;color:var(--ink-soft);margin-top:4px">Get notified when ${other} adds a new entry. Nothing is sent for your own entries, and edits never notify.</p>
      <button class="btn btn-primary" style="margin-top:10px" id="notifyEnableBtn" onclick="enableNotificationsHere()">Turn on notifications</button>
    </div>`;
  }

  const prefs = (rec && rec.prefs) || {};
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMoreMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Notifications</span></div>
    ${statusBlock}
    <p id="notifyStatusLine" style="font-size:12px;color:var(--ink-soft);margin:8px 0 0;min-height:16px"></p>
    ${on ? `
      <p class="section-label settings-group">Notify me when ${esc(other)} adds</p>
      ${NOTIFY_MODULES.map((m) => `
        <div class="list-row" onclick="toggleNotifyPref('${m.key}')">
          <span><i class="ti ${m.icon}"></i> ${m.label}</span>
          <span class="chip ${prefs[m.key] ? 'active' : ''}" id="notifyPref_${m.key}">${prefs[m.key] ? 'On' : 'Off'}</span>
        </div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn" style="flex:1" onclick="sendTestNotification()"><i class="ti ti-bell-ringing"></i> Send test</button>
        <button class="btn" style="flex:1" onclick="disableNotificationsHere()">Turn off here</button>
      </div>
      <p style="font-size:11px;color:var(--ink-soft);margin-top:14px">These settings are yours alone — they control what this device receives, not what ${esc(other)} gets. Phones sometimes hold a notification back for a minute or two to save battery.</p>
    ` : ''}
  `;
}

async function enableNotificationsHere() {
  const btn = document.getElementById('notifyEnableBtn');
  const line = document.getElementById('notifyStatusLine');
  if (btn) { btn.disabled = true; btn.textContent = 'Setting up…'; }
  const result = await Notify.enableHere();
  if (result.ok) { renderNotificationsSettings(); return; }
  if (btn) { btn.disabled = false; btn.textContent = 'Turn on notifications'; }
  const messages = {
    unsupported: "This browser can't do notifications.",
    'ios-install': 'Add Homebase to your Home Screen first, then try again.',
    denied: "You tapped Don't Allow. Turn notifications on in your phone's settings for Homebase, then come back.",
    dismissed: 'The permission prompt was dismissed. Tap the button again when you\'re ready.',
    'no-token': "Couldn't get a device token. Check your connection and try again.",
    error: 'Something went wrong: ' + (result.error || 'unknown')
  };
  if (line) { line.textContent = messages[result.reason] || messages.error; line.style.color = 'var(--red)'; }
  if (result.reason === 'denied' || result.reason === 'ios-install') renderNotificationsSettings();
}

async function disableNotificationsHere() {
  if (!confirm('Turn notifications off on this device? Your other devices and Safia\'s are unaffected.')) return;
  await Notify.disableHere();
  renderNotificationsSettings();
}

async function toggleNotifyPref(key) {
  const rec = await Notify.localRecord();
  if (!rec) return;
  const next = !(rec.prefs && rec.prefs[key]);
  await Notify.setPref(key, next);
  const chip = document.getElementById('notifyPref_' + key);
  if (chip) { chip.textContent = next ? 'On' : 'Off'; chip.classList.toggle('active', next); }
}

async function sendTestNotification() {
  const line = document.getElementById('notifyStatusLine');
  if (line) { line.textContent = 'Sending…'; line.style.color = 'var(--ink-soft)'; }
  const result = await Notify.sendTest();
  if (!line) return;
  line.textContent = result.ok ? 'Sent — it should arrive in a few seconds.' : 'Test failed: ' + result.error;
  line.style.color = result.ok ? '#0F6E56' : 'var(--red)';
}
