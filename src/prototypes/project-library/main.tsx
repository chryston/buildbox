// THROWAWAY PROTOTYPE: three Project Library and recovery-flow variants, switchable with ?variant=A|B|C.
import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Variant = 'A' | 'B' | 'C'
type View = 'library' | 'migration' | 'trash'
type SaveState = 'saved' | 'saving' | 'failed'
type Modal = 'backup' | 'recovery' | 'import' | 'delete' | 'failure' | null

type Project = {
  id: string
  name: string
  address: string
  floors: number
  options: number
  savedAt: string
  backupAt: string | null
  recoveryPoints: number
  saveState: SaveState
  selected?: boolean
}

const initialProjects: Project[] = [
  { id: 'home', name: 'Tiong Bahru Home', address: '18 Yong Siak Street', floors: 2, options: 3, savedAt: '2 min ago', backupAt: null, recoveryPoints: 8, saveState: 'saved', selected: true },
  { id: 'parents', name: 'Parents’ Flat', address: '48 Marine Parade Road', floors: 1, options: 2, savedAt: 'Yesterday, 8:42 PM', backupAt: '6 days ago', recoveryPoints: 12, saveState: 'saved' },
  { id: 'studio', name: 'Studio Renovation', address: '71 Ayer Rajah Crescent', floors: 1, options: 1, savedAt: '4 days ago', backupAt: '19 days ago', recoveryPoints: 5, saveState: 'saved' },
]

const recoveryPoints = [
  { id: 'r1', time: 'Today, 10:42 AM', reason: 'Before restoring an older version', detail: '2 floors · 3 options · 14 items' },
  { id: 'r2', time: 'Today, 9:15 AM', reason: 'Automatic checkpoint', detail: '2 floors · 3 options · 12 items' },
  { id: 'r3', time: 'Yesterday, 6:30 PM', reason: 'Before importing plan image', detail: '2 floors · 2 options · 12 items' },
  { id: 'r4', time: '3 Oct, 11:20 AM', reason: 'Daily checkpoint', detail: '2 floors · 2 options · 9 items' },
]

const variantNames: Record<Variant, string> = {
  A: 'Visual library',
  B: 'Safety dashboard',
  C: 'Focused launchpad',
}

function saveLabel(project: Project) {
  if (project.saveState === 'saving') return 'Saving…'
  if (project.saveState === 'failed') return 'Save failed · changes not stored'
  return `Saved locally ${project.savedAt}`
}

function backupLabel(project: Project) {
  return project.backupAt ? `Backup download started ${project.backupAt}` : 'No backup downloaded yet'
}

