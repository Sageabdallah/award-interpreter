/* Stage 5 — Confirmation (email preview → success state) */
(function () {
  const { Icon, RESULTS, STATS, money } = window.AK;
  const NS = window.AxiWFMAwardInterpreterDesignSystem_c5602f || {};
  const { StatCard, Button } = NS;

  const PAID = RESULTS.filter((r) => !(r.validationErrors && r.validationErrors.length));

  function Stage5Confirmation({ onBack, onReset }) {
    const [recipient, setRecipient] = React.useState('payroll@wharftavern.com.au');
    const [sent, setSent] = React.useState(false);
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim());

    if (sent) {
      return (
        <div className="fade-up" style={{ maxWidth: 640 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--sage-tint)', border: '1px solid var(--sage-ring)', display: 'grid', placeItems: 'center', color: 'var(--sage)', marginBottom: 22 }}>
            <Icon name="CheckCircle2" size={28} strokeWidth={1.8} />
          </div>
          <div className="eyebrow" style={{ marginBottom: 12, color: 'var(--sage)' }}>Confirmation sent</div>
          <h1 className="display" style={{ fontSize: 'clamp(30px, 4.6vw, 46px)' }}>Payroll dispersed.</h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--text-secondary)', marginTop: 16 }}>
            A confirmation for {money(STATS.totalCalculatedPay)} across {STATS.employees} employees was sent to
            <span className="mono" style={{ color: 'var(--ink)' }}> {recipient}</span>.
          </p>
          <div style={{ marginTop: 26, display: 'flex', gap: 11 }}>
            <Button onClick={onReset} iconLeft={<Icon name="RotateCcw" size={15} strokeWidth={1.9} />}>New interpretation</Button>
          </div>
        </div>
      );
    }

    return (
      <div className="fade-up">
        <div style={{ marginBottom: 30, maxWidth: 640 }}>
          <div className="eyebrow" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sage)' }}>
            <Icon name="CheckCircle2" size={14} strokeWidth={1.9} color="var(--sage)" /> 05 — Confirmation
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(30px, 4.6vw, 46px)' }}>Pay dispersed.</h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--text-secondary)', marginTop: 16 }}>
            Payroll has been dispersed for the period. Review the summary and send a confirmation to the payroll mailbox below.
          </p>
        </div>

        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 28 }}>
          <StatCard icon={<Icon name="Banknote" size={16} />} label="Total dispersed" value={money(STATS.totalCalculatedPay)} caption="calculated pay, this pay period" accent="sage" />
          <StatCard icon={<Icon name="BadgeCheck" size={16} />} label="Employees paid" value={`${STATS.employees}`} caption="The Wharf Tavern" accent="ink" />
          <StatCard icon={<Icon name="CalendarClock" size={16} />} label="Pay period" value="Processed" caption="Fortnight ending 08 Jul 2026" accent="ochre" />
        </div>

        {/* Email preview with leader-dot lines */}
        <div className="panel-inner" style={{ marginBottom: 26 }}>
          <div className="panel-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="Mail" size={13} strokeWidth={1.9} /> Payroll summary — email preview
          </div>
          <div className="email-preview">
            <div style={{ fontWeight: 600, marginBottom: 10 }}>Payroll dispersed — The Wharf Tavern (Fortnight ending 08 Jul 2026)</div>
            {PAID.map((r) => (
              <div className="leader" key={r.id}>
                <span className="leader-label">{r.employeeName}</span>
                <span className="leader-dots" />
                <span className="leader-amt">{money(r.totalCalculatedPay)}</span>
              </div>
            ))}
            <div className="leader leader-total">
              <span className="leader-label">Total dispersed</span>
              <span className="leader-dots" />
              <span className="leader-amt">{money(STATS.totalCalculatedPay)}</span>
            </div>
          </div>

          <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', margin: '18px 0 6px' }}>Send confirmation to</label>
          <input type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} aria-label="Confirmation email recipient"
            style={{ width: '100%', maxWidth: 420, fontFamily: 'var(--font-mono)', fontSize: 13.5, color: 'var(--ink)', background: 'var(--paper)',
              border: `1px solid ${valid ? 'var(--line)' : 'rgba(180,69,47,0.5)'}`, borderRadius: 10, padding: '11px 13px', outline: 'none' }} />
          {!valid && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>Enter a valid email address.</div>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="primary" disabled={!valid} onClick={() => setSent(true)} iconLeft={<Icon name="Send" size={17} strokeWidth={2} />}>Send confirmation email</Button>
          <Button onClick={onBack} iconLeft={<Icon name="ArrowLeft" size={15} strokeWidth={1.9} />}>Back to results</Button>
          <Button onClick={onReset} iconLeft={<Icon name="RotateCcw" size={15} strokeWidth={1.9} />}>New interpretation</Button>
        </div>
      </div>
    );
  }

  Object.assign(window.AK, { Stage5Confirmation });
})();
