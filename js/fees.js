/* Copy of apps-script/Fees.gs — browser fee preview only; the server recalculates. */
/**
 * Fee and date logic (blueprint section 6, steps 4–5).
 * Pure functions with no Google services, so the same code runs in Apps Script,
 * in the browser (public/js/fees.js is a copy) and in the Node unit tests.
 * Dates are plain 'yyyy-mm-dd' strings to avoid timezone drift.
 */

function parseYmd(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y: y, m: mo, d: d };
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function fmtYmd(y, m, d) {
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

/** Start date + k months, same day; if that day doesn't exist, the month's last day. */
function addMonthsClamp(ymd, k) {
  var p = parseYmd(ymd);
  var total = (p.m - 1) + k;
  var y = p.y + Math.floor(total / 12);
  var m = (total % 12 + 12) % 12 + 1;
  return fmtYmd(y, m, Math.min(p.d, daysInMonth(y, m)));
}

function addDaysYmd(ymd, n) {
  var p = parseYmd(ymd);
  var dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return fmtYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** last_date and extension_end for a course. */
function courseDates(startDate, s) {
  var days = Number(s.duration_days) || 0;
  var months = Number(s.duration_months) || 0;
  var last = days > 0 ? addDaysYmd(startDate, days) : addMonthsClamp(startDate, months);
  var ext = addMonthsClamp(last, Number(s.extension_months) || 0);
  return { last_date: last, extension_end: ext };
}

var OPTION_FULL = 'Full advance';
var OPTION_EMI = '50% advance + EMI';

/**
 * Builds the fee plan from the Settings row for the course.
 * Amounts are never taken from the browser.
 * @return {{ok:boolean, error?:string, plan?:Object}}
 */
function buildFeePlan(course, option, startDate, s) {
  if (!s) return { ok: false, error: 'Unknown course: ' + course };
  if (!parseYmd(startDate)) return { ok: false, error: 'Invalid start date' };
  var emiCount = Number(s.emi_count) || 0;
  var dates = courseDates(startDate, s);
  var plan = {
    course: course, option: option, start_date: startDate,
    last_date: dates.last_date, extension_end: dates.extension_end,
    total_fee: 0, advance_due: 0, balance: 0, emi_count: 0, emis: []
  };
  if (option === OPTION_FULL) {
    plan.total_fee = Math.round(Number(s.full_fee));
    plan.advance_due = plan.total_fee;
  } else if (option === OPTION_EMI) {
    if (!emiCount || !Number(s.instalment_fee)) {
      return { ok: false, error: 'EMI not offered for ' + course };
    }
    var pct = Number(s.advance_pct);
    if (pct > 1) pct = pct / 100; // accept 50 or 0.5
    plan.total_fee = Math.round(Number(s.instalment_fee));
    plan.advance_due = Math.round(plan.total_fee * pct);
    plan.balance = plan.total_fee - plan.advance_due;
    plan.emi_count = emiCount;
    var base = Math.floor(plan.balance / emiCount);
    var rem = plan.balance - base * emiCount;
    for (var k = 1; k <= emiCount; k++) {
      var due = addMonthsClamp(startDate, k);
      plan.emis.push({ emi_no: k, amount_due: base + (k === 1 ? rem : 0), due_date: due, default_due_date: due });
    }
  } else {
    return { ok: false, error: 'Unknown payment option' };
  }
  return { ok: true, plan: plan };
}

/**
 * Applies staff-moved due dates. changes = [{emi_no, due_date, reason}].
 * Accepted only with a reason, dates must stay in order and fall on or before extension_end.
 */
function applyDueDateChanges(plan, changes) {
  changes = changes || [];
  for (var i = 0; i < changes.length; i++) {
    var c = changes[i];
    var emi = null;
    for (var j = 0; j < plan.emis.length; j++) if (plan.emis[j].emi_no === Number(c.emi_no)) emi = plan.emis[j];
    if (!emi) return { ok: false, error: 'Unknown EMI ' + c.emi_no };
    if (c.due_date === emi.default_due_date) continue;
    if (!parseYmd(c.due_date)) return { ok: false, error: 'Invalid due date for EMI ' + c.emi_no };
    var reason = String(c.reason || '').trim();
    if (!reason) return { ok: false, error: 'A reason is needed to move EMI ' + c.emi_no };
    emi.due_date = c.due_date;
    emi.date_change_reason = reason;
  }
  var prev = plan.start_date;
  for (var k = 0; k < plan.emis.length; k++) {
    var d = plan.emis[k].due_date;
    if (d <= prev) return { ok: false, error: 'EMI due dates must stay in order, after the start date' };
    if (d > plan.extension_end) return { ok: false, error: 'EMI ' + plan.emis[k].emi_no + ' must be due on or before ' + plan.extension_end };
    prev = d;
  }
  return { ok: true, plan: plan };
}

if (typeof module !== 'undefined') {
  module.exports = { parseYmd: parseYmd, addMonthsClamp: addMonthsClamp, addDaysYmd: addDaysYmd,
    courseDates: courseDates, buildFeePlan: buildFeePlan, applyDueDateChanges: applyDueDateChanges,
    OPTION_FULL: OPTION_FULL, OPTION_EMI: OPTION_EMI };
}
