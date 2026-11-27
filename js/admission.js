/* Admission form (blueprint section 7). Alpine.js component. */
var REQUIRED_DOCS = ['Aadhaar', '10th marks card', 'Photo'];
var DRAFT_KEY = 'np_draft';
var IMG_TARGET = 1024 * 1024;   // ~1 MB after compression
var PDF_MAX = 5 * 1024 * 1024;  // 5 MB
var STEP_NAMES = ['Student', 'Guardian & background', 'Course', 'Fees & EMI', 'Documents', 'Permissions & review'];

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, function (c) {
    return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16);
  });
}

function todayYmd() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function blankForm() {
  return {
    full_name: '', dob: '', gender: '', phone: '', same_wa: true, whatsapp: '', alt_phone: '', email: '',
    address: '', town_taluk: '', district: 'Belagavi', pin: '',
    guardian_relation: '', guardian_name: '', guardian_phone: '',
    currently: '', experience: '', goal: '', heard_from: '',
    course: '', slot: '', start_date: '', counsellor: '',
    option: '', advance_paid: '', advance_date: todayYmd(), advance_mode: '', advance_ref: '', advance_receipt_no: '',
    due_dates: {}, pending: {},
    consent_whatsapp: false, consent_media: false, consent_testimonial: false, consent_events: false,
    consent_declaration: false, consent_fee_terms: false
  };
}

function fmtDate(ymd) {
  var p = parseYmd(ymd || '');
  if (!p) return '';
  return p.d + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][p.m - 1] + ' ' + p.y;
}

function rupees(n) {
  n = Math.round(Number(n) || 0);
  return '₹' + n.toLocaleString('en-IN');
}

function readAsBase64(blob) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(String(r.result).split(',')[1]); };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Resize/compress an image to JPEG under ~1 MB. */
function compressImage(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      var maxSide = 2000;
      var attempt = function (side, q) {
        var scale = Math.min(1, side / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) {
          if (!b) return reject(new Error('Could not read the image'));
          if (b.size <= IMG_TARGET || (side <= 800 && q <= 0.5)) return resolve(b);
          if (q > 0.55) attempt(side, q - 0.15); else attempt(Math.round(side * 0.75), 0.8);
        }, 'image/jpeg', q);
      };
      attempt(maxSide, 0.85);
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('This image could not be opened')); };
    img.src = url;
  });
}

