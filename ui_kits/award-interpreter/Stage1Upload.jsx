/* Stage 1 — Upload */
(function () {
  const { Icon } = window.AK;
  const NS = window.AxiWFMAwardInterpreterDesignSystem_c5602f || {};
  const { UploadCard, Pill, Badge, Button } = NS;

  const INDUSTRIES = ['Healthcare', 'Hospitality', 'Retail', 'Construction'];
  const PRELOAD = window.AK.AWARDS;

  function Stage1Upload({ onContinue }) {
    const [industry, setIndustry] = React.useState('Healthcare');
    const [docs, setDocs] = React.useState({ award: null, compliance: null, agreement: { name: 'agreement-healthcare.pdf', size: 12480 } });
    const preloaded = industry === 'Healthcare';
    const ready = Boolean(docs.agreement && (docs.award || preloaded));
    const up = <Icon name="UploadCloud" size={24} />, ck = <Icon name="Check" size={19} strokeWidth={2.2} />, rm = <Icon name="X" size={16} />;
    const setDoc = (k, f) => setDocs((d) => ({ ...d, [k]: f }));

    return (
      <div className="fade-up">
        <div style={{ marginBottom: 36, maxWidth: 640 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>01 — Upload</div>
          <h1 className="display" style={{ fontSize: 'clamp(34px, 5vw, 52px)' }}>Parse the award stack.</h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--text-secondary)', marginTop: 16 }}>
            Select a preloaded industry award library or upload an award document, then add the employee
            agreement. Compliance documents are optional but will be cross-referenced into the cached
            backend state before the timesheet is uploaded.
          </p>
        </div>

        {/* Industry selector */}
        <div className="panel-inner" style={{ marginBottom: 26, padding: '18px 20px' }}>
          <div className="panel-label" style={{ marginBottom: 12 }}>Industry award library — preload instead of uploading an award</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Pill selected={!industry} onClick={() => setIndustry('')}>No preload — upload award</Pill>
            {INDUSTRIES.map((name) => (
              <Pill key={name} selected={industry === name} disabled={name !== 'Healthcare'}
                icon={<Icon name="Layers" size={14} strokeWidth={1.7} color={industry === name ? 'var(--ochre)' : 'var(--muted)'} />}
                onClick={() => setIndustry(industry === name ? '' : name)}>{name}</Pill>
            ))}
          </div>
          {preloaded && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                {PRELOAD.map((a) => (
                  <Pill key={a.code} code={a.code} style={{ fontSize: 12 }}>{a.title}<span style={{ color: 'var(--muted)' }}> · {a.levels} levels</span></Pill>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                <Icon name="BadgeCheck" size={15} strokeWidth={1.8} color="var(--sage)" />
                <span style={{ fontSize: 13, color: 'var(--sage)', fontWeight: 500 }}>{PRELOAD.length} awards preloaded — the award document upload is now optional</span>
              </div>
            </>
          )}
        </div>

        <div className="upload-grid">
          <UploadCard index="01" headerIcon={<Icon name="FileText" size={22} />} title="Award Document" optional={preloaded}
            subtitle={preloaded ? 'Merges on top of the preloaded library' : 'Rulebook or award extraction source'}
            formats="PDF · DOCX · TXT" file={docs.award} onFile={(f) => setDoc('award', f)} onRemove={() => setDoc('award', null)}
            uploadIcon={up} checkIcon={ck} removeIcon={rm} />
          <UploadCard index="02" headerIcon={<Icon name="Scale" size={22} />} title="Compliance Document" optional
            subtitle="Optional compliance annotations" formats="PDF · DOCX · TXT" file={docs.compliance}
            onFile={(f) => setDoc('compliance', f)} onRemove={() => setDoc('compliance', null)} uploadIcon={up} checkIcon={ck} removeIcon={rm} />
          <UploadCard index="03" headerIcon={<Icon name="FileText" size={22} />} title="Employee Agreement"
            subtitle="Profiles, roles, levels and override rates" formats="PDF · DOCX · TXT" file={docs.agreement}
            onFile={(f) => setDoc('agreement', f)} onRemove={() => setDoc('agreement', null)} uploadIcon={up} checkIcon={ck} removeIcon={rm} />
        </div>

        <div style={{ marginTop: 34, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
          <Badge shape="dot" tone={ready ? 'sage' : 'neutral'} ring={ready}>
            {ready ? 'Ready to build the parsed cache' : 'Select an industry or upload an award, plus the employee agreement, to continue'}
          </Badge>
          <Button variant="primary" disabled={!ready} onClick={onContinue} iconRight={<Icon name="ArrowRight" size={18} strokeWidth={2} />}>Interpret award</Button>
        </div>
      </div>
    );
  }

  Object.assign(window.AK, { Stage1Upload });
})();
