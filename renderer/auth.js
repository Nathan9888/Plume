/* Plume — page de connexion (courriel + mot de passe). Elle s'affiche au premier lancement, ou après une déconnexion,
   puis plus jamais : la session est conservée (chiffrée dans l'application Windows). */
(function () {
  'use strict';
  const { h, svgIcon } = P;
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  let root = null;
  let open = false;
  let mode = 'in';                         // in | up | forgot
  let waiting = null;                      // { promise, resolve }
  let busy = false;
  let note = '';                           // message d'information au-dessus du formulaire

  const fields = {};
  const ui = {};

  const COPY = {
    in: { title: 'Connexion à Plume', sub: 'Retrouvez vos documents et vos réglages sur tous vos appareils.', go: 'Se connecter', busy: 'Connexion…' },
    up: { title: 'Créer votre compte', sub: 'Un compte gratuit synchronise vos documents entre l’application Windows, le fichier .html et le site.', go: 'Créer le compte', busy: 'Création…' },
    forgot: { title: 'Mot de passe oublié', sub: 'Entrez votre courriel : nous vous enverrons un lien pour choisir un nouveau mot de passe.', go: 'Envoyer le lien', busy: 'Envoi…' },
  };

  function build() {
    ui.err = h('div', { class: 'auth-err', role: 'alert', hidden: '' });
    ui.note = h('div', { class: 'auth-note', role: 'status', hidden: '' });
    fields.email = h('input', { type: 'email', name: 'email', autocomplete: 'username', placeholder: 'vous@exemple.com', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Courriel' });
    fields.pw = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'Mot de passe', 'aria-label': 'Mot de passe' });
    fields.pw2 = h('input', { type: 'password', name: 'password2', autocomplete: 'new-password', placeholder: 'Confirmer le mot de passe', 'aria-label': 'Confirmer le mot de passe' });
    ui.eye = h('button', { type: 'button', class: 'auth-eye', title: 'Afficher le mot de passe', 'aria-label': 'Afficher le mot de passe', 'aria-pressed': 'false', tabindex: '-1',
      onclick: () => {
        const show = fields.pw.type === 'password';
        fields.pw.type = show ? 'text' : 'password';
        fields.pw2.type = fields.pw.type;
        ui.eye.setAttribute('aria-pressed', String(show));
        ui.eye.title = show ? 'Masquer le mot de passe' : 'Afficher le mot de passe';
      } }, svgIcon('i-eye'));
    ui.pwWrap = h('div', { class: 'auth-pw' }, fields.pw, ui.eye);
    ui.pw2Wrap = h('div', { class: 'auth-pw', hidden: '' }, fields.pw2);
    ui.title = h('h1', { id: 'auth-title' });
    ui.sub = h('p', { class: 'auth-sub' });
    ui.go = h('button', { type: 'submit', class: 'auth-go' });
    ui.forgot = h('button', { type: 'button', class: 'auth-link', text: 'Mot de passe oublié ?', onclick: () => setMode('forgot') });
    ui.switch = h('button', { type: 'button', class: 'auth-link' });
    ui.back = h('button', { type: 'button', class: 'auth-link', text: 'Retour à la connexion', onclick: () => setMode('in') });
    ui.fine = h('p', { class: 'auth-fine', text: 'Vos documents sont enregistrés dans votre compte en ligne. La connexion n’a lieu qu’une fois : Plume vous reconnaît ensuite à chaque lancement, même sans Internet.' });

    const form = h('form', { class: 'auth-card', novalidate: '', onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('span', { class: 'brand-tile auth-tile' }, svgIcon('i-feather')),
      ui.title, ui.sub, ui.note,
      h('div', { class: 'auth-fields' }, fields.email, ui.pwWrap, ui.pw2Wrap),
      ui.err, ui.go,
      h('div', { class: 'auth-links' }, ui.forgot, ui.switch, ui.back),
      ui.fine);
    root = h('div', { id: 'auth', class: 'auth', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'auth-title', hidden: '' },
      h('div', { class: 'auth-drag' }), h('div', { class: 'auth-body' }, form));
    document.body.append(root);
    // Tant que la page est ouverte, aucun raccourci de l'application ne doit se déclencher derrière elle.
    window.addEventListener('keydown', (e) => { if (open) e.stopPropagation(); }, true);
  }

  function showError(msg) {
    ui.err.textContent = msg || '';
    ui.err.hidden = !msg;
  }
  function showNote(msg) {
    ui.note.textContent = msg || '';
    ui.note.hidden = !msg;
  }

  function setMode(m) {
    mode = m;
    const c = COPY[m];
    ui.title.textContent = c.title;
    ui.sub.textContent = c.sub;
    ui.go.textContent = c.go;
    ui.pwWrap.hidden = m === 'forgot';
    ui.pw2Wrap.hidden = m !== 'up';
    fields.pw.autocomplete = m === 'up' ? 'new-password' : 'current-password';
    ui.forgot.hidden = m !== 'in';
    ui.back.hidden = m !== 'forgot';
    ui.switch.hidden = m === 'forgot';
    ui.switch.textContent = m === 'up' ? 'J’ai déjà un compte' : 'Créer un compte';
    ui.switch.onclick = () => setMode(m === 'up' ? 'in' : 'up');
    showError('');
    if (m === 'forgot') showNote('');
    (m === 'forgot' || !fields.email.value ? fields.email : fields.pw).focus();
  }

  function setBusy(on) {
    busy = on;
    ui.go.disabled = on;
    ui.go.textContent = on ? COPY[mode].busy : COPY[mode].go;
    [fields.email, fields.pw, fields.pw2].forEach((f) => { f.disabled = on; });
  }

  async function submit() {
    if (busy) return;
    const email = fields.email.value.trim();
    const pw = fields.pw.value;
    showError('');
    if (!EMAIL.test(email)) { showError('Entrez une adresse courriel valide.'); fields.email.focus(); return; }
    if (mode !== 'forgot') {
      if (!pw) { showError('Entrez votre mot de passe.'); fields.pw.focus(); return; }
      if (mode === 'up') {
        if (pw.length < 8) { showError('Choisissez un mot de passe d’au moins 8 caractères.'); fields.pw.focus(); return; }
        if (pw !== fields.pw2.value) { showError('Les deux mots de passe ne sont pas identiques.'); fields.pw2.focus(); return; }
      }
    }
    setBusy(true);
    let r;
    try {
      r = mode === 'forgot' ? await P.sync.recover(email) : mode === 'up' ? await P.sync.signUp(email, pw) : await P.sync.signIn(email, pw);
    } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    setBusy(false);
    if (!r || !r.ok) { showError((r && r.error) || 'Échec de la connexion.'); (mode === 'in' ? fields.pw : fields.email).focus(); return; }
    if (mode === 'forgot') { setMode('in'); showNote('Si un compte existe pour ' + email + ', un courriel vient d’être envoyé avec un lien pour choisir un nouveau mot de passe.'); return; }
    if (r.needsConfirm) { setMode('in'); showNote('Un courriel de confirmation vient d’être envoyé à ' + email + '. Confirmez votre adresse, puis connectez-vous.'); return; }
    // connecté : le gestionnaire d'événements ferme la page
  }

  function show(message) {
    if (!root) build();
    if (open) { if (message) showNote(message); return waiting.promise; }
    open = true;
    note = message || '';
    root.hidden = false;
    document.body.classList.add('auth-open');
    for (const el of document.body.children) if (el !== root && el.tagName !== 'SCRIPT') el.setAttribute('inert', '');
    fields.pw.value = ''; fields.pw2.value = '';
    fields.pw.type = 'password'; fields.pw2.type = 'password';
    ui.eye.setAttribute('aria-pressed', 'false');
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    waiting = { promise, resolve };
    setMode('in');
    showNote(note);
    return promise;
  }

  function hide() {
    if (!open) return;
    open = false;
    root.hidden = true;
    document.body.classList.remove('auth-open');
    for (const el of document.body.children) el.removeAttribute('inert');
    fields.pw.value = ''; fields.pw2.value = '';
    const w = waiting;
    waiting = null;
    if (w) w.resolve(true);
    const ed = document.getElementById('editor');
    if (ed && document.body.dataset.view === 'doc') ed.focus();
  }

  P.auth = { show, hide, isOpen: () => open };

  P.sync.on((t) => {
    if (t !== 'auth') return;
    const a = P.sync.account;
    if (a.configured && !a.signedIn) show(P.sync.lostMessage);
    else if (a.signedIn) hide();
  });
})();
