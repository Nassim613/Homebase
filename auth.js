// ============================================================
// Google Sign-In — real, verifiable identity for access control
// ============================================================
// Uses Google's own Identity Services library (loaded in index.html). A successful
// sign-in produces a short-lived, cryptographically signed token — Apps Script verifies
// this directly with Google on every request, so nobody can fake being someone else
// just by knowing the app's URL, unlike the old "anyone with the link" setup.
//
// GOOGLE_CLIENT_ID must exactly match the one in google-apps-script.gs's
// GOOGLE_CLIENT_ID constant — this is what proves a token was issued for OUR app.
const GOOGLE_CLIENT_ID = '374079870242-sf3snkj4k6pcd0k2aflj8j4agmeppgvu.apps.googleusercontent.com';

const Auth = {
  token: null,
  email: null,
  _tokenExpiry: 0,
  _onSignedIn: null,

  init(onSignedIn) {
    this._onSignedIn = onSignedIn;

    // Restore a cached token if it's still valid, so a page refresh doesn't force
    // signing in again every single time.
    const cached = localStorage.getItem('hb_auth_token');
    const cachedExpiry = parseInt(localStorage.getItem('hb_auth_expiry') || '0', 10);
    const cachedEmail = localStorage.getItem('hb_auth_email');
    if (cached && cachedExpiry > Date.now()) {
      this.token = cached;
      this.email = cachedEmail;
      this._tokenExpiry = cachedExpiry;
    }

    if (this.isTokenValid()) {
      onSignedIn();
      return;
    }

    // The cached token's expired — Google ID tokens only last about an hour, so this
    // happens on essentially every "closed the app a while ago, opened it again" case,
    // not just once in a while. The browser's own Google session is very often still
    // active though, so try a SILENT renewal first (Google's One Tap, invisible if it
    // works) before ever showing the blocking sign-in screen. Previously this only got
    // attempted underneath the sign-in screen after it was already displayed — so even
    // a successful silent refresh still meant a visible "please sign in" flash every
    // single time. Falls back to the real sign-in screen only if the silent attempt
    // genuinely can't produce a token (session truly expired, One Tap suppressed after
    // being dismissed a few times, third-party cookies blocked, etc — a real platform
    // limit, not something fixable from here).
    this._trySilentReauth(0);
  },

  _trySilentReauth(attempt) {
    if (window.google && google.accounts && google.accounts.id) {
      if (!this._initialized) {
        google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (response) => this._handleCredential(response) });
        this._initialized = true;
      }
      google.accounts.id.prompt((notification) => {
        const gotCredential = typeof notification.isNotDisplayed === 'function' ? !notification.isNotDisplayed() && !notification.isSkippedMoment() : true;
        if (!gotCredential && !this.isTokenValid()) this.showSignInScreen();
        // If a credential WAS produced, _handleCredential already fired and called
        // onSignedIn() itself — nothing further needed here.
      });
    } else if (attempt < 20) {
      setTimeout(() => this._trySilentReauth(attempt + 1), 250); // up to ~5 seconds waiting for the Google library to load
    } else {
      this.showSignInScreen();
    }
  },

  _handleCredential(response) {
    const token = response.credential;
    let payload;
    try { payload = this._decodeJwt(token); } catch (e) { return; }
    this.token = token;
    this.email = payload.email;
    this._tokenExpiry = payload.exp * 1000;
    localStorage.setItem('hb_auth_token', token);
    localStorage.setItem('hb_auth_expiry', String(this._tokenExpiry));
    localStorage.setItem('hb_auth_email', payload.email);
    this.hideSignInScreen();
    if (this._onSignedIn) this._onSignedIn();
  },

  _decodeJwt(token) {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(base64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  },

  isTokenValid() {
    return !!this.token && this._tokenExpiry > Date.now() + 60000; // 1-minute safety buffer
  },

  showSignInScreen() {
    let overlay = document.getElementById('authOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'authOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg,#F7F3E9);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:24px;text-align:center';
      overlay.innerHTML = `
        <p style="font-family:'Fraunces',serif;font-size:24px;font-weight:600;color:#2B2640;margin:0">Homebase</p>
        <p style="font-size:14px;color:#5B5568;max-width:280px;margin:0">Sign in with the Google account you were approved with to continue.</p>
        <div id="googleSignInBtn"></div>
      `;
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    this._tryRenderButton(0);
  },

  // The Google Sign-In library can occasionally still be loading when this first runs
  // (slow connection, etc) — rather than silently leaving the screen with no button,
  // retry briefly until it's ready.
  _tryRenderButton(attempt) {
    if (window.google && google.accounts && google.accounts.id) {
      if (!this._initialized) {
        google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (response) => this._handleCredential(response) });
        this._initialized = true;
      }
      google.accounts.id.renderButton(document.getElementById('googleSignInBtn'), { theme: 'filled_black', size: 'large', text: 'signin_with' });
      google.accounts.id.prompt(); // also offers One Tap if a Google session is already active
    } else if (attempt < 20) {
      setTimeout(() => this._tryRenderButton(attempt + 1), 250); // up to ~5 seconds total
    } else {
      const btn = document.getElementById('googleSignInBtn');
      if (btn) btn.innerHTML = '<p style="font-size:12px;color:var(--red,#C9564F)">Couldn\'t load Google Sign-In — check your connection and reload.</p>';
    }
  },

  hideSignInScreen() {
    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.style.display = 'none';
  },

  signOut() {
    this.token = null; this.email = null; this._tokenExpiry = 0;
    localStorage.removeItem('hb_auth_token');
    localStorage.removeItem('hb_auth_expiry');
    localStorage.removeItem('hb_auth_email');
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    this.showSignInScreen();
  },

  // Call before any sync request. Returns a valid token, silently refreshing via a
  // still-active Google session if possible — only falls back to the visible sign-in
  // screen if that doesn't work. Returns null if no valid token could be obtained,
  // which callers treat the same as "not connected."
  async ensureToken() {
    if (this.isTokenValid()) return this.token;
    return new Promise((resolve) => {
      if (window.google && google.accounts && google.accounts.id) {
        google.accounts.id.prompt(() => {
          resolve(this.isTokenValid() ? this.token : null);
          if (!this.isTokenValid()) this.showSignInScreen();
        });
      } else {
        this.showSignInScreen();
        resolve(null);
      }
    });
  }
};