function App() {
  const [variant, setVariant] = useState<Variant>(() => {
    const raw = new URLSearchParams(location.search).get('variant')?.toUpperCase()
    return raw === 'B' || raw === 'C' ? raw : 'A'
  })
  const [view, setView] = useState<View>('library')
  const [projects, setProjects] = useState(initialProjects)
  const [modal, setModal] = useState<Modal>(null)
  const [toast, setToast] = useState('')
  const [migrationTarget, setMigrationTarget] = useState('home')
  const [migrationDone, setMigrationDone] = useState(false)
  const [trash, setTrash] = useState([{ id: 'old', name: 'Old Apartment Study', deleted: '12 days ago', expires: '18 days remaining' }])
  const [selectedRecovery, setSelectedRecovery] = useState('r2')
  const [stateOpen, setStateOpen] = useState(false)

  const selected = projects.find(p => p.selected) ?? projects[0]
  const backupDue = projects.filter(p => !p.backupAt || p.backupAt.includes('19 days')).length

  function chooseVariant(next: Variant) {
    const url = new URL(location.href)
    url.searchParams.set('variant', next)
    history.replaceState({}, '', url)
    setVariant(next)
  }

  function cycle(delta: number) {
    const values: Variant[] = ['A', 'B', 'C']
    const index = values.indexOf(variant)
    chooseVariant(values[(index + delta + values.length) % values.length])
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select, [contenteditable]')) return
      if (event.key === 'ArrowLeft') cycle(-1)
      if (event.key === 'ArrowRight') cycle(1)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [variant])

  function selectProject(id: string) {
    setProjects(list => list.map(project => ({ ...project, selected: project.id === id })))
  }

  function downloadBackup() {
    setProjects(list => list.map(project => project.id === selected.id ? { ...project, backupAt: 'just now' } : project))
    setModal(null)
    setToast(`Backup download started for ${selected.name}. BuildBox cannot verify where the file is kept.`)
  }

  function simulateSave(state: SaveState) {
    setProjects(list => list.map(project => project.id === selected.id ? { ...project, saveState: state } : project))
    if (state === 'failed') setModal('failure')
    if (state === 'saving') setTimeout(() => setProjects(list => list.map(project => project.id === selected.id ? { ...project, saveState: 'saved', savedAt: 'just now' } : project)), 900)
  }

  function restorePoint() {
    setModal(null)
    setToast('Recovery Point restored. Your pre-restore state was preserved as a new Recovery Point.')
  }

  function importChoice(choice: 'replace' | 'copy') {
    setModal(null)
    setToast(choice === 'replace'
      ? 'Imported package replaced the local Project after preserving a Recovery Point.'
      : 'Imported as “Tiong Bahru Home — Copy” with new IDs.')
  }

  const actions = {
    setView, setModal, selectProject, downloadBackup, simulateSave, restorePoint, importChoice,
  }

  return (
    <div className={`prototype variant-${variant.toLowerCase()}`}>
      <PrototypeNotice />
      {variant === 'A' && <VariantA {...{ view, projects, selected, backupDue, trash, migrationTarget, setMigrationTarget, migrationDone, setMigrationDone, actions }} />}
      {variant === 'B' && <VariantB {...{ view, projects, selected, backupDue, trash, migrationTarget, setMigrationTarget, migrationDone, setMigrationDone, actions }} />}
      {variant === 'C' && <VariantC {...{ view, projects, selected, backupDue, trash, migrationTarget, setMigrationTarget, migrationDone, setMigrationDone, actions }} />}
      {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast('')}>Dismiss</button></div>}
      <ModalLayer {...{ modal, setModal, selected, selectedRecovery, setSelectedRecovery, downloadBackup, restorePoint, importChoice, simulateSave }} />
      <button className="state-toggle" onClick={() => setStateOpen(!stateOpen)}>{stateOpen ? 'Hide' : 'Show'} prototype state</button>
      {stateOpen && <pre className="state-panel">{JSON.stringify({ variant, view, selectedProject: selected.id, projects, trash, migrationTarget, migrationDone, openDialog: modal }, null, 2)}</pre>}
      <VariantSwitcher variant={variant} choose={chooseVariant} cycle={cycle} />
    </div>
  )
}

type VariantProps = {
  view: View
  projects: Project[]
  selected: Project
  backupDue: number
  trash: { id: string; name: string; deleted: string; expires: string }[]
  migrationTarget: string
  setMigrationTarget: (value: string) => void
  migrationDone: boolean
  setMigrationDone: (value: boolean) => void
  actions: {
    setView: (view: View) => void
    setModal: (modal: Modal) => void
    selectProject: (id: string) => void
    downloadBackup: () => void
    simulateSave: (state: SaveState) => void
    restorePoint: () => void
    importChoice: (choice: 'replace' | 'copy') => void
  }
}

function PrototypeNotice() {
  return <div className="prototype-notice">Throwaway prototype · no files are read, written, or deleted</div>
}

function Header({ view, setView, backupDue }: { view: View; setView: (view: View) => void; backupDue: number }) {
  return (
    <header className="app-header">
      <button className="brand" onClick={() => setView('library')}>BuildBox <span>Project Library</span></button>
      <nav>
        <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>Projects</button>
        <button className={view === 'migration' ? 'active' : ''} onClick={() => setView('migration')}>Migration review</button>
        <button className={view === 'trash' ? 'active' : ''} onClick={() => setView('trash')}>Trash</button>
      </nav>
      <div className="header-status"><span className="status-dot" /> Local only · {backupDue} backup {backupDue === 1 ? 'reminder' : 'reminders'}</div>
    </header>
  )
}