function admissionApp() {
  return {
    STEP_NAMES: STEP_NAMES, REQUIRED_DOCS: REQUIRED_DOCS, fmtDate: fmtDate, rupees: rupees,
    me: {}, settings: { courses: [], slots: [], counsellors: [] },
    loading: true, loadError: '', step: 1, error: '',
    f: blankForm(), aadhaar_last4: '', submissionId: uuid(),
    files: {}, others: [], fileMsg: {},
    phase: 'form', progress: '', result: null, uploads: [], pdfUrl: '', finaliseError: '', emailedTo: [],
    reauthOpen: false, _reauthResolve: null,

    async init() {
      if (!NP.configured() || !NP.getToken()) { location.href = 'index.html'; return; }
      try { this.me = JSON.parse(sessionStorage.getItem('np_me') || '{}'); } catch (e) {}
      var self = this;
      NP.initGis(function () {
        if (self._reauthResolve) { self.reauthOpen = false; var r = self._reauthResolve; self._reauthResolve = null; r(); }
      });
      NP.onReauth(function () {
        return new Promise(function (resolve) {
          self._reauthResolve = resolve;
          self.reauthOpen = true;
          self.$nextTick(function () { NP.renderButton(document.getElementById('reauth-btn')); });
        });
      });

      this.loadDraft();
      try {
        this.settings = await NP.call('getSettings');
        if (!this.me.email) this.me = await NP.call('whoami');
      } catch (e) {
        if (e.auth) { NP.signOut(); return; }
        this.loadError = e.message;
      }
      this.loading = false;

      this.$watch('f', function () { self.saveDraft(); });
      this.$watch('step', function () { self.saveDraft(); window.scrollTo(0, 0); });
      this.$watch('f.course', function (c) {
        if (c === '45 Days') self.f.option = 'Full advance';
        self.f.due_dates = {};
      });
      this.$watch('f.start_date', function () { self.f.due_dates = {}; });
      this.$watch('f.option', function () { self.f.due_dates = {}; });
    },

    // ---------- draft (typed fields only; never files or Aadhaar digits) ----------
    saveDraft() {
      if (this.phase !== 'form') return;
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ f: this.f, step: this.step, submissionId: this.submissionId }));
    },
    loadDraft() {
      try {
        var d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
        if (d && d.f) {
          this.f = Object.assign(blankForm(), d.f);
          this.step = d.step || 1;
          this.submissionId = d.submissionId || this.submissionId;
        }
      } catch (e) {}
    },
    clearDraft() { sessionStorage.removeItem(DRAFT_KEY); },

    // ---------- computed ----------
    get courseSettings() {
      var c = this.f.course;
      return this.settings.courses.filter(function (x) { return x.course === c; })[0] || null;
    },
    get emiAllowed() { var s = this.courseSettings; return !!(s && s.emi_count && s.instalment_fee); },
    get basePlan() {
      if (!this.courseSettings || !parseYmd(this.f.start_date) || !this.f.option) return null;
      var r = buildFeePlan(this.f.course, this.f.option, this.f.start_date, this.courseSettings);
      return r.ok ? r.plan : null;
    },
    get dates() {
      if (!this.courseSettings || !parseYmd(this.f.start_date)) return null;
      return courseDates(this.f.start_date, this.courseSettings);
    },
    get dueChanges() {
      var dd = this.f.due_dates, out = [];
      Object.keys(dd).forEach(function (k) {
        if (dd[k] && dd[k].date) out.push({ emi_no: Number(k), due_date: dd[k].date, reason: dd[k].reason || '' });
      });
      return out;
    },
    get plan() {
      var p = this.basePlan;
      if (!p || !p.emis.length) return p;
      var copy = JSON.parse(JSON.stringify(p));
      var r = applyDueDateChanges(copy, this.dueChanges);
      copy._error = r.ok ? '' : r.error;
      return copy;
    },
    emiDate(e) { var x = this.f.due_dates[e.emi_no]; return (x && x.date) || e.default_due_date; },
    emiMoved(e) { var x = this.f.due_dates[e.emi_no]; return !!(x && x.date && x.date !== e.default_due_date); },
    setEmiDate(e, val) {
      var cur = this.f.due_dates[e.emi_no] || { date: '', reason: '' };
      this.f.due_dates = Object.assign({}, this.f.due_dates, { [e.emi_no]: { date: val, reason: cur.reason } });
    },
    setEmiReason(e, val) {
      var cur = this.f.due_dates[e.emi_no] || { date: e.default_due_date, reason: '' };
      this.f.due_dates = Object.assign({}, this.f.due_dates, { [e.emi_no]: { date: cur.date, reason: val } });
    },
    slotLabel(s) { return s.slot + (s.timing ? ' (' + s.timing + ')' : ''); },

    // ---------- validation per step ----------
    validate(step) {
      var f = this.f, e = [];
      var ten = function (v) { return /^\d{10}$/.test(String(v || '').replace(/\s+/g, '')); };
      if (step === 1) {
        if (!f.full_name.trim()) e.push('Full name');
        if (!f.dob || f.dob >= todayYmd()) e.push('A valid date of birth');
        if (!f.gender) e.push('Gender');
        if (!ten(f.phone)) e.push('Phone (10 digits)');
        if (!f.same_wa && !ten(f.whatsapp)) e.push('WhatsApp (10 digits)');
        if (f.alt_phone && !ten(f.alt_phone)) e.push('Alternate phone must be 10 digits');
        if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.push('A valid email address');
        if (!f.address.trim()) e.push('Address');
        if (!f.town_taluk.trim()) e.push('Town / taluk');
        if (!f.district.trim()) e.push('District');
        if (!/^\d{6}$/.test(f.pin)) e.push('PIN (6 digits)');
      }
      if (step === 2) {
        if (!f.guardian_relation) e.push('Guardian relation');
        if (!f.guardian_name.trim()) e.push('Guardian name');
        if (!ten(f.guardian_phone)) e.push('Guardian phone (10 digits)');
        if (!f.currently) e.push('Currently');
        if (!f.experience) e.push('Stitching experience');
        if (!f.goal) e.push('Goal');
        if (!f.heard_from) e.push('Heard about us');
      }
      if (step === 3) {
        if (!f.course) e.push('Course');
        if (!f.slot) e.push('Time slot');
        if (!parseYmd(f.start_date)) e.push('Training start date');
        else if (f.start_date < addDaysYmd(todayYmd(), -30)) e.push('Start date cannot be more than 30 days in the past');
      }
      if (step === 4) {
        if (!f.option) e.push('Payment option');
        var paid = Number(f.advance_paid) || 0;
        if (paid < 0) e.push('Advance paid cannot be negative');
        if (this.plan && paid > this.plan.total_fee) e.push('Advance paid is more than the total fee');
        if (paid > 0 && !parseYmd(f.advance_date)) e.push('Advance payment date');
        if (paid > 0 && !f.advance_mode) e.push('Payment mode');
        if (this.plan && this.plan._error) e.push(this.plan._error);
      }
      if (step === 5) {
        var self = this;
        REQUIRED_DOCS.forEach(function (t) {
          if (!self.files[t] && !parseYmd(f.pending[t] || '')) e.push(t + ': attach the file or give a "will give by" date');
        });
        if (this.files['Aadhaar'] && !/^\d{4}$/.test(this.aadhaar_last4)) e.push('Aadhaar: last 4 digits');
      }
      if (step === 6) {
        if (!f.consent_declaration) e.push('Tick the declaration');
        if (!f.consent_fee_terms) e.push('Tick the agreement to the fee terms');
      }
      return e;
    },
    next() {
      var e = this.validate(this.step);
      if (e.length) { this.error = 'Please fill in: ' + e.join(', ') + '.'; return; }
      this.error = '';
      if (this.step < 6) this.step++;
    },
    back() { this.error = ''; if (this.step > 1) this.step--; },

    // ---------- files ----------
    async pickFile(type, ev, idx) {
      var file = ev.target.files && ev.target.files[0];
      var key = idx === undefined ? type : 'Other' + idx;
      this.fileMsg[key] = '';
      if (!file) return;
      var ok = ['image/jpeg', 'image/png', 'application/pdf'];
      if (ok.indexOf(file.type) < 0) {
        ev.target.value = '';
        this.fileMsg[key] = 'Only JPG, PNG or PDF files are allowed.';
        return;
      }
      var entry;
      try {
        if (file.type === 'application/pdf') {
          if (file.size > PDF_MAX) { ev.target.value = ''; this.fileMsg[key] = 'PDF is larger than 5 MB.'; return; }
          entry = { blob: file, mime: 'application/pdf', size: file.size, name: file.name };
        } else {
          this.fileMsg[key] = 'Compressing…';
          var b = await compressImage(file);
          entry = { blob: b, mime: 'image/jpeg', size: b.size, name: file.name };
          this.fileMsg[key] = '';
        }
      } catch (err) {
        ev.target.value = '';
        this.fileMsg[key] = err.message;
        return;
      }
      if (idx === undefined) this.files = Object.assign({}, this.files, { [type]: entry });
      else this.others[idx] = Object.assign({ doc_type: 'Other' }, entry);
    },
    removeFile(type) { var c = Object.assign({}, this.files); delete c[type]; this.files = c; },
    addOther() { this.others.push({ doc_type: 'Other', blob: null }); },
    sizeText(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; },

    // ---------- submit ----------
    payload() {
      var f = this.f, self = this;
      var p = {};
      ['full_name', 'dob', 'gender', 'phone', 'alt_phone', 'email', 'address', 'town_taluk', 'district', 'pin',
        'guardian_relation', 'guardian_name', 'guardian_phone', 'currently', 'experience', 'goal', 'heard_from',
        'course', 'slot', 'start_date', 'counsellor', 'option', 'advance_date', 'advance_mode', 'advance_ref',
        'advance_receipt_no', 'consent_whatsapp', 'consent_media', 'consent_testimonial', 'consent_events',
        'consent_declaration', 'consent_fee_terms'].forEach(function (k) { p[k] = f[k]; });
      p.whatsapp = f.same_wa ? f.phone : f.whatsapp;
      p.advance_paid = Number(f.advance_paid) || 0;
      p.aadhaar_last4 = this.aadhaar_last4;
      p.submission_id = this.submissionId;
      p.due_date_changes = this.dueChanges;
      p.documents = REQUIRED_DOCS.map(function (t) {
        return { doc_type: t, upload: !!self.files[t], pending_by_date: self.files[t] ? '' : (f.pending[t] || '') };
      }).concat(this.others.filter(function (o) { return o.blob; }).map(function () { return { doc_type: 'Other', upload: true }; }));
      return p;
    },

    async submit() {
      for (var s = 1; s <= 6; s++) {
        var e = this.validate(s);
        if (e.length) { this.step = s; this.error = 'Please fill in: ' + e.join(', ') + '.'; return; }
      }
      this.error = '';
      this.phase = 'submitting';
      this.progress = 'Saving the admission…';
      try {
        this.result = await NP.call('submitAdmission', this.payload());
      } catch (err) {
        this.phase = 'form';
        this.error = err.message;
        return;
      }
      this.clearDraft();

      var self = this;
      this.uploads = [];
      REQUIRED_DOCS.forEach(function (t) { if (self.files[t]) self.uploads.push({ doc_type: t, file: self.files[t], state: 'waiting', error: '' }); });
      this.others.forEach(function (o) { if (o.blob) self.uploads.push({ doc_type: 'Other', file: o, state: 'waiting', error: '' }); });
      for (var i = 0; i < this.uploads.length; i++) {
        this.progress = 'Uploading document ' + (i + 1) + ' of ' + this.uploads.length + ' (' + this.uploads[i].doc_type + ')…';
        await this.uploadOne(this.uploads[i]);
      }
      this.progress = 'Making the PDF and sending the email…';
      await this.finalise();
      this.phase = 'done';
    },

    async uploadOne(u) {
      u.state = 'uploading'; u.error = '';
      try {
        var b64 = await readAsBase64(u.file.blob);
        await NP.call('uploadDocument', { student_id: this.result.student_id, doc_type: u.doc_type, mime_type: u.file.mime, base64: b64 });
        u.state = 'done';
      } catch (err) {
        u.state = 'failed'; u.error = err.message;
      }
    },

    async retryUpload(u) { await this.uploadOne(u); },

    async finalise() {
      this.finaliseError = '';
      try {
        var r = await NP.call('finaliseAdmission', { student_id: this.result.student_id });
        var bin = atob(r.pdf_base64), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        if (this.pdfUrl) URL.revokeObjectURL(this.pdfUrl);
        this.pdfUrl = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
        this.emailedTo = r.emailed_to || [];
      } catch (err) {
        this.finaliseError = err.message;
      }
    },

    printPdf() { if (this.pdfUrl) window.open(this.pdfUrl, '_blank'); },

    newAdmission() {
      this.clearDraft();
      if (this.pdfUrl) URL.revokeObjectURL(this.pdfUrl);
      this.f = blankForm(); this.aadhaar_last4 = ''; this.files = {}; this.others = []; this.fileMsg = {};
      this.submissionId = uuid(); this.result = null; this.uploads = []; this.pdfUrl = ''; this.emailedTo = [];
      this.finaliseError = ''; this.error = ''; this.step = 1; this.phase = 'form';
      window.scrollTo(0, 0);
    },

    signOut() { NP.signOut(); }
  };
}
