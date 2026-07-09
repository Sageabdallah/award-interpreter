/* App — wires the five stages into an interactive click-through */
(function () {
  const { Background, Masthead, Footer, Stage1Upload, Stage2Processing, Stage3Interpretation, Stage4Results, Stage5Confirmation } = window.AK;

  function StageNav({ stage, go }) {
    const items = [[1, 'Upload'], [2, 'Processing'], [3, 'Interpretation'], [4, 'Results'], [5, 'Confirmation']];
    return (
      <div style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 40,
        display: 'flex', gap: 4, padding: 5, background: 'var(--card)', border: '1px solid var(--line)',
        borderRadius: 999, boxShadow: '0 12px 30px -14px rgba(31,30,27,0.4)' }}>
        {items.map(([n, label]) => (
          <button key={n} onClick={() => go(n)} title={label}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase',
              border: 'none', cursor: 'pointer', borderRadius: 999, padding: '7px 12px',
              background: stage === n ? 'var(--ink)' : 'transparent', color: stage === n ? 'var(--paper)' : 'var(--muted)',
              transition: 'all 0.15s ease' }}>{String(n).padStart(2, '0')}</button>
        ))}
      </div>
    );
  }

  function KitApp() {
    const [stage, setStage] = React.useState(1);
    const go = (n) => setStage(n);
    return (
      <>
        <Background />
        <div className="app-shell">
          <Masthead stage={stage} />
          {stage === 1 && <Stage1Upload onContinue={() => go(2)} />}
          {stage === 2 && <Stage2Processing auto onDone={() => go(3)} onBack={() => go(1)} />}
          {stage === 3 && <Stage3Interpretation onBack={() => go(1)} onContinue={() => go(4)} />}
          {stage === 4 && <Stage4Results onReset={() => go(1)} onDisperse={() => go(5)} />}
          {stage === 5 && <Stage5Confirmation onBack={() => go(4)} onReset={() => go(1)} />}
          <Footer />
        </div>
        <StageNav stage={stage} go={go} />
      </>
    );
  }

  Object.assign(window.AK, { KitApp });
  const root = document.getElementById('root');
  if (root) ReactDOM.createRoot(root).render(React.createElement(KitApp));
})();
