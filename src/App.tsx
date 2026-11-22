import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { analyse, supertarget } from './core/analyse';
import { emptyProject } from './core/project';
import { EXAMPLES } from './examples';
import { historyReducer, initHistory } from './state/history';
import type { Action } from './state/actions';
import { APP_VERSION, LocalStore, downloadProject, readProjectFile, requestPersistence } from './state/storage';
import { DataView } from './ui/DataView';
import { ProblemTableView } from './ui/ProblemTableView';
import { CurvesView } from './ui/CurvesView';
import { TargetsView } from './ui/TargetsView';
import { NumberField } from './ui/NumberField';
import { AppMenu } from './ui/AppMenu';
import { HistoryButton } from './ui/HistoryButton';

type Tab = 'data' | 'table' | 'curves' | 'targets';
const TABS: { id: Tab; label: string }[] = [
  { id: 'data', label: 'Data' },
  { id: 'table', label: 'Problem table' },
  { id: 'curves', label: 'Curves' },
  { id: 'targets', label: 'Targets & costs' },
];

const store = new LocalStore();

export default function App() {
  const [hist, send] = useReducer(historyReducer, undefined, () => initHistory(EXAMPLES[0].build(), 'Open example'));
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('data');
  const [toast, setToast] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const project = hist.present.project;
  const dispatch = useCallback((action: Action) => send({ type: 'do', action }), []);

  // Restore the autosaved project once, then autosave on every change.
  useEffect(() => {
    store.load().then((p) => {
      if (p) send({ type: 'reset', project: p, label: 'Restore autosave' });
      setReady(true);
    });
    requestPersistence();
  }, []);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => store.save(project), 400);
    return () => clearTimeout(t);
  }, [project, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text') return; // let fields undo their own text
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        send({ type: 'undo' });
      } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault();
        send({ type: 'redo' });
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        downloadProject(project);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const analysis = useMemo(() => analyse(project), [project]);
  const deferred = useDeferredValue(project);
  const sweep = useMemo(() => (tab === 'targets' ? supertarget(deferred) : null), [deferred, tab]);
  const errors = analysis.issues.filter((i) => i.level === 'error').length;

  const openFile = async (file: File) => {
    try {
      const p = await readProjectFile(file);
      dispatch({ type: 'project/load', project: p, label: `Open ${file.name}` });
      setToast(`Opened ${file.name}`);
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  // Undoable actions, most recent first: the labels of the present entry and every past entry except the first (the starting state).
  const undoLabels = [hist.present, ...hist.past.slice(1).reverse()].slice(0, hist.past.length).map((e) => e.label);
  const redoLabels = hist.future.map((e) => e.label);

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) openFile(f);
      }}
    >
      <header className="topbar">
        <div className="brand" title="HINexT — the next HINT">
          <span className="b">HIN</span><span className="l">ex</span><span className="b">T</span>
        </div>
        <input
          className="project-name"
          aria-label="Project name"
          defaultValue={project.name}
          key={project.id + project.name}
          onBlur={(e) => e.target.value !== project.name && dispatch({ type: 'project/rename', name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <nav className="toolbar" aria-label="Project">
          <AppMenu
            onNew={() => dispatch({ type: 'project/load', project: emptyProject(), label: 'New project' })}
            onFile={() => fileInput.current?.click()}
            onSave={() => downloadProject(project)}
            onExample={(ex) => dispatch({ type: 'project/load', project: ex.build(), label: `Open example: ${ex.title}` })}
          />
          <span className="sep" />
          <HistoryButton
            kind="undo"
            labels={undoLabels}
            onOne={() => send({ type: 'undo' })}
            onMany={(count) => send({ type: 'jump', index: hist.past.length - count })}
          />
          <HistoryButton
            kind="redo"
            labels={redoLabels}
            onOne={() => send({ type: 'redo' })}
            onMany={(count) => send({ type: 'jump', index: hist.past.length + count })}
          />
          <span className="sep" />
          <select className="btn ghost" aria-label="Temperature unit" value={project.settings.units.temperature} onChange={(e) => dispatch({ type: 'settings/units', units: { temperature: e.target.value as 'C' | 'K' } })}>
            <option value="C">°C</option>
            <option value="K">K</option>
          </select>
          <select className="btn ghost" aria-label="Power unit" value={project.settings.units.power} onChange={(e) => dispatch({ type: 'settings/units', units: { power: e.target.value as 'kW' | 'MW' } })}>
            <option value="kW">kW</option>
            <option value="MW">MW</option>
          </select>
          <span className="sep" />
          <div className="dt-control">
            <span className="dt-label" aria-hidden="true">ΔT<sub>min</sub></span>
            <NumberField ariaLabel="ΔTmin" className="dt-input" value={project.settings.dtMin} onCommit={(v) => v > 0 && dispatch({ type: 'settings/dtMin', dtMin: v })} />
            <span className="unit">K</span>
          </div>
        </nav>
        <input ref={fileInput} type="file" accept=".pinch,.json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'data' && errors > 0 && <span className="count">{errors}</span>}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'data' && <DataView project={project} analysis={analysis} dispatch={dispatch} />}
        {tab === 'table' && <ProblemTableView project={project} analysis={analysis} />}
        {tab === 'curves' && <CurvesView project={project} analysis={analysis} />}
        {tab === 'targets' && <TargetsView project={project} analysis={analysis} sweep={sweep} dispatch={dispatch} />}
      </main>

      <footer className="footer">
        HINexT {APP_VERSION} · Stage 1A (targeting) · MIT licence · Projects are saved in this browser only; use Save for a .pinch file.
      </footer>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
