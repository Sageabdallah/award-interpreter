/* @ds-bundle: {"format":4,"namespace":"AxiWFMAwardInterpreterDesignSystem_c5602f","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Pill","sourcePath":"components/core/Pill.jsx"},{"name":"AccordionHeader","sourcePath":"components/data/AccordionHeader.jsx"},{"name":"ClauseRef","sourcePath":"components/data/ClauseRef.jsx"},{"name":"ResultRow","sourcePath":"components/data/ResultRow.jsx"},{"name":"StatCard","sourcePath":"components/data/StatCard.jsx"},{"name":"Flag","sourcePath":"components/feedback/Flag.jsx"},{"name":"StepRow","sourcePath":"components/feedback/StepRow.jsx"},{"name":"UploadCard","sourcePath":"components/upload/UploadCard.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"9c9f9b198e92","components/core/Button.jsx":"517856a046ef","components/core/Pill.jsx":"7997b8d27c86","components/data/AccordionHeader.jsx":"086e58f88041","components/data/ClauseRef.jsx":"a15bae18d95b","components/data/ResultRow.jsx":"4e0a75afc9da","components/data/StatCard.jsx":"aa741fdee88b","components/feedback/Flag.jsx":"7769beae9a3a","components/feedback/StepRow.jsx":"30512061f155","components/upload/UploadCard.jsx":"7fc2730b803b","ui_kits/award-interpreter/App.jsx":"2db31dc2c669","ui_kits/award-interpreter/Stage1Upload.jsx":"a0f962154b6d","ui_kits/award-interpreter/Stage2Processing.jsx":"e7f7de97ed20","ui_kits/award-interpreter/Stage3Interpretation.jsx":"0dcc88c51841","ui_kits/award-interpreter/Stage4Results.jsx":"57a2516cb50b","ui_kits/award-interpreter/Stage5Confirmation.jsx":"705230f419e6","ui_kits/award-interpreter/kit.jsx":"215b19160fca"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.AxiWFMAwardInterpreterDesignSystem_c5602f = window.AxiWFMAwardInterpreterDesignSystem_c5602f || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
/**
 * Badge — a small status label. Two shapes:
 *   shape="pill"  a bordered capsule whose text/border take the tone colour
 *                 (used for award provenance: preloaded / uploaded / merged).
 *   shape="dot"   a coloured status dot + label (the "Ready to build" indicator),
 *                 optionally ringed when active.
 * Tones map to the semantic palette. Pass a leading `icon` for a verified check.
 */
function Badge({
  children,
  tone = 'neutral',
  shape = 'pill',
  icon = null,
  ring = false,
  style
}) {
  const toneColor = {
    neutral: 'var(--muted)',
    ink: 'var(--ink)',
    ochre: 'var(--ochre)',
    sage: 'var(--sage)',
    red: 'var(--red)'
  }[tone] || 'var(--muted)';
  if (shape === 'dot') {
    return /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        ...style
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: toneColor,
        boxShadow: ring ? `0 0 0 4px ${tone === 'sage' ? 'var(--sage-glow)' : 'rgba(31,30,27,0.12)'}` : 'none',
        transition: 'all 0.2s ease'
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-body)',
        fontSize: '14.5px',
        fontWeight: 500,
        color: toneColor
      }
    }, children));
  }
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      border: '1px solid',
      borderColor: tone === 'neutral' ? 'var(--line)' : `color-mix(in srgb, ${toneColor} 45%, transparent)`,
      borderRadius: 'var(--radius-pill)',
      padding: '5px 12px',
      background: 'var(--card)',
      fontFamily: 'var(--font-body)',
      fontSize: '11.5px',
      fontWeight: 500,
      color: tone === 'neutral' ? 'var(--ink)' : toneColor,
      ...style
    }
  }, icon, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — the product's two-tier action model.
 *   variant="primary"   ink pill, lifts + turns ochre on hover (the one call-to-action per screen)
 *   variant="secondary" hairline ghost button (default) — "Back", "Export CSV", "New interpretation"
 * Optional leading/trailing Lucide icons. Disabled primary flattens to a muted ghost.
 */
function Button({
  variant = 'secondary',
  children,
  iconLeft = null,
  iconRight = null,
  disabled = false,
  onClick,
  href,
  type = 'button',
  style,
  ...rest
}) {
  const isPrimary = variant === 'primary';
  const base = {
    fontFamily: 'var(--font-body)',
    display: 'inline-flex',
    alignItems: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    textDecoration: 'none',
    transition: 'background var(--dur-med) ease, border-color var(--dur-fast) ease, transform 0.1s ease, box-shadow var(--dur-med) ease'
  };
  const primary = {
    fontSize: '15px',
    fontWeight: 600,
    gap: '10px',
    border: '1px solid var(--accent)',
    borderRadius: 'var(--radius-lg)',
    padding: '15px 28px',
    background: 'var(--accent)',
    color: 'var(--text-on-ink)',
    boxShadow: 'var(--shadow-primary)'
  };
  const primaryDisabled = {
    opacity: 0.4,
    boxShadow: 'none',
    background: 'transparent',
    color: 'var(--muted)',
    borderColor: 'var(--line)'
  };
  const secondary = {
    fontSize: '14px',
    fontWeight: 500,
    gap: '8px',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 16px',
    background: 'transparent',
    color: 'var(--ink)'
  };
  const resolved = isPrimary ? {
    ...base,
    ...primary,
    ...(disabled ? primaryDisabled : null)
  } : {
    ...base,
    ...secondary,
    ...(disabled ? {
      opacity: 0.4
    } : null)
  };
  const handleEnter = e => {
    if (disabled) return;
    if (isPrimary) {
      e.currentTarget.style.background = 'var(--accent-strong)';
      e.currentTarget.style.borderColor = 'var(--accent-strong)';
      e.currentTarget.style.boxShadow = 'var(--shadow-primary-hover)';
      e.currentTarget.style.transform = 'translateY(-1px)';
    } else {
      e.currentTarget.style.background = 'var(--hover-ink)';
      e.currentTarget.style.borderColor = 'var(--border-strong)';
    }
  };
  const handleLeave = e => {
    if (disabled) return;
    if (isPrimary) {
      e.currentTarget.style.background = 'var(--accent)';
      e.currentTarget.style.borderColor = 'var(--accent)';
      e.currentTarget.style.boxShadow = 'var(--shadow-primary)';
      e.currentTarget.style.transform = 'none';
    } else {
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.borderColor = 'var(--line)';
    }
  };
  const Tag = href && !disabled ? 'a' : 'button';
  const tagProps = href && !disabled ? {
    href
  } : {
    type,
    disabled
  };
  return /*#__PURE__*/React.createElement(Tag, _extends({}, tagProps, {
    onClick: disabled ? undefined : onClick,
    onMouseEnter: handleEnter,
    onMouseLeave: handleLeave,
    style: {
      ...resolved,
      ...style
    }
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Pill.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Pill — the workhorse rounded-capsule chip. Used for meta ("12 levels",
 * "48 hrs"), preloaded-award chips, filter toggles and status readouts.
 * Optional leading icon (Lucide element) and a `selected` state that switches
 * to the ochre tint. Set `code` to prepend a mono award-code span.
 */
function Pill({
  children,
  icon = null,
  code = null,
  selected = false,
  disabled = false,
  onClick,
  style,
  ...rest
}) {
  const interactive = typeof onClick === 'function';
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onClick: disabled ? undefined : onClick,
    disabled: disabled,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      border: '1px solid',
      borderColor: selected ? 'var(--ochre)' : 'var(--line)',
      borderRadius: 'var(--radius-pill)',
      padding: '7px 14px',
      background: selected ? 'var(--ochre-tint)' : 'var(--card)',
      fontFamily: 'var(--font-body)',
      fontSize: '13px',
      color: 'var(--ink)',
      cursor: interactive ? disabled ? 'not-allowed' : 'pointer' : 'default',
      opacity: disabled ? 0.5 : 1,
      transition: 'border-color var(--dur-fast) ease, background var(--dur-fast) ease',
      ...style
    }
  }, rest), icon, code && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      color: 'var(--ochre)'
    }
  }, code), children);
}
Object.assign(__ds_scope, { Pill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Pill.jsx", error: String((e && e.message) || e) }); }

// components/data/AccordionHeader.jsx
try { (() => {
/**
 * AccordionHeader — the clickable header of an award-interpretation group.
 * Left: mono ochre award code + serif title + optional verified check.
 * Right: meta pills (levels, clause rows), a toned provenance badge, and a
 * chevron that reflects `open`. Wrap it and the table body in a card.
 */
function AccordionHeader({
  code,
  title,
  matched = false,
  open = false,
  meta = [],
  provenance = null,
  onToggle,
  checkIcon = null,
  chevron = null
}) {
  const provColor = provenance ? {
    sage: 'var(--sage)',
    ochre: 'var(--ochre)',
    neutral: 'var(--muted)'
  }[provenance.tone] || 'var(--ochre)' : null;
  return /*#__PURE__*/React.createElement("div", {
    role: "button",
    tabIndex: 0,
    onClick: onToggle,
    onKeyDown: e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle?.();
      }
    },
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '4px 10px 12px',
      cursor: 'pointer',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 10,
      flexWrap: 'wrap',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12.5,
      color: 'var(--ochre)',
      fontWeight: 600
    }
  }, code), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 18,
      fontWeight: 500
    }
  }, title), matched && /*#__PURE__*/React.createElement("span", {
    style: {
      alignSelf: 'center',
      color: 'var(--sage)',
      display: 'inline-flex'
    }
  }, checkIcon)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, meta.map((m, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius-pill)',
      padding: '5px 12px',
      background: 'var(--card)',
      fontSize: 11.5,
      color: 'var(--ink)'
    }
  }, m)), provenance && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      border: '1px solid',
      borderColor: `color-mix(in srgb, ${provColor} 45%, transparent)`,
      borderRadius: 'var(--radius-pill)',
      padding: '5px 12px',
      background: 'var(--card)',
      fontSize: 11.5,
      color: provColor
    }
  }, provenance.label), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      display: 'inline-flex',
      transform: open ? 'rotate(180deg)' : 'none',
      transition: 'transform var(--dur-med) ease'
    }
  }, chevron || /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14
    }
  }, "\u2304"))));
}
Object.assign(__ds_scope, { AccordionHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/AccordionHeader.jsx", error: String((e && e.message) || e) }); }

// components/data/ClauseRef.jsx
try { (() => {
const {
  useState
} = React;
/**
 * ClauseRef — a hoverable award-clause citation. Renders the ref in mono with a
 * dotted underline; on hover a dark tooltip explains what the clause IS and what
 * it DOES. This is the component that makes the product feel auditable: every
 * rate and loading points back to a named provision.
 *
 * Pass `parts` for multi-clause refs ("cl. 15.2 / Sch B") — each row shows the
 * clause, its title and its purpose. Or pass a single `purpose` string.
 */
function ClauseRef({
  refText,
  parts = null,
  purpose = '',
  align = 'center',
  style
}) {
  const [open, setOpen] = useState(false);
  if (!refText) return null;
  const rows = parts && parts.length ? parts : [{
    ref: refText,
    title: '',
    purpose
  }];
  const right = align === 'right';
  return /*#__PURE__*/React.createElement("span", {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    style: {
      position: 'relative',
      cursor: 'help',
      fontFamily: 'var(--font-mono)',
      borderBottom: '1px dotted rgba(31,30,27,0.35)',
      ...style
    }
  }, refText, /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: 'absolute',
      bottom: 'calc(100% + 9px)',
      left: right ? 'auto' : '50%',
      right: right ? '-6px' : 'auto',
      transform: right ? 'none' : 'translateX(-50%)',
      background: 'var(--ink)',
      color: 'var(--text-on-ink)',
      fontFamily: 'var(--font-body)',
      fontSize: 12,
      fontWeight: 400,
      lineHeight: 1.55,
      letterSpacing: 0,
      padding: '10px 13px',
      borderRadius: 'var(--radius-md)',
      width: 'max-content',
      maxWidth: 300,
      textAlign: 'left',
      whiteSpace: 'normal',
      opacity: open ? 1 : 0,
      visibility: open ? 'visible' : 'hidden',
      transition: 'opacity 0.13s ease',
      pointerEvents: 'none',
      zIndex: 60,
      boxShadow: 'var(--shadow-tip)'
    }
  }, rows.map((row, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: 'block',
      marginTop: i ? 6 : 0
    }
  }, /*#__PURE__*/React.createElement("strong", null, row.ref), row.title ? ` — ${row.title}` : ' — referenced provision of the award', row.purpose && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      color: 'rgba(245,241,234,0.72)',
      fontSize: 11.5
    }
  }, row.purpose))), /*#__PURE__*/React.createElement("span", {
    style: {
      content: '""',
      position: 'absolute',
      top: '100%',
      left: right ? '85%' : '50%',
      transform: 'translateX(-50%)',
      borderWidth: 5,
      borderStyle: 'solid',
      borderColor: 'var(--ink) transparent transparent transparent'
    }
  })));
}
Object.assign(__ds_scope, { ClauseRef });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ClauseRef.jsx", error: String((e && e.message) || e) }); }