function VariantA(props: VariantProps) {
  return (
    <>
      <Header view={props.view} setView={props.actions.setView} backupDue={props.backupDue} />
      {props.view === 'library' ? (
        <main className="page visual-library">
          <section className="hero-row">
            <div><p className="eyebrow">Your properties</p><h1>Pick up where you left off</h1><p>Projects save automatically in this browser. Download backups to keep your own copies.</p></div>
            <div className="hero-actions"><button className="button secondary" onClick={() => props.actions.setModal('import')}>Restore Backup</button><button className="button primary">New Project</button></div>
          </section>
          {props.backupDue > 0 && <BackupReminder count={props.backupDue} onBackup={() => props.actions.setModal('backup')} />}
          <section className="project-grid">
            {props.projects.map(project => <ProjectCard key={project.id} project={project} onSelect={() => props.actions.selectProject(project.id)} onBackup={() => { props.actions.selectProject(project.id); props.actions.setModal('backup') }} onRecovery={() => { props.actions.selectProject(project.id); props.actions.setModal('recovery') }} onDelete={() => { props.actions.selectProject(project.id); props.actions.setModal('delete') }} />)}
            <button className="new-card"><span>＋</span><strong>New Project</strong><small>Start a property record</small></button>
          </section>
          <ScenarioControls selected={props.selected} actions={props.actions} />
        </main>
      ) : props.view === 'migration' ? <MigrationReview {...props} /> : <TrashView {...props} />}
    </>
  )
}

function VariantB(props: VariantProps) {
  return (
    <div className="dashboard-shell">
      <aside className="sidebar-nav">
        <div className="brand stacked">BuildBox<span>Local Project Manager</span></div>
        <button className={props.view === 'library' ? 'active' : ''} onClick={() => props.actions.setView('library')}>▦ Projects <b>{props.projects.length}</b></button>
        <button className={props.view === 'migration' ? 'active' : ''} onClick={() => props.actions.setView('migration')}>⇄ Migration review <b>1</b></button>
        <button className={props.view === 'trash' ? 'active' : ''} onClick={() => props.actions.setView('trash')}>⌫ Trash <b>{props.trash.length}</b></button>
        <div className="sidebar-note"><strong>Stored in this browser</strong><span>Not cloud-backed. Download a Project Backup for durable recovery.</span></div>
      </aside>
      <div className="dashboard-main">
        {props.view === 'library' ? (
          <>
            <div className="dashboard-title"><div><p className="eyebrow">Safety dashboard</p><h1>Projects</h1></div><div><button className="button secondary" onClick={() => props.actions.setModal('import')}>Restore Backup</button><button className="button primary">New Project</button></div></div>
            <div className="metrics"><article><span>Local projects</span><b>{props.projects.length}</b></article><article className="warning"><span>Need a backup</span><b>{props.backupDue}</b></article><article><span>Recovery Points</span><b>{props.projects.reduce((sum, p) => sum + p.recoveryPoints, 0)}</b></article><article><span>Storage</span><b>128 MB</b><small>Persistent storage granted</small></article></div>
            <div className="dashboard-grid">
              <section className="table-panel"><div className="panel-heading"><h2>All projects</h2><input aria-label="Search projects" placeholder="Search projects…" /></div><ProjectTable {...props} /></section>
              <aside className="attention-panel"><h2>Needs attention</h2>{props.projects.filter(p => !p.backupAt || p.backupAt.includes('19 days') || p.saveState === 'failed').map(p => <button key={p.id} onClick={() => { props.actions.selectProject(p.id); props.actions.setModal(p.saveState === 'failed' ? 'failure' : 'backup') }}><span className={p.saveState === 'failed' ? 'danger-icon' : 'warn-icon'}>{p.saveState === 'failed' ? '!' : '↓'}</span><span><strong>{p.name}</strong><small>{p.saveState === 'failed' ? 'Unsaved changes need action' : backupLabel(p)}</small></span></button>)}<button className="attention-action" onClick={() => props.actions.setView('migration')}><span className="info-icon">⇄</span><span><strong>Legacy data waiting</strong><small>Review 3 cabinets and 1 floor plan</small></span></button></aside>
            </div>
            <ScenarioControls selected={props.selected} actions={props.actions} />
          </>
        ) : props.view === 'migration' ? <MigrationReview {...props} /> : <TrashView {...props} />}
      </div>
    </div>
  )
}

