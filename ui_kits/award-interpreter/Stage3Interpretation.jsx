/* Stage 3 — Award interpretation (the distinctive screen) */
(function () {
  const { Icon, AWARDS, CLAUSE_ROWS, PURPOSES, money } = window.AK;
  const NS = window.AxiWFMAwardInterpreterDesignSystem_c5602f || {};
  const { AccordionHeader, ClauseRef, Pill, Button } = NS;

  const FLAT_GRID = '1.35fr 0.85fr 2.3fr 0.95fr 0.75fr';
  const CAP = 40;

  function ClauseCell({ clause }) {
    if (!clause) return <span>—</span>;
    return <ClauseRef refText={clause} purpose={PURPOSES[clause]} align="right" style={{ fontSize: 11, color: 'var(--muted)' }} />;
  }

  function InterpTable({ rows }) {
    const [showAll, setShowAll] = React.useState(false);
    const ordered = [...rows.filter((r) => r.matched), ...rows.filter((r) => !r.matched)];
    const visible = showAll ? ordered : ordered.slice(0, CAP);
    return (
      <div style={{ padding: '0 6px 12px' }}>
        <div className="table-scroll">
          <div className="table-inner" style={{ minWidth: 760 }}>
            <div className="thead" style={{ gridTemplateColumns: FLAT_GRID }}>
              <span className="th">Level</span><span className="th">Category</span><span className="th">Interpretation</span><span className="th">Value / rate</span><span className="th">Clause</span>
            </div>
            {visible.map((r, i) => (
              <div key={i} className="trow rowwrap" style={{ gridTemplateColumns: FLAT_GRID, cursor: 'default', alignItems: 'start' }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap', minWidth: 0 }}>
                  {r.matched && <Icon name="BadgeCheck" size={13} strokeWidth={2} color="var(--sage)" style={{ flexShrink: 0, alignSelf: 'center' }} />}
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{r.code}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{r.level}</span>
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.category}{r.employment === 'casual' && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · casual</span>}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.title}</span>{' — '}{r.plain}
                  {r.cond && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>When: {r.cond}</span>}
                </span>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.value}</span>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}><ClauseCell clause={r.clause} /></span>
              </div>
            ))}
          </div>
        </div>
        {!showAll && ordered.length > CAP && (
          <div style={{ padding: '12px 12px 4px' }}>
            <Button onClick={() => setShowAll(true)} iconLeft={<Icon name="ChevronDown" size={15} strokeWidth={1.9} />}>Show all {ordered.length} clause rows</Button>
          </div>
        )}
      </div>
    );
  }

  function Stage3Interpretation({ onBack, onContinue }) {
    const [open, setOpen] = React.useState('MA000034');
    return (
      <div className="fade-up">
        <div style={{ marginBottom: 26, maxWidth: 660 }}>
          <div className="eyebrow" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="Scale" size={13} strokeWidth={1.8} /> 03 — Award interpretation
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(30px, 4.4vw, 44px)' }}>The award, read for you.</h1>
          <p style={{ fontSize: 15.5, lineHeight: 1.6, color: 'var(--text-secondary)', marginTop: 14 }}>
            Deterministically — no timesheet needed. One row per clause interpretation: each classification level,
            every loading, penalty and allowance it grants, and the clause behind each one. Levels named in the
            employee agreement are marked and shown first.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
          <Pill icon={<Icon name="Layers" size={15} strokeWidth={1.7} color="var(--ochre)" />}>4 awards cached</Pill>
          <Pill icon={<Icon name="BadgeCheck" size={15} strokeWidth={1.7} color="var(--sage)" />}>64 award levels</Pill>
          <Pill icon={<Icon name="Scale" size={15} strokeWidth={1.7} color="var(--ink)" />}>2 parse warnings</Pill>
        </div>

        {AWARDS.map((a) => {
          const isOpen = open === a.code;
          const rows = a.code === 'MA000034' ? CLAUSE_ROWS : CLAUSE_ROWS.slice(6);
          return (
            <div key={a.code} className="emp-group" style={{ marginBottom: 12 }}>
              <AccordionHeader code={a.code} title={a.title} matched={a.matched} open={isOpen}
                onToggle={() => setOpen(isOpen ? '' : a.code)}
                meta={[`${a.levels} levels`, `${a.rows} clause rows`]}
                provenance={{ label: a.prov, tone: a.tone }}
                checkIcon={<Icon name="BadgeCheck" size={15} strokeWidth={1.8} />}
                chevron={<Icon name="ChevronDown" size={16} strokeWidth={1.8} />} />
              {isOpen && <InterpTable rows={rows} />}
            </div>
          );
        })}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 460, lineHeight: 1.5 }}>
            Everything above is derived from the award text alone. Upload the pay-period timesheet to apply it to real shifts.
          </span>
          <div style={{ display: 'flex', gap: 11 }}>
            <Button onClick={onBack} iconLeft={<Icon name="ArrowLeft" size={15} strokeWidth={1.9} />}>Back to upload</Button>
            <Button variant="primary" onClick={onContinue} iconRight={<Icon name="ArrowRight" size={18} strokeWidth={2} />}>Upload timesheet</Button>
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window.AK, { Stage3Interpretation });
})();