// components/data/ResultRow.jsx
try { (() => {
const {
  useState
} = React;
const audFmt = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD'
});
const defaultFmt = v => audFmt.format(Number(v) || 0);
const GRID = '1.55fr 1fr 1fr 1.35fr 0.95fr 1.1fr 1.2fr';

/**
 * ResultRow — one employee row in the Stage-4 results table, expandable to a
 * pay breakdown of leader-dot lines. When `row.validationErrors` is non-empty
 * the row turns red and shows the error instead of a total — impossible to skim
 * past. Pass a `fmt` to override currency formatting (defaults en-AU AUD).
 */
function ResultRow({
  row,
  open: controlledOpen,
  defaultOpen = false,
  onToggle,
  fmt = defaultFmt
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isOpen = controlledOpen != null ? controlledOpen : uncontrolled;
  const toggle = () => {
    onToggle ? onToggle(!isOpen) : setUncontrolled(o => !o);
  };
  const hasError = (row.validationErrors?.length || 0) > 0;
  const errColor = hasError ? 'var(--red)' : 'var(--ink)';
  const b = row.breakdown || {};
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderBottom: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    role: "button",
    tabIndex: 0,
    "aria-expanded": isOpen,
    onClick: toggle,
    onKeyDown: e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    },
    style: {
      display: 'grid',
      gridTemplateColumns: GRID,
      alignItems: 'center',
      gap: 14,
      padding: '16px 18px',
      cursor: 'pointer',
      borderRadius: 'var(--radius-lg)',
      transition: 'background var(--dur-fast) ease'
    },
    onMouseEnter: e => {
      e.currentTarget.style.background = 'var(--hover-ink-row)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = 'transparent';
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, row.employeeName), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: hasError ? 'var(--red)' : 'var(--muted)',
      marginTop: 2
    }
  }, hasError ? 'Validation error' : `${row.totalHours} hrs · ${row.employmentType || 'Employment unavailable'}`)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 13.5,
      color: errColor
    }
  }, row.awardCode), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      color: errColor
    }
  }, row.employeeLevel), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5
    }
  }, row.jobRole), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 13.5
    }
  }, fmt(row.basePay), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontSize: 11
    }
  }, "/hr")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 13.5
    }
  }, fmt(row.extrasTotal)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 14.5,
      fontWeight: 600,
      color: hasError ? 'var(--red)' : 'var(--ink)'
    }
  }, hasError ? '—' : fmt(row.totalCalculatedPay))), isOpen && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '6px 18px 28px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--paper)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius-xl)',
      padding: 24
    }
  }, hasError && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 22
    }
  }, row.validationErrors.map(err => /*#__PURE__*/React.createElement("span", {
    key: err,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 13,
      color: 'var(--red)',
      background: 'var(--red-tint)',
      border: '1px solid var(--red-ring)',
      borderRadius: 'var(--radius-md)',
      padding: '9px 13px'
    }
  }, err))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.35fr 1fr',
      gap: 30
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Label, null, "Pay breakdown"), /*#__PURE__*/React.createElement(Leader, {
    label: "Ordinary pay",
    amt: fmt(b.ordinaryPay)
  }), (b.items || []).map((it, i) => /*#__PURE__*/React.createElement(Leader, {
    key: i,
    label: it.label,
    amt: fmt(it.amount)
  })), /*#__PURE__*/React.createElement(Leader, {
    label: "Total calculated pay",
    amt: hasError ? '—' : fmt(row.totalCalculatedPay),
    total: true
  }), /*#__PURE__*/React.createElement(Leader, {
    label: "Entitled per hour, after loadings",
    amt: `${fmt(b.effectiveHourlyRate)}/hr`
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Label, null, "Match context"), /*#__PURE__*/React.createElement(Leader, {
    label: "Award code",
    amt: row.awardCode
  }), /*#__PURE__*/React.createElement(Leader, {
    label: "Employee level",
    amt: row.employeeLevel
  }), /*#__PURE__*/React.createElement(Leader, {
    label: "Job role",
    amt: row.jobRole
  }), /*#__PURE__*/React.createElement(Leader, {
    label: "Clause ref",
    amt: b.clauseRef || '—'
  }), /*#__PURE__*/React.createElement(Leader, {
    label: "Shift count",
    amt: String(row.shiftCount ?? '—')
  }))))));
}
function Label({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: 'var(--muted)',
      marginBottom: 12
    }
  }, children);
}
function Leader({
  label,
  amt,
  total = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 8,
      padding: '7px 0',
      ...(total ? {
        borderTop: '1px solid var(--line)',
        marginTop: 6,
        paddingTop: 12
      } : null)
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: total ? 14 : 13.5,
      fontWeight: total ? 600 : 400,
      color: 'var(--ink)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      borderBottom: '1px dotted rgba(31,30,27,0.3)',
      transform: 'translateY(-4px)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: total ? 14 : 13,
      fontWeight: total ? 600 : 400,
      color: 'var(--ink)'
    }
  }, amt));
}
Object.assign(__ds_scope, { ResultRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ResultRow.jsx", error: String((e && e.message) || e) }); }

// components/data/StatCard.jsx
try { (() => {
/**
 * StatCard — a labelled headline metric. Icon well tinted by `accent`, a mono
 * uppercase label, a big Fraunces value and a muted caption. Stage 4 uses four
 * across; the validation-rows card uses accent="red" so a warning count never
 * reads as decorative.
 */
function StatCard({
  icon = null,
  label,
  value,
  caption,
  accent = 'ink'
}) {
  const accentVar = {
    ink: 'var(--ink)',
    ochre: 'var(--ochre)',
    sage: 'var(--sage)',
    red: 'var(--red)'
  }[accent] || 'var(--ink)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--card)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius-2xl)',
      padding: '20px 20px 18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 'var(--radius-xs)',
      display: 'grid',
      placeItems: 'center',
      background: `color-mix(in srgb, ${accentVar} 12%, transparent)`,
      color: accentVar
    }
  }, icon), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--th-size)',
      letterSpacing: 'var(--th-tracking)',
      textTransform: 'uppercase',
      color: 'var(--muted)'
    }
  }, label)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 30,
      fontWeight: 500,
      letterSpacing: '-0.01em',
      lineHeight: 1
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      marginTop: 8
    }
  }, caption));
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Flag.jsx
try { (() => {
/**
 * Flag — an inline warning/annotation chip with a leading alert glyph.
 * Default is the warm ochre note (compliance annotation, override reason,
 * "$0 this period" entitlement); `danger` is the red validation/error variant.
 */
function Flag({
  children,
  danger = false,
  icon = null
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 13,
      borderRadius: 'var(--radius-md)',
      padding: '9px 13px',
      color: danger ? 'var(--red)' : 'var(--ochre-strong)',
      background: danger ? 'var(--red-tint)' : 'var(--ochre-tint)',
      border: '1px solid',
      borderColor: danger ? 'var(--red-ring)' : 'var(--ochre-ring)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      display: 'inline-flex',
      color: 'inherit'
    }
  }, icon || /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700
    }
  }, "!")), children);
}
Object.assign(__ds_scope, { Flag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Flag.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StepRow.jsx
try { (() => {
/**
 * StepRow — one row of the Stage-2 processing sequence. Resolves through
 * pending → active → complete, each with a one-line technical detail and a
 * mono status word (QUEUED / RUNNING / DONE). Active rows raise onto a card
 * and set the label in serif. Pass Lucide elements for the done/active glyphs.
 */
function StepRow({
  label,
  detail,
  status = 'pending',
  doneIcon = null,
  activeIcon = null,
  delay = 0
}) {
  const active = status === 'active';
  const done = status === 'done';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 16,
      padding: '18px 20px',
      border: '1px solid',
      borderColor: active ? 'var(--line)' : 'transparent',
      borderRadius: 'var(--radius-xl)',
      background: active ? 'var(--card)' : 'transparent',
      boxShadow: active ? 'var(--shadow-step)' : 'none',
      opacity: done ? 0.62 : 1,
      transition: 'all 0.3s ease',
      animation: 'ax-fadeUp 0.55s var(--ease-out) both',
      animationDelay: `${delay}ms`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 30,
      height: 30,
      borderRadius: '50%',
      flexShrink: 0,
      marginTop: 1,
      display: 'grid',
      placeItems: 'center',
      background: done ? 'var(--sage-tint)' : active ? 'var(--ochre-tint)' : 'transparent',
      border: status === 'pending' ? '1px solid var(--line)' : 'none'
    }
  }, done && (doneIcon || /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--sage)',
      fontWeight: 700,
      fontSize: 15
    }
  }, "\u2713")), active && (activeIcon || /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ochre)',
      display: 'inline-flex',
      animation: 'ax-spin 0.9s linear infinite'
    }
  }, "\u25E0")), status === 'pending' && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 9,
      height: 9,
      borderRadius: '50%',
      border: '1.5px solid rgba(31,30,27,0.28)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 16,
      fontWeight: 500,
      fontFamily: active ? 'var(--font-serif)' : 'var(--font-body)',
      color: status === 'pending' ? 'var(--muted)' : 'var(--ink)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--muted)',
      marginTop: 4,
      lineHeight: 1.5
    }
  }, detail)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '0.12em',
      color: active ? 'var(--ochre)' : 'var(--muted)',
      alignSelf: 'center'
    }
  }, done ? 'DONE' : active ? 'RUNNING' : 'QUEUED'));
}
Object.assign(__ds_scope, { StepRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StepRow.jsx", error: String((e && e.message) || e) }); }

// components/upload/UploadCard.jsx
try { (() => {
const {
  useRef,
  useState
} = React;
const fmtSize = bytes => {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * UploadCard — a numbered document intake card. Empty state shows a dashed
 * dropzone (drag-and-drop or click); filled state swaps to a sage-ringed
 * file chip with name, size and a remove control. `optional` de-emphasises
 * the card (e.g. the award upload once an industry library is preloaded).
 * Icons are passed in (Lucide elements); unicode fallbacks keep it standalone.
 */
function UploadCard({
  index,
  headerIcon = null,
  title,
  subtitle,
  accept,
  formats,
  file = null,
  optional = false,
  onFile,
  onRemove,
  uploadIcon = null,
  checkIcon = null,
  removeIcon = null
}) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const dragDepth = useRef(0);
  const stop = e => {
    e.preventDefault();
    e.stopPropagation();
  };
  const openPicker = () => inputRef.current?.click();
  const handleEnter = e => {
    stop(e);
    dragDepth.current += 1;
    setOver(true);
  };
  const handleLeave = e => {
    stop(e);
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setOver(false);
  };
  const handleDrop = e => {
    stop(e);
    dragDepth.current = 0;
    setOver(false);
    const chosen = e.dataTransfer.files?.[0];
    if (chosen) onFile?.(chosen);
  };
  const handlePick = e => {
    const chosen = e.target.files?.[0];
    if (chosen) onFile?.(chosen);
    e.target.value = '';
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--card)',
      border: '1px solid',
      borderColor: file ? 'var(--sage-ring)' : 'var(--line)',
      borderRadius: 'var(--radius-3xl)',
      padding: '26px 26px 22px',
      position: 'relative',
      overflow: 'hidden',
      opacity: optional && !file ? 0.72 : 1,
      boxShadow: file ? 'var(--shadow-ready)' : 'none',
      transition: 'border-color var(--dur-med) ease, box-shadow var(--dur-med) ease, opacity var(--dur-med) ease'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 46,
      height: 46,
      borderRadius: 'var(--radius-md)',
      background: 'var(--hover-ink)',
      border: '1px solid var(--line)',
      display: 'grid',
      placeItems: 'center',
      color: 'var(--ink)'
    }
  }, headerIcon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 20,
      fontWeight: 500,
      display: 'flex',
      alignItems: 'baseline',
      gap: 8
    }
  }, title, optional && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--muted)'
    }
  }, "optional")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--muted)',
      marginTop: 2
    }
  }, subtitle))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 26,
      color: 'rgba(31,30,27,0.18)',
      fontWeight: 500,
      lineHeight: 1
    }
  }, index)), /*#__PURE__*/React.createElement("input", {
    ref: inputRef,
    type: "file",
    accept: accept,
    onChange: handlePick,
    style: {
      display: 'none'
    },
    "aria-label": `Choose ${title} file`
  }), file ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 13,
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius-lg)',
      padding: '13px 14px',
      background: 'var(--paper)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 'var(--radius-sm)',
      background: 'var(--sage-tint)',
      border: '1px solid var(--sage-ring)',
      display: 'grid',
      placeItems: 'center',
      color: 'var(--sage)',
      flexShrink: 0
    }
  }, checkIcon || /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700
    }
  }, "\u2713")), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 500,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, file.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11.5,
      color: 'var(--muted)',
      marginTop: 2
    }
  }, fmtSize(file.size), " \xB7 ready")), /*#__PURE__*/React.createElement("button", {
    onClick: onRemove,
    "aria-label": "Remove file",
    style: {
      display: 'grid',
      placeItems: 'center',
      width: 30,
      height: 30,
      borderRadius: 'var(--radius-xs)',
      border: '1px solid var(--line)',
      background: 'transparent',
      color: 'var(--muted)',
      cursor: 'pointer',
      flexShrink: 0
    }
  }, removeIcon || /*#__PURE__*/React.createElement("span", null, "\u2715"))) : /*#__PURE__*/React.createElement("div", {
    role: "button",
    tabIndex: 0,
    onClick: openPicker,
    onKeyDown: e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPicker();
      }
    },
    onDragEnter: handleEnter,
    onDragOver: stop,
    onDragLeave: handleLeave,
    onDrop: handleDrop,
    style: {
      border: '1.5px dashed',
      borderColor: over ? 'var(--ochre)' : 'rgba(31,30,27,0.26)',
      borderStyle: over ? 'solid' : 'dashed',
      borderRadius: 'var(--radius-lg)',
      padding: '26px 18px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 10,
      textAlign: 'center',
      cursor: 'pointer',
      background: over ? 'var(--ochre-tint)' : 'rgba(20,22,28,0.02)',
      transition: 'border-color var(--dur-fast) ease, background var(--dur-fast) ease'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: over ? 'var(--ochre)' : 'var(--muted)'
    }
  }, uploadIcon || /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 22
    }
  }, "\u2912")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14.5,
      fontWeight: 500
    }
  }, over ? 'Drop to upload' : 'Choose file or drop here'), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--muted)',
      letterSpacing: '0.06em'
    }
  }, formats)));
}
Object.assign(__ds_scope, { UploadCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/upload/UploadCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/award-interpreter/App.jsx
try { (() => {
/* App — wires the five stages into an interactive click-through */
(function () {
  const {
    Background,
    Masthead,
    Footer,
    Stage1Upload,
    Stage2Processing,
    Stage3Interpretation,
    Stage4Results,
    Stage5Confirmation
  } = window.AK;
  function StageNav({
    stage,
    go
  }) {
    const items = [[1, 'Upload'], [2, 'Processing'], [3, 'Interpretation'], [4, 'Results'], [5, 'Confirmation']];
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'fixed',
        bottom: 18,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
        display: 'flex',
        gap: 4,
        padding: 5,
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 999,
        boxShadow: '0 12px 30px -14px rgba(31,30,27,0.4)'
      }
    }, items.map(([n, label]) => /*#__PURE__*/React.createElement("button", {
      key: n,
      onClick: () => go(n),
      title: label,
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        border: 'none',
        cursor: 'pointer',
        borderRadius: 999,
        padding: '7px 12px',
        background: stage === n ? 'var(--ink)' : 'transparent',
        color: stage === n ? 'var(--paper)' : 'var(--muted)',
        transition: 'all 0.15s ease'
      }
    }, String(n).padStart(2, '0'))));
  }
  function KitApp() {
    const [stage, setStage] = React.useState(1);
    const go = n => setStage(n);
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Background, null), /*#__PURE__*/React.createElement("div", {
      className: "app-shell"
    }, /*#__PURE__*/React.createElement(Masthead, {
      stage: stage
    }), stage === 1 && /*#__PURE__*/React.createElement(Stage1Upload, {
      onContinue: () => go(2)
    }), stage === 2 && /*#__PURE__*/React.createElement(Stage2Processing, {
      auto: true,
      onDone: () => go(3),
      onBack: () => go(1)
    }), stage === 3 && /*#__PURE__*/React.createElement(Stage3Interpretation, {
      onBack: () => go(1),
      onContinue: () => go(4)
    }), stage === 4 && /*#__PURE__*/React.createElement(Stage4Results, {
      onReset: () => go(1),
      onDisperse: () => go(5)
    }), stage === 5 && /*#__PURE__*/React.createElement(Stage5Confirmation, {
      onBack: () => go(4),
      onReset: () => go(1)
    }), /*#__PURE__*/React.createElement(Footer, null)), /*#__PURE__*/React.createElement(StageNav, {
      stage: stage,
      go: go
    }));
  }
  Object.assign(window.AK, {
    KitApp
  });
  const root = document.getElementById('root');
  if (root) ReactDOM.createRoot(root).render(React.createElement(KitApp));
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/award-interpreter/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/award-interpreter/Stage1Upload.jsx
try { (() => {
/* Stage 1 — Upload */
(function () {
  const {
    Icon
  } = window.AK;
  const NS = window.AxiWFMAwardInterpreterDesignSystem_c5602f || {};
  const {
    UploadCard,
    Pill,
    Badge,
    Button
  } = NS;
  const INDUSTRIES = ['Healthcare', 'Hospitality', 'Retail', 'Construction'];
  const PRELOAD = window.AK.AWARDS;
  function Stage1Upload({
    onContinue
  }) {
    const [industry, setIndustry] = React.useState('Healthcare');
    const [docs, setDocs] = React.useState({
      award: null,
      compliance: null,
      agreement: {
        name: 'agreement-healthcare.pdf',
        size: 12480
      }
    });
    const preloaded = industry === 'Healthcare';
    const ready = Boolean(docs.agreement && (docs.award || preloaded));
    const up = /*#__PURE__*/React.createElement(Icon, {
        name: "UploadCloud",
        size: 24
      }),
      ck = /*#__PURE__*/React.createElement(Icon, {
        name: "Check",
        size: 19,
        strokeWidth: 2.2
      }),
      rm = /*#__PURE__*/React.createElement(Icon, {
        name: "X",
        size: 16
      });
    const setDoc = (k, f) => setDocs(d => ({
      ...d,
      [k]: f
    }));
    return /*#__PURE__*/React.createElement("div", {
      className: "fade-up"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 36,
        maxWidth: 640
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "eyebrow",
      style: {
        marginBottom: 14
      }
    }, "01 \u2014 Upload"), /*#__PURE__*/React.createElement("h1", {
      className: "display",
      style: {
        fontSize: 'clamp(34px, 5vw, 52px)'
      }
    }, "Parse the award stack."), /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: 16,
        lineHeight: 1.6,
        color: 'var(--text-secondary)',
        marginTop: 16
      }
    }, "Select a preloaded industry award library or upload an award document, then add the employee agreement. Compliance documents are optional but will be cross-referenced into the cached backend state before the timesheet is uploaded.")), /*#__PURE__*/React.createElement("div", {
      className: "panel-inner",
      style: {
        marginBottom: 26,
        padding: '18px 20px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "panel-label",
      style: {
        marginBottom: 12
      }
    }, "Industry award library \u2014 preload instead of uploading an award"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement(Pill, {
      selected: !industry,
      onClick: () => setIndustry('')
    }, "No preload \u2014 upload award"), INDUSTRIES.map(name => /*#__PURE__*/React.createElement(Pill, {
      key: name,
      selected: industry === name,
      disabled: name !== 'Healthcare',
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "Layers",
        size: 14,
        strokeWidth: 1.7,
        color: industry === name ? 'var(--ochre)' : 'var(--muted)'
      }),
      onClick: () => setIndustry(industry === name ? '' : name)
    }, name))), preloaded && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        marginTop: 14
      }
    }, PRELOAD.map(a => /*#__PURE__*/React.createElement(Pill, {
      key: a.code,
      code: a.code,
      style: {
        fontSize: 12
      }
    }, a.title, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--muted)'
      }
    }, " \xB7 ", a.levels, " levels")))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 12
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "BadgeCheck",
      size: 15,
      strokeWidth: 1.8,
      color: "var(--sage)"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        color: 'var(--sage)',
        fontWeight: 500
      }
    }, PRELOAD.length, " awards preloaded \u2014 the award document upload is now optional")))), /*#__PURE__*/React.createElement("div", {
      className: "upload-grid"
    }, /*#__PURE__*/React.createElement(UploadCard, {
      index: "01",
      headerIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "FileText",
        size: 22
      }),
      title: "Award Document",
      optional: preloaded,
      subtitle: preloaded ? 'Merges on top of the preloaded library' : 'Rulebook or award extraction source',
      formats: "PDF \xB7 DOCX \xB7 TXT",
      file: docs.award,
      onFile: f => setDoc('award', f),
      onRemove: () => setDoc('award', null),
      uploadIcon: up,
      checkIcon: ck,
      removeIcon: rm
    }), /*#__PURE__*/React.createElement(UploadCard, {
      index: "02",
      headerIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "Scale",
        size: 22
      }),
      title: "Compliance Document",
      optional: true,
      subtitle: "Optional compliance annotations",
      formats: "PDF \xB7 DOCX \xB7 TXT",
      file: docs.compliance,
      onFile: f => setDoc('compliance', f),
      onRemove: () => setDoc('compliance', null),
      uploadIcon: up,
      checkIcon: ck,
      removeIcon: rm
    }), /*#__PURE__*/React.createElement(UploadCard, {
      index: "03",
      headerIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "FileText",
        size: 22
      }),
      title: "Employee Agreement",
      subtitle: "Profiles, roles, levels and override rates",
      formats: "PDF \xB7 DOCX \xB7 TXT",
      file: docs.agreement,
      onFile: f => setDoc('agreement', f),
      onRemove: () => setDoc('agreement', null),
      uploadIcon: up,
      checkIcon: ck,
      removeIcon: rm
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 34,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 18,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement(Badge, {
      shape: "dot",
      tone: ready ? 'sage' : 'neutral',
      ring: ready
    }, ready ? 'Ready to build the parsed cache' : 'Select an industry or upload an award, plus the employee agreement, to continue'), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      disabled: !ready,
      onClick: onContinue,
      iconRight: /*#__PURE__*/React.createElement(Icon, {
        name: "ArrowRight",
        size: 18,
        strokeWidth: 2
      })
    }, "Interpret award")));
  }
  Object.assign(window.AK, {
    Stage1Upload
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/award-interpreter/Stage1Upload.jsx", error: String((e && e.message) || e) }); }

// ui_kits/award-interpreter/Stage2Processing.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Stage 2 — Processing (with a toggleable error state) */
(function () {
  const {
    Icon,
    STEPS
  } = window.AK;
  const NS = window.AxiWFMAwardInterpreterDesignSystem_c5602f || {};
  const {
    StepRow,
    Pill,
    Flag,
    Button
  } = NS;
  function Stage2Processing({
    auto = true,
    onDone,
    onBack,
    errored = false
  }) {
    const [active, setActive] = React.useState(auto ? 0 : STEPS.length);
    React.useEffect(() => {
      if (!auto || errored) return;
      if (active >= STEPS.length) {
        const t = setTimeout(() => onDone && onDone(), 550);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setActive(a => a + 1), 720);
      return () => clearTimeout(t);
    }, [active, auto, errored]);
    const pct = Math.min(100, Math.round(active / STEPS.length * 100));
    return /*#__PURE__*/React.createElement("div", {
      className: "fade-up"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 28,
        maxWidth: 640
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "eyebrow",
      style: {
        marginBottom: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "Sparkles",
      size: 13,
      strokeWidth: 1.8
    }), " 02 \u2014 Processing"), /*#__PURE__*/React.createElement("h1", {
      className: "display",
      style: {
        fontSize: 'clamp(30px, 4.4vw, 44px)'
      }
    }, "Building the award cache\u2026")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 30
      }
    }, /*#__PURE__*/React.createElement(Pill, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "Layers",
        size: 15,
        strokeWidth: 1.7,
        color: "var(--ochre)"
      })
    }, "Healthcare library \xB7 4 awards preloaded"), /*#__PURE__*/React.createElement(Pill, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "FileText",
        size: 15,
        strokeWidth: 1.7,
        color: "var(--sage)"
      })
    }, "agreement-healthcare.pdf")), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 22
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "mono",
      style: {
        fontSize: 11,
        letterSpacing: '0.12em',
        color: 'var(--muted)'
      }
    }, "PROGRESS"), /*#__PURE__*/React.createElement("span", {
      className: "mono",
      style: {
        fontSize: 11,
        color: 'var(--ochre)'
      }
    }, errored ? '40' : pct, "%")), /*#__PURE__*/React.createElement("div", {
      style: {
        height: 4,
        background: 'rgba(31,30,27,0.08)',
        borderRadius: 3,
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: `${errored ? 40 : pct}%`,
        height: '100%',
        background: errored ? 'var(--red)' : 'var(--ochre)',
        borderRadius: 3,
        transition: 'width 0.5s var(--ease-out)'
      }
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4
      }
    }, STEPS.map((s, i) => {
      let status = i < active ? 'done' : i === active ? 'active' : 'pending';
      if (errored && i === 1) status = 'active';
      if (errored && i > 1) status = 'pending';
      return /*#__PURE__*/React.createElement(StepRow, _extends({
        key: s.label
      }, s, {
        delay: i * 90,
        status: status,
        doneIcon: /*#__PURE__*/React.createElement(Icon, {
          name: "Check",
          size: 17,
          strokeWidth: 2.4
        }),
        activeIcon: /*#__PURE__*/React.createElement(Icon, {
          name: "Loader2",
          size: 18,
          strokeWidth: 2.2,
          spin: true
        })
      }));
    })), errored && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 24
      }
    }, /*#__PURE__*/React.createElement(Flag, {
      danger: true,
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "AlertTriangle",
        size: 15,
        strokeWidth: 1.8
      })
    }, "Could not parse ", /*#__PURE__*/React.createElement("b", {
      style: {
        fontWeight: 600,
        margin: '0 4px'
      }
    }, "agreement-healthcare.pdf"), " \u2014 the file appears to be a scanned image with no extractable text layer. Re-export it as a text PDF and upload again."), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 14
      }
    }, /*#__PURE__*/React.createElement(Button, {
      onClick: onBack,
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "ArrowLeft",
        size: 15,
        strokeWidth: 1.9
      })
    }, "Back to upload"))));
  }
  Object.assign(window.AK, {
    Stage2Processing
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/award-interpreter/Stage2Processing.jsx", error: String((e && e.message) || e) }); }

// ui_kits/award-interpreter/Stage3Interpretation.jsx
try { (() => {
/* Stage 3 — Award interpretation (the distinctive screen) */
(function () {
  const {
    Icon,
    AWARDS,
    CLAUSE_ROWS,
    PURPOSES,
    money
  } = window.AK;
  const NS = window.AxiWFMAwardInterpreterDesignSystem_c5602f || {};
  const {
    AccordionHeader,
    ClauseRef,
    Pill,
    Button
  } = NS;
  const FLAT_GRID = '1.35fr 0.85fr 2.3fr 0.95fr 0.75fr';
  const CAP = 40;
  function ClauseCell({
    clause
  }) {
    if (!clause) return /*#__PURE__*/React.createElement("span", null, "\u2014");
    return /*#__PURE__*/React.createElement(ClauseRef, {
      refText: clause,
      purpose: PURPOSES[clause],
      align: "right",
      style: {
        fontSize: 11,
        color: 'var(--muted)'
      }
    });
  }
  function InterpTable({
    rows
  }) {
    const [showAll, setShowAll] = React.useState(false);
    const ordered = [...rows.filter(r => r.matched), ...rows.filter(r => !r.matched)];
    const visible = showAll ? ordered : ordered.slice(0, CAP);
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '0 6px 12px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "table-scroll"
    }, /*#__PURE__*/React.createElement("div", {
      className: "table-inner",
      style: {
        minWidth: 760
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "thead",
      style: {
        gridTemplateColumns: FLAT_GRID
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Level"), /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Category"), /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Interpretation"), /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Value / rate"), /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Clause")), visible.map((r, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "trow rowwrap",
      style: {
        gridTemplateColumns: FLAT_GRID,
        cursor: 'default',
        alignItems: 'start'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 7,
        flexWrap: 'wrap',
        minWidth: 0
      }
    }, r.matched && /*#__PURE__*/React.createElement(Icon, {
      name: "BadgeCheck",
      size: 13,
      strokeWidth: 2,
      color: "var(--sage)",
      style: {
        flexShrink: 0,
        alignSelf: 'center'
      }
    }), /*#__PURE__*/React.createElement("span", {
      className: "mono",
      style: {
        fontSize: 10.5,
        color: 'var(--muted)'
      }
    }, r.code), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        fontWeight: 500
      }
    }, r.level)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        fontWeight: 600
      }
    }, r.category, r.employment === 'casual' && /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--muted)',
        fontWeight: 400
      }
    }, " \xB7 casual")), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: 'var(--text-secondary)',
        lineHeight: 1.45
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        color: 'var(--ink)'
      }
    }, r.title), ' — ', r.plain, r.cond && /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        fontSize: 11.5,
        color: 'var(--muted)',
        marginTop: 3
      }
    }, "When: ", r.cond)), /*#__PURE__*/React.createElement("span", {
      className: "mono",
      style: {
        fontSize: 12.5,
        fontWeight: 600
      }
    }, r.value), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11.5,
        color: 'var(--muted)'
      }
    }, /*#__PURE__*/React.createElement(ClauseCell, {
      clause: r.clause
    })))))), !showAll && ordered.length > CAP && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '12px 12px 4px'
      }
    }, /*#__PURE__*/React.createElement(Button, {
      onClick: () => setShowAll(true),
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "ChevronDown",
        size: 15,
        strokeWidth: 1.9
      })
    }, "Show all ", ordered.length, " clause rows")));
  }
  function Stage3Interpretation({
    onBack,
    onContinue
  }) {
    const [open, setOpen] = React.useState('MA000034');
    return /*#__PURE__*/React.createElement("div", {
      className: "fade-up"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 26,
        maxWidth: 660
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "eyebrow",
      style: {
        marginBottom: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "Scale",
      size: 13,
      strokeWidth: 1.8
    }), " 03 \u2014 Award interpretation"), /*#__PURE__*/React.createElement("h1", {
      className: "display",
      style: {
        fontSize: 'clamp(30px, 4.4vw, 44px)'
      }
    }, "The award, read for you."), /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: 15.5,
        lineHeight: 1.6,
        color: 'var(--text-secondary)',
        marginTop: 14
      }
    }, "Deterministically \u2014 no timesheet needed. One row per clause interpretation: each classification level, every loading, penalty and allowance it grants, and the clause behind each one. Levels named in the employee agreement are marked and shown first.")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 28
      }
    }, /*#__PURE__*/React.createElement(Pill, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "Layers",
        size: 15,
        strokeWidth: 1.7,
        color: "var(--ochre)"
      })
    }, "4 awards cached"), /*#__PURE__*/React.createElement(Pill, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "BadgeCheck",
        size: 15,
        strokeWidth: 1.7,
        color: "var(--sage)"
      })
    }, "64 award levels"), /*#__PURE__*/React.createElement(Pill, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "Scale",
        size: 15,
        strokeWidth: 1.7,
        color: "var(--ink)"
      })
    }, "2 parse warnings")), AWARDS.map(a => {
      const isOpen = open === a.code;
      const rows = a.code === 'MA000034' ? CLAUSE_ROWS : CLAUSE_ROWS.slice(6);
      return /*#__PURE__*/React.createElement("div", {
        key: a.code,
        className: "emp-group",
        style: {
          marginBottom: 12
        }
      }, /*#__PURE__*/React.createElement(AccordionHeader, {
        code: a.code,
        title: a.title,
        matched: a.matched,
        open: isOpen,
        onToggle: () => setOpen(isOpen ? '' : a.code),
        meta: [`${a.levels} levels`, `${a.rows} clause rows`],
        provenance: {
          label: a.prov,
          tone: a.tone
        },
        checkIcon: /*#__PURE__*/React.createElement(Icon, {
          name: "BadgeCheck",
          size: 15,
          strokeWidth: 1.8
        }),
        chevron: /*#__PURE__*/React.createElement(Icon, {
          name: "ChevronDown",
          size: 16,
          strokeWidth: 1.8
        })
      }), isOpen && /*#__PURE__*/React.createElement(InterpTable, {
        rows: rows
      }));
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        marginTop: 20,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: 'var(--muted)',
        maxWidth: 460,
        lineHeight: 1.5
      }
    }, "Everything above is derived from the award text alone. Upload the pay-period timesheet to apply it to real shifts."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 11
      }
    }, /*#__PURE__*/React.createElement(Button, {
      onClick: onBack,
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "ArrowLeft",
        size: 15,
        strokeWidth: 1.9
      })
    }, "Back to upload"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      onClick: onContinue,
      iconRight: /*#__PURE__*/React.createElement(Icon, {
        name: "ArrowRight",
        size: 18,
        strokeWidth: 2
      })
    }, "Upload timesheet"))));
  }
  Object.assign(window.AK, {
    Stage3Interpretation
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/award-interpreter/Stage3Interpretation.jsx", error: String((e && e.message) || e) }); }

// ui_kits/award-interpreter/Stage4Results.jsx
try { (() => {
/* Stage 4 — Results */
(function () {
  const {
    Icon,
    RESULTS,
    STATS,
    money
  } = window.AK;
  const NS = window.AxiWFMAwardInterpreterDesignSystem_c5602f || {};
  const {
    StatCard,
    ResultRow,
    Button
  } = NS;
  const RESULTS_GRID = '1.55fr 1fr 1fr 1.35fr 0.95fr 1.1fr 1.2fr';
  function Stage4Results({
    onReset,
    onDisperse
  }) {
    const [openRow, setOpenRow] = React.useState('e1');
    return /*#__PURE__*/React.createElement("div", {
      className: "fade-up"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 20,
        flexWrap: 'wrap',
        marginBottom: 32
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "eyebrow",
      style: {
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--sage)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "BadgeCheck",
      size: 14,
      strokeWidth: 1.9,
      color: "var(--sage)"
    }), " Calculation complete"), /*#__PURE__*/React.createElement("h1", {
      className: "display",
      style: {
        fontSize: 'clamp(30px, 4.6vw, 46px)'
      }
    }, STATS.employees, " employees calculated")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 11
      }
    }, /*#__PURE__*/React.createElement(Button, {
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "Download",
        size: 16,
        strokeWidth: 1.9
      })
    }, "Export CSV"), /*#__PURE__*/React.createElement(Button, {
      onClick: onReset,
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "RotateCcw",
        size: 15,
        strokeWidth: 1.9
      })
    }, "New interpretation"))), /*#__PURE__*/React.createElement("div", {
      className: "stats-grid",
      style: {
        marginBottom: 36
      }
    }, /*#__PURE__*/React.createElement(StatCard, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "Clock",
        size: 16
      }),
      label: "Total hours",
      value: `${STATS.totalHours}`,
      caption: "across the uploaded timesheet",
      accent: "ink"
    }), /*#__PURE__*/React.createElement(StatCard, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "Banknote",
        size: 16
      }),
      label: "Base pay",
      value: money(STATS.totalBasePay),
      caption: "hours \xD7 matched base pay rate",
      accent: "sage"
    }), /*#__PURE__*/React.createElement(StatCard, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "Layers",
        size: 16
      }),
      label: "Extras",
      value: money(STATS.totalExtras),
      caption: "allowances and penalties",
      accent: "ochre"
    }), /*#__PURE__*/React.createElement(StatCard, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "AlertTriangle",
        size: 16
      }),
      label: "Validation rows",
      value: `${STATS.validationErrors}`,
      caption: "employees needing manual review",
      accent: "red"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 18,
        padding: '20px 4px 8px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "table-scroll"
    }, /*#__PURE__*/React.createElement("div", {
      className: "table-inner"
    }, /*#__PURE__*/React.createElement("div", {
      className: "thead",
      style: {
        gridTemplateColumns: RESULTS_GRID
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Employee Name"), /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Award Code"), /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Employee Level"), /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Job Role"), /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Base Pay"), /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Extras / Allowances"), /*#__PURE__*/React.createElement("span", {
      className: "th"
    }, "Total Calculated Pay")), /*#__PURE__*/React.createElement("div", null, RESULTS.map(row => {
      const r = {
        ...row
      };
      // fold override/malformed notes into the breakdown as flags shown in the panel
      if (row.malformed) r.validationErrors = [];
      return /*#__PURE__*/React.createElement(ResultRowExt, {
        key: row.id,
        row: row,
        open: openRow === row.id,
        onToggle: n => setOpenRow(n ? row.id : '')
      });
    }))))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginTop: 22,
        padding: '18px 22px',
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 16
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      className: "eyebrow"
    }, "Ready to disperse"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 5,
        fontSize: 14.5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600
      }
    }, STATS.employees, " employees"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--muted)'
      }
    }, " \xB7 ", money(STATS.totalCalculatedPay), " total calculated pay"))), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      onClick: onDisperse,
      iconRight: /*#__PURE__*/React.createElement(Icon, {
        name: "ArrowRight",
        size: 18,
        strokeWidth: 2
      })
    }, "Disperse pay")));
  }

  // Wrap ResultRow to surface the override / malformed note as a Flag inside the panel.
  const {
    Flag
  } = NS;
  function ResultRowExt({
    row,
    open,
    onToggle
  }) {
    const note = row.override || row.malformed;
    if (!note) return /*#__PURE__*/React.createElement(ResultRow, {
      row: row,
      open: open,
      onToggle: onToggle
    });
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'relative'
      }
    }, /*#__PURE__*/React.createElement(ResultRow, {
      row: row,
      open: open,
      onToggle: onToggle
    }), open && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '0 18px 20px',
        marginTop: -14
      }
    }, /*#__PURE__*/React.createElement(Flag, {
      danger: !!row.malformed,
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "AlertTriangle",
        size: 15,
        strokeWidth: 1.8
      })
    }, note)));
  }
  Object.assign(window.AK, {
    Stage4Results
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/award-interpreter/Stage4Results.jsx", error: String((e && e.message) || e) }); }

// ui_kits/award-interpreter/Stage5Confirmation.jsx
try { (() => {
/* Stage 5 — Confirmation (email preview → success state) */
(function () {
  const {
    Icon,
    RESULTS,
    STATS,
    money
  } = window.AK;
  const NS = window.AxiWFMAwardInterpreterDesignSystem_c5602f || {};
  const {
    StatCard,
    Button
  } = NS;
  const PAID = RESULTS.filter(r => !(r.validationErrors && r.validationErrors.length));
  function Stage5Confirmation({
    onBack,
    onReset
  }) {
    const [recipient, setRecipient] = React.useState('payroll@wharftavern.com.au');
    const [sent, setSent] = React.useState(false);
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim());
    if (sent) {
      return /*#__PURE__*/React.createElement("div", {
        className: "fade-up",
        style: {
          maxWidth: 640
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          width: 56,
          height: 56,
          borderRadius: 14,
          background: 'var(--sage-tint)',
          border: '1px solid var(--sage-ring)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--sage)',
          marginBottom: 22
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "CheckCircle2",
        size: 28,
        strokeWidth: 1.8
      })), /*#__PURE__*/React.createElement("div", {
        className: "eyebrow",
        style: {
          marginBottom: 12,
          color: 'var(--sage)'
        }
      }, "Confirmation sent"), /*#__PURE__*/React.createElement("h1", {
        className: "display",
        style: {
          fontSize: 'clamp(30px, 4.6vw, 46px)'
        }
      }, "Payroll dispersed."), /*#__PURE__*/React.createElement("p", {
        style: {
          fontSize: 16,
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          marginTop: 16
        }
      }, "A confirmation for ", money(STATS.totalCalculatedPay), " across ", STATS.employees, " employees was sent to", /*#__PURE__*/React.createElement("span", {
        className: "mono",
        style: {
          color: 'var(--ink)'
        }
      }, " ", recipient), "."), /*#__PURE__*/React.createElement("div", {
        style: {
          marginTop: 26,
          display: 'flex',
          gap: 11
        }
      }, /*#__PURE__*/React.createElement(Button, {
        onClick: onReset,
        iconLeft: /*#__PURE__*/React.createElement(Icon, {
          name: "RotateCcw",
          size: 15,
          strokeWidth: 1.9
        })
      }, "New interpretation")));
    }
    return /*#__PURE__*/React.createElement("div", {
      className: "fade-up"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 30,
        maxWidth: 640
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "eyebrow",
      style: {
        marginBottom: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--sage)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "CheckCircle2",
      size: 14,
      strokeWidth: 1.9,
      color: "var(--sage)"
    }), " 05 \u2014 Confirmation"), /*#__PURE__*/React.createElement("h1", {
      className: "display",
      style: {
        fontSize: 'clamp(30px, 4.6vw, 46px)'
      }
    }, "Pay dispersed."), /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: 16,
        lineHeight: 1.6,
        color: 'var(--text-secondary)',
        marginTop: 16
      }
    }, "Payroll has been dispersed for the period. Review the summary and send a confirmation to the payroll mailbox below.")), /*#__PURE__*/React.createElement("div", {
      className: "stats-grid",
      style: {
        gridTemplateColumns: 'repeat(3, 1fr)',
        marginBottom: 28
      }
    }, /*#__PURE__*/React.createElement(StatCard, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "Banknote",
        size: 16
      }),
      label: "Total dispersed",
      value: money(STATS.totalCalculatedPay),
      caption: "calculated pay, this pay period",
      accent: "sage"
    }), /*#__PURE__*/React.createElement(StatCard, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "BadgeCheck",
        size: 16
      }),
      label: "Employees paid",
      value: `${STATS.employees}`,
      caption: "The Wharf Tavern",
      accent: "ink"
    }), /*#__PURE__*/React.createElement(StatCard, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "CalendarClock",
        size: 16
      }),
      label: "Pay period",
      value: "Processed",
      caption: "Fortnight ending 08 Jul 2026",
      accent: "ochre"
    })), /*#__PURE__*/React.createElement("div", {
      className: "panel-inner",
      style: {
        marginBottom: 26
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "panel-label",
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "Mail",
      size: 13,
      strokeWidth: 1.9
    }), " Payroll summary \u2014 email preview"), /*#__PURE__*/React.createElement("div", {
      className: "email-preview"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600,
        marginBottom: 10
      }
    }, "Payroll dispersed \u2014 The Wharf Tavern (Fortnight ending 08 Jul 2026)"), PAID.map(r => /*#__PURE__*/React.createElement("div", {
      className: "leader",
      key: r.id
    }, /*#__PURE__*/React.createElement("span", {
      className: "leader-label"
    }, r.employeeName), /*#__PURE__*/React.createElement("span", {
      className: "leader-dots"
    }), /*#__PURE__*/React.createElement("span", {
      className: "leader-amt"
    }, money(r.totalCalculatedPay)))), /*#__PURE__*/React.createElement("div", {
      className: "leader leader-total"
    }, /*#__PURE__*/React.createElement("span", {
      className: "leader-label"
    }, "Total dispersed"), /*#__PURE__*/React.createElement("span", {
      className: "leader-dots"
    }), /*#__PURE__*/React.createElement("span", {
      className: "leader-amt"
    }, money(STATS.totalCalculatedPay)))), /*#__PURE__*/React.createElement("label", {
      style: {
        display: 'block',
        fontSize: 12.5,
        color: 'var(--muted)',
        margin: '18px 0 6px'
      }
    }, "Send confirmation to"), /*#__PURE__*/React.createElement("input", {
      type: "email",
      value: recipient,
      onChange: e => setRecipient(e.target.value),
      "aria-label": "Confirmation email recipient",
      style: {
        width: '100%',
        maxWidth: 420,
        fontFamily: 'var(--font-mono)',
        fontSize: 13.5,
        color: 'var(--ink)',
        background: 'var(--paper)',
        border: `1px solid ${valid ? 'var(--line)' : 'rgba(180,69,47,0.5)'}`,
        borderRadius: 10,
        padding: '11px 13px',
        outline: 'none'
      }
    }), !valid && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--red)',
        marginTop: 6
      }
    }, "Enter a valid email address.")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      disabled: !valid,
      onClick: () => setSent(true),
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "Send",
        size: 17,
        strokeWidth: 2
      })
    }, "Send confirmation email"), /*#__PURE__*/React.createElement(Button, {
      onClick: onBack,
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "ArrowLeft",
        size: 15,
        strokeWidth: 1.9
      })
    }, "Back to results"), /*#__PURE__*/React.createElement(Button, {
      onClick: onReset,
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "RotateCcw",
        size: 15,
        strokeWidth: 1.9
      })
    }, "New interpretation")));
  }
  Object.assign(window.AK, {
    Stage5Confirmation
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/award-interpreter/Stage5Confirmation.jsx", error: String((e && e.message) || e) }); }

// ui_kits/award-interpreter/kit.jsx
try { (() => {
/* Shared kit module: icon helper, mock data, and the shell chrome (background,
   masthead, footer). Exports onto window.AK so sibling babel scripts can read it. */
window.AK = window.AK || {};
const L = window.lucide || {};
function Icon({
  name,
  size = 16,
  strokeWidth = 1.8,
  color = 'currentColor',
  spin = false,
  style
}) {
  const node = L[name];
  if (!node || !Array.isArray(node[2])) return null;
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: {
      ...(spin ? {
        animation: 'ax-spin 0.9s linear infinite'
      } : null),
      ...style
    }
  }, node[2].map((c, i) => React.createElement(c[0], {
    key: i,
    ...c[1]
  })));
}
const audFmt = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD'
});
const money = v => audFmt.format(Number(v) || 0);

/* ---- Mock data (healthcare demo pack, hand-crafted for the recreation) ---- */
const AWARDS = [{
  code: 'MA000034',
  title: 'Nurses Award 2020',
  levels: 22,
  rows: 184,
  tone: 'sage',
  prov: 'Preloaded · Healthcare',
  matched: true
}, {
  code: 'MA000018',
  title: 'Aged Care Award 2010',
  levels: 14,
  rows: 121,
  tone: 'sage',
  prov: 'Preloaded · Healthcare',
  matched: true
}, {
  code: 'MA000027',
  title: 'Health Professionals Award 2020',
  levels: 19,
  rows: 156,
  tone: 'sage',
  prov: 'Preloaded · Healthcare',
  matched: false
}, {
  code: 'MA000012',
  title: 'Pharmacy Industry Award 2020',
  levels: 9,
  rows: 78,
  tone: 'sage',
  prov: 'Preloaded · Healthcare',
  matched: false
}];

// Flat clause rows for the interpretation table (Stage 3), MA000034
const CLAUSE_ROWS = [{
  level: 'RN Level 1',
  code: 'B.1.1',
  category: 'Base rate',
  title: 'Ordinary hourly rate',
  plain: 'Registered Nurse level 1 is paid the base ordinary hourly rate for all ordinary hours.',
  value: '$38.42/hr',
  clause: 'cl. 15.2',
  matched: true
}, {
  level: 'RN Level 1',
  code: 'B.1.1',
  category: 'Casual loading',
  title: 'Casual loading',
  plain: 'Casual employees receive a 25% loading on the ordinary hourly rate in lieu of paid leave.',
  value: '+25%',
  clause: 'cl. 12.3',
  matched: true,
  employment: 'casual'
}, {
  level: 'RN Level 1',
  code: 'B.1.1',
  category: 'Saturday',
  title: 'Saturday penalty',
  plain: 'Ordinary hours worked on a Saturday attract a 150% penalty of the ordinary rate.',
  value: '×1.50',
  clause: 'cl. 21.1',
  matched: true
}, {
  level: 'RN Level 1',
  code: 'B.1.1',
  category: 'Sunday',
  title: 'Sunday penalty',
  plain: 'Ordinary hours worked on a Sunday attract a 175% penalty of the ordinary rate.',
  value: '×1.75',
  clause: 'cl. 21.2',
  matched: true
}, {
  level: 'RN Level 1',
  code: 'B.1.1',
  category: 'Night',
  title: 'Night shift loading',
  plain: 'A shift finishing after midnight or starting before 6:00am attracts a 15% loading.',
  value: '+15%',
  clause: 'cl. 22.4',
  matched: true,
  cond: 'shift finishes after 00:00 or starts before 06:00'
}, {
  level: 'RN Level 1',
  code: 'B.1.1',
  category: 'Overtime',
  title: 'Overtime — first 2 hours',
  plain: 'The first two hours of overtime on a day are paid at 150% of the ordinary rate.',
  value: '×1.50',
  clause: 'cl. 23.1',
  matched: true
}, {
  level: 'EN Pay Point 1',
  code: 'B.2.1',
  category: 'Base rate',
  title: 'Ordinary hourly rate',
  plain: 'Enrolled Nurse pay point 1 is paid the base ordinary hourly rate for all ordinary hours.',
  value: '$32.18/hr',
  clause: 'cl. 15.2',
  matched: false
}, {
  level: 'EN Pay Point 1',
  code: 'B.2.1',
  category: 'Public holiday',
  title: 'Public holiday penalty',
  plain: 'Ordinary hours on a public holiday are paid at 250% of the ordinary rate.',
  value: '×2.50',
  clause: 'cl. 21.3',
  matched: false
}, {
  level: 'AIN Level 3',
  code: 'B.3.1',
  category: 'Base rate',
  title: 'Ordinary hourly rate',
  plain: 'Assistant in Nursing level 3 is paid the base ordinary hourly rate.',
  value: '$29.74/hr',
  clause: 'cl. 15.2',
  matched: false
}, {
  level: 'AIN Level 3',
  code: 'B.3.1',
  category: 'Allowance',
  title: 'Sleepover allowance',
  plain: 'A sleepover shift attracts a flat allowance per night in addition to any hours worked.',
  value: '$62.04/night',
  clause: 'cl. 24.6',
  matched: false,
  cond: 'employee sleeps over on the premises'
}];
const PURPOSES = {
  'cl. 15.2': 'sets the minimum ordinary rate for each classification level',
  'cl. 12.3': 'sets the casual loading paid instead of paid leave entitlements',
  'cl. 21.1': 'sets the Saturday penalty rate',
  'cl. 21.2': 'sets the Sunday penalty rate',
  'cl. 21.3': 'sets the public holiday penalty rate',
  'cl. 22.4': 'sets the night-shift loading',
  'cl. 23.1': 'defines when overtime starts and the overtime rate',
  'cl. 24.6': 'grants the sleepover allowance'
};
const RESULTS = [{
  id: 'e1',
  employeeName: 'Sofia Marino',
  awardCode: 'MA000034',
  employeeLevel: 'RN Level 1',
  jobRole: 'Registered Nurse',
  totalHours: 76,
  employmentType: 'Permanent part-time',
  basePay: 38.42,
  extrasTotal: 84.10,
  totalCalculatedPay: 663.60,
  shiftCount: 6,
  breakdown: {
    ordinaryPay: 579.50,
    items: [{
      label: 'Saturday penalty · 6 hrs',
      amount: 84.10
    }],
    effectiveHourlyRate: 42.18,
    clauseRef: 'cl. 15.2'
  },
  worked: ['Saturday worked · 6 hrs']
}, {
  id: 'e2',
  employeeName: "Liam O'Rourke",
  awardCode: 'MA000034',
  employeeLevel: 'RN Level 2',
  jobRole: 'Registered Nurse',
  totalHours: 80,
  employmentType: 'Full-time',
  basePay: 41.06,
  extrasTotal: 168.00,
  totalCalculatedPay: 1350.00,
  shiftCount: 8,
  breakdown: {
    ordinaryPay: 1182.00,
    items: [{
      label: 'Sunday penalty · 8 hrs',
      amount: 92.00
    }, {
      label: 'Overtime · 4 hrs',
      amount: 76.00
    }],
    effectiveHourlyRate: 43.90,
    clauseRef: 'cl. 15.2'
  },
  worked: ['Sunday worked · 8 hrs', 'Overtime worked · $76.00']
}, {
  id: 'e3',
  employeeName: 'Ruth Adebayo',
  awardCode: 'MA000018',
  employeeLevel: 'PC Level 4',
  jobRole: 'Personal care worker',
  totalHours: 72,
  employmentType: 'Permanent part-time',
  basePay: 30.12,
  extrasTotal: 0,
  totalCalculatedPay: 1116.00,
  shiftCount: 6,
  override: 'Over-award rate applied — the agreement pays $2.40/hr above the award base under a registered agreement.',
  breakdown: {
    ordinaryPay: 1116.00,
    items: [],
    effectiveHourlyRate: 32.52,
    clauseRef: 'cl. 15.2'
  },
  worked: []
}, {
  id: 'e4',
  employeeName: 'Chen Wei',
  awardCode: 'MA000018',
  employeeLevel: 'PC Level 2',
  jobRole: 'Personal care worker',
  totalHours: 40,
  employmentType: 'Casual',
  basePay: 27.44,
  extrasTotal: 4.12,
  totalCalculatedPay: 462.30,
  shiftCount: 4,
  malformed: 'Night loading parsed as ×0.15 over a 10:00–13:00 window — malformed award data, shown as-is by design.',
  breakdown: {
    ordinaryPay: 458.18,
    items: [{
      label: 'Night loading · ×0.15 (10:00–13:00)',
      amount: 4.12
    }],
    effectiveHourlyRate: 28.90,
    clauseRef: 'cl. 22.4'
  },
  worked: []
}, {
  id: 'e5',
  employeeName: 'Priya Nair',
  awardCode: 'Unmatched',
  employeeLevel: '—',
  jobRole: 'Registered Nurse',
  totalHours: 64,
  employmentType: 'Full-time',
  validationErrors: ['No award level matched. This name appears in the timesheet but not in the uploaded employee agreement — the agreement file is probably the wrong pay period.']
}];
const STATS = {
  employees: 5,
  totalHours: 332,
  totalBasePay: 3703.90,
  totalExtras: 256.22,
  totalCalculatedPay: 3591.90,
  validationErrors: 1
};
const STEPS = [{
  label: 'Hashing the document set',
  detail: 'Computing the cache fingerprint for the uploaded rule documents and preloaded award library'
}, {
  label: 'Parsing award records',
  detail: 'Extracting award code, title, levels, rates, allowances and penalties from the industry library'
}, {
  label: 'Reading employee agreements',
  detail: 'Mapping employees to award code, employee level, job role and agreement overrides'
}, {
  label: 'Cross-referencing compliance',
  detail: 'Collecting non-overriding compliance notes and mismatch warnings'
}, {
  label: 'Building the lookup cache',
  detail: 'Materialising O(1) indexes keyed by award code and employee level'
}];
function Background() {
  return /*#__PURE__*/React.createElement("div", {
    "aria-hidden": true,
    style: {
      position: 'fixed',
      inset: 0,
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-grid"
  }), /*#__PURE__*/React.createElement("div", {
    className: "blob blob-1"
  }), /*#__PURE__*/React.createElement("div", {
    className: "blob blob-2"
  }), /*#__PURE__*/React.createElement("div", {
    className: "blob blob-3"
  }));
}
function Masthead({
  stage
}) {
  const names = {
    1: 'Upload',
    2: 'Processing',
    3: 'Interpretation',
    4: 'Results',
    5: 'Confirmation'
  };
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 46
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/isoft-i.png",
    alt: "iSOFT",
    style: {
      height: 34,
      width: 'auto',
      display: 'block'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 30,
      background: 'var(--line)'
    }
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontWeight: 600,
      fontSize: 16.5,
      lineHeight: 1
    }
  }, "Axi\u2009\xB7\u2009WFM"), /*#__PURE__*/React.createElement("div", {
    className: "eyebrow",
    style: {
      marginTop: 4
    }
  }, "Award Interpreter"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 11,
      letterSpacing: '0.14em',
      color: 'var(--muted)'
    }
  }, "STAGE 0", stage, " / 05"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 4,
      height: 4,
      borderRadius: '50%',
      background: 'var(--muted)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 11,
      letterSpacing: '0.14em',
      color: 'var(--ink)'
    }
  }, names[stage].toUpperCase())));
}
function Footer() {
  return /*#__PURE__*/React.createElement("div", {
    className: "footer"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/isoft-wordmark.png",
    alt: "iSOFT",
    style: {
      height: 17,
      width: 'auto',
      display: 'block'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 11,
      letterSpacing: '0.1em',
      color: 'var(--muted)'
    }
  }, "ANZ \xB7 AWARD INTERPRETATION")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      maxWidth: 420,
      textAlign: 'right'
    }
  }, "Suggestions only. Review every classification against the current award before processing pay."));
}
Object.assign(window.AK, {
  Icon,
  money,
  AWARDS,
  CLAUSE_ROWS,
  PURPOSES,
  RESULTS,
  STATS,
  STEPS,
  Background,
  Masthead,
  Footer
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/award-interpreter/kit.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Pill = __ds_scope.Pill;

__ds_ns.AccordionHeader = __ds_scope.AccordionHeader;

__ds_ns.ClauseRef = __ds_scope.ClauseRef;

__ds_ns.ResultRow = __ds_scope.ResultRow;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.Flag = __ds_scope.Flag;

__ds_ns.StepRow = __ds_scope.StepRow;

__ds_ns.UploadCard = __ds_scope.UploadCard;

})();