function VariantC(props: VariantProps) {
  return (
    <>
      <header className="minimal-header"><div className="brand">BuildBox</div><div><button onClick={() => props.actions.setView('trash')}>Trash ({props.trash.length})</button><button className="button secondary" onClick={() => props.actions.setModal('import')}>Restore Backup</button></div></header>
      {props.view === 'library' ? (
        <main className="launchpad">
          <section className="launch-intro"><p className="eyebrow">Project Library</p><h1>What are you working on?</h1><p>Everything below is saved automatically in this browser.</p></section>
          {props.backupDue > 0 && <div className="quiet-warning"><span>◉</span><div><strong>{props.backupDue} Projects need a fresh backup</strong><p>Local saves can disappear if browser data is cleared.</p></div><button onClick={() => props.actions.setModal('backup')}>Review</button></div>}
          <div className="launch-list">{props.projects.map(project => <button key={project.id} className={`launch-row ${project.selected ? 'selected' : ''}`} onClick={() => props.actions.selectProject(project.id)}><div className="project-monogram">{project.name.split(' ').slice(0, 2).map(x => x[0]).join('')}</div><div className="launch-copy"><strong>{project.name}</strong><span>{project.address}</span></div><div className={`save-pill ${project.saveState}`}>{saveLabel(project)}</div><div className="launch-meta"><span>{project.floors} {project.floors === 1 ? 'floor' : 'floors'}</span><span>{project.options} options</span></div><span className="chevron">›</span></button>)}</div>
          <section className="selected-project-panel"><div><p className="eyebrow">Selected project</p><h2>{props.selected.name}</h2><p>{backupLabel(props.selected)} · {props.selected.recoveryPoints} Recovery Points</p></div><div><button onClick={() => props.actions.setModal('recovery')}>Recovery Points</button><button onClick={() => props.actions.setModal('backup')}>Download Backup</button><button className="button primary">Open Project</button></div></section>
          <button className="migration-link" onClick={() => props.actions.setView('migration')}>Legacy BuildBox data is ready to review <span>Review migration →</span></button>
          <ScenarioControls selected={props.selected} actions={props.actions} />
        </main>
      ) : props.view === 'migration' ? <div className="minimal-flow"><button className="back-link" onClick={() => props.actions.setView('library')}>← Projects</button><MigrationReview {...props} /></div> : <div className="minimal-flow"><button className="back-link" onClick={() => props.actions.setView('library')}>← Projects</button><TrashView {...props} /></div>}
    </>
  )
}

function BackupReminder({ count, onBackup }: { count: number; onBackup: () => void }) {
  return <div className="backup-reminder"><span className="reminder-icon">↓</span><div><strong>Keep a copy you control</strong><p>{count} {count === 1 ? 'Project has' : 'Projects have'} meaningful changes without a recent backup download. Local saves can be removed with browser data.</p></div><button onClick={onBackup}>Download Backup</button><button className="icon-button" aria-label="Dismiss backup reminder">×</button></div>
}

function ProjectCard({ project, onSelect, onBackup, onRecovery, onDelete }: { project: Project; onSelect: () => void; onBackup: () => void; onRecovery: () => void; onDelete: () => void }) {
  return <article className={`project-card ${project.selected ? 'selected' : ''}`} onClick={onSelect}><div className="plan-preview"><span>{project.floors}F</span><svg viewBox="0 0 220 110" aria-hidden="true"><path d="M15 15h80v35h45v-22h65v67h-70v-25h-45v25h-75z" /><path d="M95 15v35M140 28v42M55 15v80M15 56h40M135 70H90" /></svg></div><div className="card-body"><div className="card-title"><div><h2>{project.name}</h2><p>{project.address}</p></div><button className="icon-button" aria-label={`More actions for ${project.name}`}>•••</button></div><div className={`save-line ${project.saveState}`}><span className="status-dot" />{saveLabel(project)}</div><div className={`backup-line ${project.backupAt ? '' : 'due'}`}>{backupLabel(project)}</div><div className="card-stats"><span>{project.floors} {project.floors === 1 ? 'Floor' : 'Floors'}</span><span>{project.options} Design Options</span><span>{project.recoveryPoints} Recovery Points</span></div><div className="card-actions"><button className="button primary">Open</button><button onClick={e => { e.stopPropagation(); onBackup() }}>Backup</button><button onClick={e => { e.stopPropagation(); onRecovery() }}>Recover</button><button className="danger-text" onClick={e => { e.stopPropagation(); onDelete() }}>Delete</button></div></div></article>
}

