/* Shared kit module: icon helper, mock data, and the shell chrome (background,
   masthead, footer). Exports onto window.AK so sibling babel scripts can read it. */
window.AK = window.AK || {};

const L = window.lucide || {};
function Icon({ name, size = 16, strokeWidth = 1.8, color = 'currentColor', spin = false, style }) {
  const node = L[name];
  if (!node || !Array.isArray(node[2])) return null;
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color,
    strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
    style: { ...(spin ? { animation: 'ax-spin 0.9s linear infinite' } : null), ...style },
  }, node[2].map((c, i) => React.createElement(c[0], { key: i, ...c[1] })));
}

const audFmt = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const money = (v) => audFmt.format(Number(v) || 0);

/* ---- Mock data (healthcare demo pack, hand-crafted for the recreation) ---- */
const AWARDS = [
  { code: 'MA000034', title: 'Nurses Award 2020', levels: 22, rows: 184, tone: 'sage', prov: 'Preloaded · Healthcare', matched: true },
  { code: 'MA000018', title: 'Aged Care Award 2010', levels: 14, rows: 121, tone: 'sage', prov: 'Preloaded · Healthcare', matched: true },
  { code: 'MA000027', title: 'Health Professionals Award 2020', levels: 19, rows: 156, tone: 'sage', prov: 'Preloaded · Healthcare', matched: false },
  { code: 'MA000012', title: 'Pharmacy Industry Award 2020', levels: 9, rows: 78, tone: 'sage', prov: 'Preloaded · Healthcare', matched: false },
];

// Flat clause rows for the interpretation table (Stage 3), MA000034
const CLAUSE_ROWS = [
  { level: 'RN Level 1', code: 'B.1.1', category: 'Base rate', title: 'Ordinary hourly rate', plain: 'Registered Nurse level 1 is paid the base ordinary hourly rate for all ordinary hours.', value: '$38.42/hr', clause: 'cl. 15.2', matched: true },
  { level: 'RN Level 1', code: 'B.1.1', category: 'Casual loading', title: 'Casual loading', plain: 'Casual employees receive a 25% loading on the ordinary hourly rate in lieu of paid leave.', value: '+25%', clause: 'cl. 12.3', matched: true, employment: 'casual' },
  { level: 'RN Level 1', code: 'B.1.1', category: 'Saturday', title: 'Saturday penalty', plain: 'Ordinary hours worked on a Saturday attract a 150% penalty of the ordinary rate.', value: '×1.50', clause: 'cl. 21.1', matched: true },
  { level: 'RN Level 1', code: 'B.1.1', category: 'Sunday', title: 'Sunday penalty', plain: 'Ordinary hours worked on a Sunday attract a 175% penalty of the ordinary rate.', value: '×1.75', clause: 'cl. 21.2', matched: true },
  { level: 'RN Level 1', code: 'B.1.1', category: 'Night', title: 'Night shift loading', plain: 'A shift finishing after midnight or starting before 6:00am attracts a 15% loading.', value: '+15%', clause: 'cl. 22.4', matched: true, cond: 'shift finishes after 00:00 or starts before 06:00' },
  { level: 'RN Level 1', code: 'B.1.1', category: 'Overtime', title: 'Overtime — first 2 hours', plain: 'The first two hours of overtime on a day are paid at 150% of the ordinary rate.', value: '×1.50', clause: 'cl. 23.1', matched: true },
  { level: 'EN Pay Point 1', code: 'B.2.1', category: 'Base rate', title: 'Ordinary hourly rate', plain: 'Enrolled Nurse pay point 1 is paid the base ordinary hourly rate for all ordinary hours.', value: '$32.18/hr', clause: 'cl. 15.2', matched: false },
  { level: 'EN Pay Point 1', code: 'B.2.1', category: 'Public holiday', title: 'Public holiday penalty', plain: 'Ordinary hours on a public holiday are paid at 250% of the ordinary rate.', value: '×2.50', clause: 'cl. 21.3', matched: false },
  { level: 'AIN Level 3', code: 'B.3.1', category: 'Base rate', title: 'Ordinary hourly rate', plain: 'Assistant in Nursing level 3 is paid the base ordinary hourly rate.', value: '$29.74/hr', clause: 'cl. 15.2', matched: false },
  { level: 'AIN Level 3', code: 'B.3.1', category: 'Allowance', title: 'Sleepover allowance', plain: 'A sleepover shift attracts a flat allowance per night in addition to any hours worked.', value: '$62.04/night', clause: 'cl. 24.6', matched: false, cond: 'employee sleeps over on the premises' },
];

const PURPOSES = {
  'cl. 15.2': 'sets the minimum ordinary rate for each classification level',
  'cl. 12.3': 'sets the casual loading paid instead of paid leave entitlements',
  'cl. 21.1': 'sets the Saturday penalty rate',
  'cl. 21.2': 'sets the Sunday penalty rate',
  'cl. 21.3': 'sets the public holiday penalty rate',
  'cl. 22.4': 'sets the night-shift loading',
  'cl. 23.1': 'defines when overtime starts and the overtime rate',
  'cl. 24.6': 'grants the sleepover allowance',
};

