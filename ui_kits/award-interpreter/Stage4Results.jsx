/* Stage 4 — Results */
(function () {
  const { Icon, RESULTS, STATS, money } = window.AK;
  const NS = window.AxiWFMAwardInterpreterDesignSystem_c5602f || {};
  const { StatCard, ResultRow, Button } = NS;
  const RESULTS_GRID = '1.55fr 1fr 1fr 1.35fr 0.95fr 1.1fr 1.2fr';

  function Stage4Results({ onReset, onDisperse }) {
    const [openRow, setOpenRow] = React.useState('e1');
    return (
      <div className="fade-up">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 32 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sage)' }}>
              <Icon name="BadgeCheck" size={14} strokeWidth={1.9} color="var(--sage)" /> Calculation complete
            </div>
            <h1 className="display" style={{ fontSize: 'clamp(30px, 4.6vw, 46px)' }}>{STATS.employees} employees calculated</h1>
          </div>
          <div style={{ display: 'flex', gap: 11 }}>
            <Button iconLeft={<Icon name="Download" size={16} strokeWidth={1.9} />}>Export CSV</Button>
            <Button onClick={onReset} iconLeft={<Icon name="RotateCcw" size={15} strokeWidth={1.9} />}>New interpretation</Button>
          </div>
        </div>

        <div className="stats-grid" style={{ marginBottom: 36 }}>
          <StatCard icon={<Icon name="Clock" size={16} />} label="Total hours" value={`${STATS.totalHours}`} caption="across the uploaded timesheet" accent="ink" />
          <StatCard icon={<Icon name="Banknote" size={16} />} label="Base pay" value={money(STATS.totalBasePay)} caption="hours × matched base pay rate" accent="sage" />
          <StatCard icon={<Icon name="Layers" size={16} />} label="Extras" value={money(STATS.totalExtras)} caption="allowances and penalties" accent="ochre" />
          <StatCard icon={<Icon name="AlertTriangle" size={16} />} label="Validation rows" value={`${STATS.validationErrors}`} caption="employees needing manual review" accent="red" />
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 18, padding: '20px 4px 8px' }}>
          <div className="table-scroll">
            <div className="table-inner">
              <div className="thead" style={{ gridTemplateColumns: RESULTS_GRID }}>
                <span className="th">Employee Name</span><span className="th">Award Code</span><span className="th">Employee Level</span>
                <span className="th">Job Role</span><span className="th">Base Pay</span><span className="th">Extras / Allowances</span><span className="th">Total Calculated Pay</span>
              </div>
              <div>
                {RESULTS.map((row) => {
                  const r = { ...row };
                  // fold override/malformed notes into the breakdown as flags shown in the panel
                  if (row.malformed) r.validationErrors = [];
                  return <ResultRowExt key={row.id} row={row} open={openRow === row.id} onToggle={(n) => setOpenRow(n ? row.id : '')} />;
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 22, padding: '18px 22px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <div>
            <span className="eyebrow">Ready to disperse</span>
            <div style={{ marginTop: 5, fontSize: 14.5 }}>
              <span style={{ fontWeight: 600 }}>{STATS.employees} employees</span>
              <span style={{ color: 'var(--muted)' }}> · {money(STATS.totalCalculatedPay)} total calculated pay</span>
            </div>
          </div>
          <Button variant="primary" onClick={onDisperse} iconRight={<Icon name="ArrowRight" size={18} strokeWidth={2} />}>Disperse pay</Button>
        </div>
      </div>
    );
  }

  // Wrap ResultRow to surface the override / malformed note as a Flag inside the panel.
  const { Flag } = NS;
  function ResultRowExt({ row, open, onToggle }) {
    const note = row.override || row.malformed;
    if (!note) return <ResultRow row={row} open={open} onToggle={onToggle} />;
    return (
      <div style={{ position: 'relative' }}>
        <ResultRow row={row} open={open} onToggle={onToggle} />
        {open && (
          <div style={{ padding: '0 18px 20px', marginTop: -14 }}>
            <Flag danger={!!row.malformed} icon={<Icon name="AlertTriangle" size={15} strokeWidth={1.8} />}>{note}</Flag>
          </div>
        )}
      </div>
    );
  }

  Object.assign(window.AK, { Stage4Results });
})();