function ProjectTable(props: VariantProps) {
  return <table><thead><tr><th>Project</th><th>Local save</th><th>Project Backup</th><th>Recovery</th><th /></tr></thead><tbody>{props.projects.map(project => <tr key={project.id} className={project.selected ? 'selected' : ''} onClick={() => props.actions.selectProject(project.id)}><td><strong>{project.name}</strong><small>{project.address}</small></td><td><span className={`save-text ${project.saveState}`}>{saveLabel(project)}</span></td><td><span className={!project.backupAt || project.backupAt.includes('19 days') ? 'warning-text' : ''}>{backupLabel(project)}</span></td><td>{project.recoveryPoints} points</td><td><button onClick={() => props.actions.setModal('backup')}>Actions</button></td></tr>)}</tbody></table>
}

function ScenarioControls({ selected, actions }: { selected: Project; actions: VariantProps['actions'] }) {
  return <section className="scenario-controls"><strong>Prototype scenarios</strong><span>Selected: {selected.name}</span><button onClick={() => actions.simulateSave('saving')}>Simulate saving</button><button onClick={() => actions.simulateSave('failed')}>Simulate save failure</button><button onClick={() => actions.setModal('import')}>Import collision</button><button onClick={() => actions.setModal('recovery')}>Restore Recovery Point</button></section>
}

function MigrationReview(props: VariantProps) {
  if (props.migrationDone) return <main className="flow-page success-page"><div className="success-mark">✓</div><p className="eyebrow">Migration verified</p><h1>Your legacy work is ready</h1><p>Three Projects and their assets were written and read back successfully. The original browser data remains available until you download a backup.</p><div className="result-list"><span>Cabinet 1 → New Project</span><span>Kitchen Renovation → New Project</span><span>Wardrobe Study → New Project</span><span>Legacy floor plan → Attached to {props.projects.find(p => p.id === props.migrationTarget)?.name}</span></div><button className="button primary" onClick={() => props.actions.setView('library')}>Return to Projects</button></main>
  return <main className="flow-page"><div className="stepper"><span className="done">1<span>Found</span></span><i /><span className="active">2<span>Review</span></span><i /><span>3<span>Verify</span></span><i /><span>4<span>Back up</span></span></div><p className="eyebrow">Legacy data migration</p><h1>Review where your existing work belongs</h1><p className="lede">BuildBox found three cabinet designs and one standalone floor plan. Cabinet designs will become separate Projects. Choose where the floor plan belongs—we will not guess.</p><section className="migration-layout"><div><h2>Projects to create</h2>{['Cabinet 1', 'Kitchen Renovation', 'Wardrobe Study'].map((name, i) => <div className="migration-item" key={name}><span className="file-icon">▤</span><div><strong>{name}</strong><small>{i + 1} cabinet Item Design · no Plan Image</small></div><span className="tag">New Project</span></div>)}</div><aside><h2>Standalone floor plan</h2><div className="floor-preview">Floor plan image<div>2400 × 1800 px · 6 placed items</div></div><label>Attach it to<select value={props.migrationTarget} onChange={e => props.setMigrationTarget(e.target.value)}>{props.projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}<option value="separate">Create a separate Project</option></select></label><p className="helper">The source data stays untouched until all new records verify successfully.</p></aside></section><div className="flow-actions"><button className="button secondary" onClick={() => props.actions.setView('library')}>Do this later</button><button className="button primary" onClick={() => props.setMigrationDone(true)}>Migrate and verify</button></div></main>
}

function TrashView(props: VariantProps) {
  return <main className="flow-page"><p className="eyebrow">Local trash</p><h1>Deleted Projects</h1><p className="lede">Projects remain recoverable for 30 days. Clearing browser data can remove trash immediately.</p>{props.trash.length === 0 ? <div className="empty-state">Trash is empty.</div> : props.trash.map(item => <div className="trash-row" key={item.id}><div className="project-monogram">OA</div><div><strong>{item.name}</strong><span>Deleted {item.deleted} · {item.expires}</span></div><button onClick={() => props.actions.setModal(null)}>Restore</button><button className="danger-text" onClick={() => props.actions.setModal('delete')}>Delete permanently</button></div>)}<button className="back-link" onClick={() => props.actions.setView('library')}>← Return to Projects</button></main>
}