const RESULTS = [
  { id: 'e1', employeeName: 'Sofia Marino', awardCode: 'MA000034', employeeLevel: 'RN Level 1', jobRole: 'Registered Nurse', totalHours: 76, employmentType: 'Permanent part-time', basePay: 38.42, extrasTotal: 84.10, totalCalculatedPay: 663.60, shiftCount: 6,
    breakdown: { ordinaryPay: 579.50, items: [{ label: 'Saturday penalty · 6 hrs', amount: 84.10 }], effectiveHourlyRate: 42.18, clauseRef: 'cl. 15.2' },
    worked: ['Saturday worked · 6 hrs'] },
  { id: 'e2', employeeName: "Liam O'Rourke", awardCode: 'MA000034', employeeLevel: 'RN Level 2', jobRole: 'Registered Nurse', totalHours: 80, employmentType: 'Full-time', basePay: 41.06, extrasTotal: 168.00, totalCalculatedPay: 1350.00, shiftCount: 8,
    breakdown: { ordinaryPay: 1182.00, items: [{ label: 'Sunday penalty · 8 hrs', amount: 92.00 }, { label: 'Overtime · 4 hrs', amount: 76.00 }], effectiveHourlyRate: 43.90, clauseRef: 'cl. 15.2' },
    worked: ['Sunday worked · 8 hrs', 'Overtime worked · $76.00'] },
  { id: 'e3', employeeName: 'Ruth Adebayo', awardCode: 'MA000018', employeeLevel: 'PC Level 4', jobRole: 'Personal care worker', totalHours: 72, employmentType: 'Permanent part-time', basePay: 30.12, extrasTotal: 0, totalCalculatedPay: 1116.00, shiftCount: 6,
    override: 'Over-award rate applied — the agreement pays $2.40/hr above the award base under a registered agreement.',
    breakdown: { ordinaryPay: 1116.00, items: [], effectiveHourlyRate: 32.52, clauseRef: 'cl. 15.2' },
    worked: [] },
  { id: 'e4', employeeName: 'Chen Wei', awardCode: 'MA000018', employeeLevel: 'PC Level 2', jobRole: 'Personal care worker', totalHours: 40, employmentType: 'Casual', basePay: 27.44, extrasTotal: 4.12, totalCalculatedPay: 462.30, shiftCount: 4,
    malformed: 'Night loading parsed as ×0.15 over a 10:00–13:00 window — malformed award data, shown as-is by design.',
    breakdown: { ordinaryPay: 458.18, items: [{ label: 'Night loading · ×0.15 (10:00–13:00)', amount: 4.12 }], effectiveHourlyRate: 28.90, clauseRef: 'cl. 22.4' },
    worked: [] },
  { id: 'e5', employeeName: 'Priya Nair', awardCode: 'Unmatched', employeeLevel: '—', jobRole: 'Registered Nurse', totalHours: 64, employmentType: 'Full-time',
    validationErrors: ['No award level matched. This name appears in the timesheet but not in the uploaded employee agreement — the agreement file is probably the wrong pay period.'] },
];

const STATS = { employees: 5, totalHours: 332, totalBasePay: 3703.90, totalExtras: 256.22, totalCalculatedPay: 3591.90, validationErrors: 1 };

const STEPS = [
  { label: 'Hashing the document set', detail: 'Computing the cache fingerprint for the uploaded rule documents and preloaded award library' },
  { label: 'Parsing award records', detail: 'Extracting award code, title, levels, rates, allowances and penalties from the industry library' },
  { label: 'Reading employee agreements', detail: 'Mapping employees to award code, employee level, job role and agreement overrides' },
  { label: 'Cross-referencing compliance', detail: 'Collecting non-overriding compliance notes and mismatch warnings' },
  { label: 'Building the lookup cache', detail: 'Materialising O(1) indexes keyed by award code and employee level' },
];

function Background() {
  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      <div className="bg-grid" />
      <div className="blob blob-1" /><div className="blob blob-2" /><div className="blob blob-3" />
    </div>
  );
}

function Masthead({ stage }) {
  const names = { 1: 'Upload', 2: 'Processing', 3: 'Interpretation', 4: 'Results', 5: 'Confirmation' };
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 46 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="../../assets/isoft-i.png" alt="iSOFT" style={{ height: 34, width: 'auto', display: 'block' }} />
        <div style={{ width: 1, height: 30, background: 'var(--line)' }} />
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 16.5, lineHeight: 1 }}>Axi&thinsp;·&thinsp;WFM</div>
          <div className="eyebrow" style={{ marginTop: 4 }}>Award Interpreter</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--muted)' }}>STAGE 0{stage} / 05</span>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--muted)' }} />
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--ink)' }}>{names[stage].toUpperCase()}</span>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <div className="footer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="../../assets/isoft-wordmark.png" alt="iSOFT" style={{ height: 17, width: 'auto', display: 'block' }} />
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--muted)' }}>ANZ · AWARD INTERPRETATION</span>
      </div>
      <span style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 420, textAlign: 'right' }}>Suggestions only. Review every classification against the current award before processing pay.</span>
    </div>
  );
}

Object.assign(window.AK, { Icon, money, AWARDS, CLAUSE_ROWS, PURPOSES, RESULTS, STATS, STEPS, Background, Masthead, Footer });
