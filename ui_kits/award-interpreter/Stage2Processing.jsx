/* Stage 2 — Processing (with a toggleable error state) */
(function () {
  const { Icon, STEPS } = window.AK;
  const NS = window.AxiWFMAwardInterpreterDesignSystem_c5602f || {};
  const { StepRow, Pill, Flag, Button } = NS;

  function Stage2Processing({ auto = true, onDone, onBack, errored = false }) {
    const [active, setActive] = React.useState(auto ? 0 : STEPS.length);
    React.useEffect(() => {
      if (!auto || errored) return;
      if (active >= STEPS.length) { const t = setTimeout(() => onDone && onDone(), 550); return () => clearTimeout(t); }
      const t = setTimeout(() => setActive((a) => a + 1), 720);
      return () => clearTimeout(t);
    }, [active, auto, errored]);

    const pct = Math.min(100, Math.round((active / STEPS.length) * 100));

    return (
      <div className="fade-up">
        <div style={{ marginBottom: 28, maxWidth: 640 }}>
          <div className="eyebrow" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="Sparkles" size={13} strokeWidth={1.8} /> 02 — Processing
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(30px, 4.4vw, 44px)' }}>Building the award cache&hellip;</h1>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 30 }}>
          <Pill icon={<Icon name="Layers" size={15} strokeWidth={1.7} color="var(--ochre)" />}>Healthcare library · 4 awards preloaded</Pill>
          <Pill icon={<Icon name="FileText" size={15} strokeWidth={1.7} color="var(--sage)" />}>agreement-healthcare.pdf</Pill>
        </div>

        <div style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--muted)' }}>PROGRESS</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ochre)' }}>{errored ? '40' : pct}%</span>
          </div>
          <div style={{ height: 4, background: 'rgba(31,30,27,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${errored ? 40 : pct}%`, height: '100%', background: errored ? 'var(--red)' : 'var(--ochre)', borderRadius: 3, transition: 'width 0.5s var(--ease-out)' }} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {STEPS.map((s, i) => {
            let status = i < active ? 'done' : i === active ? 'active' : 'pending';
            if (errored && i === 1) status = 'active';
            if (errored && i > 1) status = 'pending';
            return <StepRow key={s.label} {...s} delay={i * 90} status={status}
              doneIcon={<Icon name="Check" size={17} strokeWidth={2.4} />}
              activeIcon={<Icon name="Loader2" size={18} strokeWidth={2.2} spin />} />;
          })}
        </div>

        {errored && (
          <div style={{ marginTop: 24 }}>
            <Flag danger icon={<Icon name="AlertTriangle" size={15} strokeWidth={1.8} />}>
              Could not parse <b style={{ fontWeight: 600, margin: '0 4px' }}>agreement-healthcare.pdf</b> — the file appears to be a scanned image with no extractable text layer. Re-export it as a text PDF and upload again.
            </Flag>
            <div style={{ marginTop: 14 }}>
              <Button onClick={onBack} iconLeft={<Icon name="ArrowLeft" size={15} strokeWidth={1.9} />}>Back to upload</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  Object.assign(window.AK, { Stage2Processing });
})();