function ModalLayer({ modal, setModal, selected, selectedRecovery, setSelectedRecovery, downloadBackup, restorePoint, importChoice, simulateSave }: { modal: Modal; setModal: (modal: Modal) => void; selected: Project; selectedRecovery: string; setSelectedRecovery: (id: string) => void; downloadBackup: () => void; restorePoint: () => void; importChoice: (choice: 'replace' | 'copy') => void; simulateSave: (state: SaveState) => void }) {
  if (!modal) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}><section className={`modal ${modal === 'failure' ? 'failure-modal' : ''}`} role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
    {modal === 'backup' && <><p className="eyebrow">Project Backup</p><h2>Download a complete copy?</h2><p>The `.buildbox` file contains the full property record, including Plan Images and comments. It is not encrypted.</p><div className="summary-box"><strong>{selected.name}.buildbox</strong><span>Estimated size 24.8 MB · all assets included</span></div><p className="helper">BuildBox can record that the download started, but cannot verify where you keep the file.</p><div className="modal-actions"><button onClick={() => setModal(null)}>Cancel</button><button className="button primary" onClick={downloadBackup}>Download Backup</button></div></>}
    {modal === 'recovery' && <><p className="eyebrow">Recovery Points</p><h2>Return {selected.name} to an earlier state</h2><p>Restoring creates a new current revision. Your current state is preserved first, so this action is reversible.</p><div className="recovery-list">{recoveryPoints.map(point => <label className={selectedRecovery === point.id ? 'selected' : ''} key={point.id}><input type="radio" name="recovery" value={point.id} checked={selectedRecovery === point.id} onChange={() => setSelectedRecovery(point.id)} /><span><strong>{point.time}</strong><small>{point.reason} · {point.detail}</small></span></label>)}</div><div className="modal-actions"><button onClick={() => setModal(null)}>Cancel</button><button className="button primary" onClick={restorePoint}>Restore selected point</button></div></>}
    {modal === 'import' && <><p className="eyebrow">Restore Backup</p><h2>This Project already exists here</h2><p>The backup for <strong>Tiong Bahru Home</strong> has the same Project identity as a local Project. It passed validation and migration.</p><div className="choice-grid"><button onClick={() => importChoice('replace')}><strong>Replace existing Project</strong><span>Preserve the current Project as a Recovery Point, then restore this backup with the same identity.</span></button><button onClick={() => importChoice('copy')}><strong>Import as a copy</strong><span>Create “Tiong Bahru Home — Copy” and assign new IDs to every owned record.</span></button></div><button className="full-cancel" onClick={() => setModal(null)}>Cancel—change nothing</button></>}
    {modal === 'delete' && <><p className="eyebrow danger">Permanent deletion</p><h2>Delete this Project permanently?</h2><p>This removes the Project, its Plan Images, and local Recovery Points. This cannot be undone.</p><div className="summary-box"><strong>{selected.name}</strong><span>{selected.floors} floors · {selected.options} options · {selected.recoveryPoints} Recovery Points</span></div><button className="backup-before-delete" onClick={downloadBackup}>Download Backup before deleting</button><div className="modal-actions"><button onClick={() => setModal(null)}>Cancel</button><button className="button danger-button" onClick={() => setModal(null)}>Delete permanently</button></div></>}
    {modal === 'failure' && <><div className="failure-icon">!</div><p className="eyebrow danger">Save failed</p><h2>Your latest changes are not stored</h2><p>BuildBox kept the last successful local version from <strong>10:42 AM</strong>. Do not close this tab or switch Projects until you choose an action.</p><div className="failure-reason"><strong>Browser storage is full</strong><span>Current unsaved changes are still held in memory.</span></div><div className="failure-actions"><button className="button primary" onClick={() => { simulateSave('saving'); setModal(null) }}>Retry save</button><button onClick={downloadBackup}>Download emergency backup</button><button className="danger-text" onClick={() => { simulateSave('saved'); setModal(null) }}>Discard unsaved changes</button></div></>}
  </section></div>
}

function VariantSwitcher({ variant, choose, cycle }: { variant: Variant; choose: (variant: Variant) => void; cycle: (delta: number) => void }) {
  return <div className="variant-switcher"><button aria-label="Previous variant" onClick={() => cycle(-1)}>←</button>{(['A', 'B', 'C'] as Variant[]).map(item => <button key={item} className={variant === item ? 'active' : ''} onClick={() => choose(item)}>{item}</button>)}<span>{variant} · {variantNames[variant]}</span><button aria-label="Next variant" onClick={() => cycle(1)}>→</button></div>
}

createRoot(document.getElementById('root')!).render(<App />)
