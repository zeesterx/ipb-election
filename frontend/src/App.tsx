import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { downloadBatchCodes, downloadCodes, downloadMinutesReport, request } from './api';
import { devAdmin, supabase } from './supabase';
import type { Election, NextScrutiny, Office, PublicElection, Scrutiny, Tally } from './types';

const officeName = (office: Office, plural = false) => office === 'elder'
  ? (plural ? 'presbíteros' : 'presbítero')
  : (plural ? 'diáconos' : 'diácono');
const countLabel = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
const percentageLabel = (value: number, total?: number | null) => total && total > 0
  ? `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format((value / total) * 100)}%`
  : '—';

const formatElectionDate = (value: string, options?: Intl.DateTimeFormatOptions) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Data não informada' : date.toLocaleDateString('pt-BR', options);
};

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand--compact' : ''}`}>
    <img src="/ipb-sarca.png" alt="Símbolo da Igreja Presbiteriana do Brasil" />
    <div><strong>Eleições de oficiais</strong>{!compact && <span>Igreja Presbiteriana de Lavras</span>}</div>
  </div>;
}

function useAdminAuth() {
  const [ready, setReady] = useState(devAdmin);
  const [authenticated, setAuthenticated] = useState(devAdmin);
  useEffect(() => {
    if (devAdmin) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) { setAuthenticated(Boolean(data.session)); setReady(true); }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) { setAuthenticated(Boolean(session)); setReady(true); }
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  return { ready, authenticated };
}

type ElectionSummary = Pick<PublicElection, 'status' | 'currentOffice' | 'elderSeats' | 'deaconSeats' | 'candidates' | 'scrutinies'>;
type TimelineState = 'complete' | 'current' | 'upcoming' | 'skipped';
type TimelineStep = { key: string; title: string; detail: string; state: TimelineState };

function buildElectionTimeline(election: ElectionSummary) {
  const steps: TimelineStep[] = [{
    key: 'preparation',
    title: 'Preparação da eleição',
    detail: election.status === 'draft' ? 'Quórum e credenciais em preparação' : 'Quórum confirmado e eleição aberta',
    state: election.status === 'draft' ? 'current' : 'complete'
  }];

  for (const office of ['elder', 'deacon'] as Office[]) {
    const seats = office === 'elder' ? election.elderSeats : election.deaconSeats;
    if (seats === 0) continue;
    const officeScrutinies = election.scrutinies.filter((item) => item.office === office);
    const nextRound = Math.max(0, ...officeScrutinies.map((item) => item.roundNumber)) + 1;
    const hasPending = officeScrutinies.some((item) => item.status !== 'published');
    const elected = election.candidates.filter((candidate) => candidate.office === office && candidate.elected).length;
    const officeDone = elected >= seats || officeScrutinies.some((item) => item.roundNumber === 3 && item.status === 'published') ||
      (office === 'elder' && (election.currentOffice === 'deacon' || election.scrutinies.some((item) => item.office === 'deacon'))) ||
      (office === 'deacon' && election.status === 'finished');

    for (let round = 1; round <= 3; round += 1) {
      const scrutiny = officeScrutinies.find((item) => item.roundNumber === round);
      let state: TimelineState = 'upcoming';
      let detail = 'Se necessário';
      if (scrutiny) {
        state = scrutiny.status === 'published' ? 'complete' : 'current';
        const electedHere = scrutiny.results.filter((result) => result.elected).map((result) => result.name);
        detail = scrutiny.status === 'open' ? `${countLabel(scrutiny.ballotCount, 'voto')} recebido${scrutiny.ballotCount === 1 ? '' : 's'}`
          : scrutiny.status === 'closed' ? `${countLabel(scrutiny.ballotCount, 'voto')} recebido${scrutiny.ballotCount === 1 ? '' : 's'} · em conferência`
            : electedHere.length > 0 ? `${electedHere.join(', ')} eleito(s)` : 'Resultado publicado';
      } else if (officeDone) {
        state = 'skipped'; detail = 'Não foi necessário';
      } else if (election.currentOffice === office && !hasPending && round === nextRound) {
        state = 'current'; detail = 'Aguardando abertura';
      }
      steps.push({
        key: `${office}-${round}`,
        title: `${round}º escrutínio de ${officeName(office, true)}`,
        detail,
        state
      });
    }
  }

  steps.push({
    key: 'finished',
    title: 'Eleição concluída',
    detail: election.status === 'finished' ? 'Resultado final disponível' : 'Após a conclusão das votações',
    state: election.status === 'finished' ? 'complete' : 'upcoming'
  });
  return steps;
}

function ElectionTimeline({ election, compact = false, renderStepContent }: { election: ElectionSummary; compact?: boolean; renderStepContent?: (step: TimelineStep) => ReactNode }) {
  const steps = buildElectionTimeline(election);
  const focusedKey = steps.find((step) => step.state === 'current')?.key ?? [...steps].reverse().find((step) => step.state === 'complete')?.key ?? steps[0]?.key;
  const [expandedSteps, setExpandedSteps] = useState<string[]>(() => focusedKey ? [focusedKey] : []);
  useEffect(() => { if (focusedKey) setExpandedSteps([focusedKey]); }, [focusedKey]);
  const stateLabel: Record<TimelineState, string> = { complete: 'Concluída', current: 'Etapa atual', upcoming: 'Aguardando', skipped: 'Dispensada' };

  function toggleStep(key: string) {
    if (key === focusedKey) return;
    if (compact) {
      setExpandedSteps([key]);
      return;
    }
    setExpandedSteps((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  return <section className={`panel election-timeline ${compact ? 'election-timeline--compact' : ''}`}>
    <div className="section-heading"><div><p className="eyebrow">Andamento</p><h2>Etapas da eleição</h2><p>Acompanhe o que já aconteceu e os próximos passos.</p></div></div>
    <ol>{steps.map((step) => {
      const expanded = expandedSteps.includes(step.key);
      return <li className={`timeline-step timeline-step--${step.state} ${expanded ? 'is-expanded' : ''}`} key={step.key}>
      <span className="timeline-marker" aria-hidden="true">{step.state === 'complete' ? '✓' : step.state === 'skipped' ? '—' : ''}</span>
      <div className="timeline-accordion"><button type="button" className="timeline-summary" aria-expanded={expanded} aria-controls={`timeline-${step.key}`} onClick={() => toggleStep(step.key)}>
        <span><strong>{step.title}</strong><small>{stateLabel[step.state]}</small></span><span className="timeline-chevron" aria-hidden="true">⌄</span>
      </button>
      {expanded && <div className="timeline-content" id={`timeline-${step.key}`}><div className="timeline-content-summary"><p>{step.detail}</p>{step.state === 'current' && <span className="timeline-status">Em andamento agora</span>}</div>
        {renderStepContent && <div className="timeline-step-body">{renderStepContent(step)}</div>}</div>}</div>
    </li>;
    })}</ol>
  </section>;
}

function ScrutinyResultCard({ scrutiny, presentMembers, embedded = false }: { scrutiny: Scrutiny; presentMembers?: number | null; embedded?: boolean }) {
  return <article className={`panel scrutiny-result ${embedded ? 'scrutiny-result--embedded' : ''}`}>
    <header><div><span className="result-round">{scrutiny.roundNumber}º escrutínio</span><h3>{officeName(scrutiny.office, true)}</h3></div>
      <div className="result-meta"><span><strong>{scrutiny.ballotCount} de {presentMembers ?? '—'}</strong> recebidos · {percentageLabel(scrutiny.ballotCount, presentMembers)}</span><span><strong>{scrutiny.majorityRequired}</strong> maioria</span></div></header>
    <div className="result-ranking">{scrutiny.results.map((result) => {
      const percentage = presentMembers ? Math.min(100, Math.round((result.votes / presentMembers) * 100)) : 0;
      return <div className={result.elected ? 'is-elected' : ''} key={result.candidateId}>
        <div className="result-candidate"><span>{result.name}{result.elected && <em>Eleito neste escrutínio</em>}</span><i><b style={{ width: `${percentage}%` }} /></i></div>
        <strong>{result.votes}<small> {result.votes === 1 ? 'voto' : 'votos'} · {percentageLabel(result.votes, presentMembers)}</small></strong>
      </div>;
    })}</div>
    <footer><span>{countLabel(scrutiny.blankCount, 'voto')} em branco</span><span>{countLabel(scrutiny.digitalCount, 'digital', 'digitais')} · {scrutiny.paperCount} em papel</span></footer>
  </article>;
}

function CurrentPartialResults({ election }: { election: ElectionSummary & { presentMembers?: number | null } }) {
  const deaconStageStarted = election.currentOffice === 'deacon' || election.scrutinies.some((item) => item.office === 'deacon');
  const office: Office = election.deaconSeats > 0 && (election.elderSeats === 0 || deaconStageStarted) ? 'deacon' : 'elder';
  const published = election.scrutinies
    .filter((item) => item.office === office && item.status === 'published')
    .sort((a, b) => a.roundNumber - b.roundNumber);
  const latestScrutiny = published.at(-1);
  const candidates = election.candidates.filter((candidate) => candidate.office === office).map((candidate) => {
    const latestResult = [...published].reverse()
      .flatMap((scrutiny) => scrutiny.results)
      .find((result) => result.candidateId === candidate.id);
    return { ...candidate, latestResult };
  }).sort((a, b) => {
    if (a.elected !== b.elected) return a.elected ? -1 : 1;
    const votes = (b.latestResult?.votes ?? -1) - (a.latestResult?.votes ?? -1);
    return votes || a.displayOrder - b.displayOrder;
  });

  return <section className="published-results stack">
    <div className="section-heading"><div><p className="eyebrow">Resultado parcial</p><h2>{officeName(office, true)}</h2><p>{latestScrutiny ? `Situação atual após o ${latestScrutiny.roundNumber}º escrutínio.` : 'Aguardando a publicação do primeiro resultado.'}</p></div></div>
    <article className="panel scrutiny-result current-results-card">
      <header><div><span className="result-round">Situação atual</span><h3>Classificação atual</h3></div>
        {latestScrutiny && <div className="result-meta"><span><strong>{latestScrutiny.ballotCount} de {election.presentMembers ?? '—'}</strong> recebidos · {percentageLabel(latestScrutiny.ballotCount, election.presentMembers)}</span><span><strong>{latestScrutiny.majorityRequired}</strong> maioria</span></div>}</header>
      <div className="result-ranking">{candidates.map((candidate) => {
        const votes = candidate.latestResult?.votes;
        const percentage = votes !== undefined && election.presentMembers ? Math.min(100, Math.round((votes / election.presentMembers) * 100)) : 0;
        return <div className={candidate.elected ? 'is-elected' : ''} key={candidate.id}>
          <div className="result-candidate"><span>{candidate.name}{candidate.electedRound && <em>Eleito no {candidate.electedRound}º escrutínio</em>}</span><i><b style={{ width: `${percentage}%` }} /></i></div>
          {votes === undefined ? <span className="result-awaiting">Aguardando</span> : <strong>{votes}<small> {votes === 1 ? 'voto' : 'votos'} · {percentageLabel(votes, election.presentMembers)}</small></strong>}
        </div>;
      })}</div>
      {latestScrutiny && <footer><span>Atualizado após o {latestScrutiny.roundNumber}º escrutínio</span><span>{countLabel(latestScrutiny.blankCount, 'voto')} em branco</span></footer>}
    </article>
  </section>;
}

function LiveVoteProgress({ received, expected, large = false }: { received: number; expected: number | null; large?: boolean }) {
  const percentage = expected ? Math.min(100, Math.round((received / expected) * 100)) : 0;
  return <div className={`vote-progress ${large ? 'vote-progress--large' : ''}`}>
    <div className="vote-progress-count"><strong>{received}</strong><span>de</span><strong>{expected ?? '—'}</strong></div>
    <span>{received === 1 ? 'voto recebido' : 'votos recebidos'} · {percentageLabel(received, expected)}</span>
    <div className="progress-track" aria-label={`${received} de ${expected ?? 0} votos recebidos`}><i style={{ width: `${percentage}%` }} /></div>
  </div>;
}

type Access =
  | { status: 'unavailable' }
  | { status: 'already_voted'; office: Office; roundNumber: number }
  | { status: 'ready'; accessToken: string; churchName: string; office: Office; roundNumber: number; maxMarks: number; candidates: Array<{ id: string; name: string }> };

function VoterPage() {
  const [stage, setStage] = useState<'code' | 'ballot' | 'confirm' | 'success' | 'already' | 'unavailable'>('code');
  const [code, setCode] = useState(() => localStorage.getItem('ipb-last-code') || '');
  const [access, setAccess] = useState<Extract<Access, { status: 'ready' }> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function home() {
    setStage('code'); setAccess(null); setSelected([]); setError('');
  }

  async function enter(event: FormEvent) {
    event.preventDefault();
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(normalized); localStorage.setItem('ipb-last-code', normalized);
    setBusy(true); setError('');
    try {
      const result = await request<Access>('/voter/access', { method: 'POST', body: JSON.stringify({ code: normalized }) });
      if (result.status === 'ready') { setAccess(result); setStage('ballot'); }
      else setStage(result.status === 'already_voted' ? 'already' : 'unavailable');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Senha inválida.');
    } finally { setBusy(false); }
  }

  function toggle(id: string) {
    if (!access) return;
    setError('');
    setSelected((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < access.maxMarks ? [...current, id] : current);
  }

  async function submitVote() {
    if (!access) return;
    setBusy(true); setError('');
    try {
      await request('/voter/votes', {
        method: 'POST',
        headers: { authorization: `Bearer ${access.accessToken}` },
        body: JSON.stringify({ candidateIds: selected })
      });
      setStage('success');
    } catch {
      try {
        const check = await request<Access>('/voter/access', { method: 'POST', body: JSON.stringify({ code }) });
        if (check.status === 'already_voted') setStage('success');
        else setError('Não foi possível registrar agora. Toque em confirmar novamente.');
      } catch { setError('Não foi possível registrar agora. Toque em confirmar novamente.'); }
    } finally { setBusy(false); }
  }

  const confirmation = useMemo(() => {
    if (!access) return [];
    const names = selected.map((id) => access.candidates.find((candidate) => candidate.id === id)?.name || '');
    return [...names, ...Array(access.maxMarks - selected.length).fill('Branco')];
  }, [access, selected]);
  const confirmationSentence = useMemo(() => {
    if (!access) return '';
    const blanks = access.maxMarks - selected.length;
    const candidatePart = selected.length > 0
      ? `Você está votando em ${selected.length} ${selected.length === 1 ? 'candidato' : 'candidatos'} para ${officeName(access.office)}`
      : '';
    const blankPart = blanks > 0
      ? `${selected.length > 0 ? 'e deixando' : 'Você está deixando'} ${blanks} ${blanks === 1 ? 'voto em branco' : 'votos em branco'}${selected.length === 0 ? ` para ${officeName(access.office, true)}` : ''}`
      : '';
    return `${candidatePart}${candidatePart && blankPart ? ' ' : ''}${blankPart}.`;
  }, [access, selected.length]);

  return <main className="voter-shell">
    <section className="voter-card">
      <Brand />
      {stage === 'code' && <form onSubmit={enter} className="stack">
        <header className="page-intro"><p className="eyebrow">Acesso à votação</p><h1>Digite sua senha</h1><p>Use o código de seis caracteres recebido na entrada.</p></header>
        <label className="field">Senha
          <input aria-label="Senha" className="code-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" maxLength={6} value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} autoFocus />
        </label>
        {error && <p className="message message--error" role="alert">{error}</p>}
        <button className="button button--primary" disabled={busy || code.length !== 6}>{busy ? 'Verificando…' : 'Iniciar votação'}</button>
      </form>}

      {stage === 'ballot' && access && <div className="stack">
        <header><p className="eyebrow">{access.roundNumber}º escrutínio</p><h1>Escolha {officeName(access.office, true)}</h1>
          <p>Marque até {access.maxMarks}. Você também pode escolher menos ou votar em branco.</p></header>
        <div className="choice-list">
          {access.candidates.map((candidate) => <button type="button" key={candidate.id}
            className={`candidate-choice ${selected.includes(candidate.id) ? 'is-selected' : ''}`}
            aria-pressed={selected.includes(candidate.id)} onClick={() => toggle(candidate.id)}>
            <span className="candidate-name">{candidate.name}</span><span className="check">{selected.includes(candidate.id) ? '✓' : ''}</span>
          </button>)}
        </div>
        <p className="selection-count">{selected.length} de {access.maxMarks} selecionado(s)</p>
        <button className="button button--primary" onClick={() => setStage('confirm')}>Continuar</button>
        <button className="button button--text" onClick={home}>Voltar</button>
      </div>}

      {stage === 'confirm' && access && <div className="stack">
        <header><p className="eyebrow">Confirme seu voto</p><h1>Revise antes de enviar</h1>
          <p>{confirmationSentence}</p></header>
        <ol className="confirmation-list">{confirmation.map((name, index) => <li key={`${name}-${index}`} className={name === 'Branco' ? 'blank' : ''}>{name}</li>)}</ol>
        <p className="privacy-note">Depois de confirmar, o voto não poderá ser alterado.</p>
        {error && <p className="message message--error" role="alert">{error}</p>}
        <button className="button button--primary" disabled={busy} onClick={submitVote}>{busy ? 'Computando voto…' : 'Confirmar voto'}</button>
        <button className="button button--secondary" disabled={busy} onClick={() => setStage('ballot')}>Alterar escolhas</button>
      </div>}

      {stage === 'success' && <ResultScreen icon="✓" title="Seu voto foi computado" text="Obrigado. Seu voto foi registrado com sucesso." onBack={home} />}
      {stage === 'already' && <ResultScreen icon="✓" title="Seu voto já foi computado nesta votação" text="Esta senha já participou do escrutínio aberto." onBack={home} />}
      {stage === 'unavailable' && <ResultScreen icon="—" title="Nenhuma votação disponível" text="Aguarde a mesa anunciar a abertura do próximo escrutínio." onBack={home} />}
    </section>
  </main>;
}

function ResultScreen({ icon, title, text, onBack }: { icon: string; title: string; text: string; onBack: () => void }) {
  return <div className="result-screen"><div className="result-icon">{icon}</div><h1>{title}</h1><p>{text}</p>
    <button className="button button--primary" onClick={onBack}>Voltar ao início</button></div>;
}

function AdminLogin() {
  const navigate = useNavigate(); const location = useLocation();
  const { ready, authenticated } = useAdminAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const statePath = (location.state as { from?: string } | null)?.from;
  const savedPath = typeof window !== 'undefined' ? window.sessionStorage.getItem('ipb-admin-return-to') : null;
  const returnTo = [statePath, savedPath].find((path) => path?.startsWith('/admin') && path !== '/admin/login') || '/admin';
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (loginError) setError('E-mail ou senha inválidos.');
    else { window.sessionStorage.removeItem('ipb-admin-return-to'); navigate(returnTo, { replace: true }); }
  }
  if (!ready) return <main className="center"><p>Verificando acesso…</p></main>;
  if (authenticated) return <Navigate to={returnTo} replace />;
  return <main className="admin-login"><form className="login-panel stack" onSubmit={login}><Brand />
    <header className="page-intro"><p className="eyebrow">Área restrita</p><h1>Acesso admin</h1><p>Entre com sua conta para conduzir as eleições.</p></header>
    <label className="field">E-mail<input type="email" autoComplete="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
    <label className="field">Senha<input type="password" autoComplete="current-password" placeholder="Digite sua senha" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
    {error && <p className="message message--error">{error}</p>}
    <button className="button button--primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
    <Link className="quiet-link" to="/">Voltar à votação</Link>
  </form></main>;
}

type CandidateDraft = { id: string; name: string };
const candidateDraft = (name = ''): CandidateDraft => ({ id: crypto.randomUUID(), name });

function CandidateEditor({ title, value, onChange }: { title: string; value: CandidateDraft[]; onChange: (value: CandidateDraft[]) => void }) {
  function update(id: string, changes: Partial<CandidateDraft>) {
    onChange(value.map((candidate) => candidate.id === id ? { ...candidate, ...changes } : candidate));
  }
  return <div className="candidate-editor stack">
    <div className="section-heading"><div><h3>{title}</h3><p>Informe o nome completo de cada indicado.</p></div><span className="count-badge">{value.length} indicado(s)</span></div>
    <div className="candidate-form-list">{value.map((candidate, index) => <div className="candidate-form-row" key={candidate.id}>
      <span className="candidate-index" aria-hidden="true">{index + 1}</span>
      <label className="field candidate-name-field">Nome completo
        <input aria-label={`Nome completo do indicado ${index + 1}`} value={candidate.name} onChange={(event) => update(candidate.id, { name: event.target.value })} placeholder="Nome do indicado" required />
      </label>
      <button className="icon-button icon-button--danger" type="button" aria-label={`Remover indicado ${index + 1}`} disabled={value.length === 1} onClick={() => onChange(value.filter((item) => item.id !== candidate.id))}>×</button>
    </div>)}</div>
    <button className="button button--add" type="button" onClick={() => onChange([...value, candidateDraft()])}><span>＋</span> Adicionar indicado</button>
  </div>;
}

function LockedCandidateList({ title, candidates }: { title: string; candidates: Election['candidates'] }) {
  return <div className="candidate-editor stack">
    <div className="section-heading"><div><h3>{title}</h3><p>A votação deste cargo já começou. Esta lista está preservada.</p></div><span className="count-badge">Lista bloqueada</span></div>
    <div>{candidates.map((candidate) => <div className="candidate-result-row" key={candidate.id}><span>{candidate.name}</span>{candidate.elected && <span className="elected-badge">Eleito no {candidate.electedRound}º</span>}</div>)}</div>
  </div>;
}

const prepareCandidates = (candidates: CandidateDraft[]) => candidates
  .map((candidate) => ({ name: candidate.name.trim() }))
  .filter((candidate) => candidate.name);

function CreateElection({ onCreated, onCancel }: { onCreated: (election: Election) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ churchName: '', electionDate: new Date().toISOString().slice(0, 10), elderSeats: 1, deaconSeats: 0 });
  const [elders, setElders] = useState<CandidateDraft[]>([candidateDraft()]);
  const [deacons, setDeacons] = useState<CandidateDraft[]>([candidateDraft()]);
  const [step, setStep] = useState(1);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  function nextStep() {
    setError('');
    if (step === 1) {
      if (!form.churchName.trim() || !form.electionDate) return setError('Informe a igreja e a data da eleição.');
      if (form.elderSeats === 0 && form.deaconSeats === 0) return setError('Informe pelo menos uma vaga.');
    }
    if (step === 2 && form.elderSeats > 0 && elders.filter((candidate) => candidate.name.trim()).length < form.elderSeats) {
      return setError('Cadastre ao menos tantos indicados a presbítero quanto vagas.');
    }
    setStep((current) => Math.min(3, current + 1));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (form.deaconSeats > 0 && deacons.filter((candidate) => candidate.name.trim()).length < form.deaconSeats) {
        throw new Error('Cadastre ao menos tantos indicados a diácono quanto vagas.');
      }
      const elderCandidates = form.elderSeats > 0 ? prepareCandidates(elders) : [];
      const deaconCandidates = form.deaconSeats > 0 ? prepareCandidates(deacons) : [];
      const result = await request<Election>('/admin/elections', { method: 'POST', body: JSON.stringify({
        churchName: form.churchName, electionDate: form.electionDate,
        elderSeats: Number(form.elderSeats), deaconSeats: Number(form.deaconSeats),
        elderCandidates, deaconCandidates
      }) }, true);
      onCreated(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar.'); }
    finally { setBusy(false); }
  }
  return <form className="creation-flow stack-lg" onSubmit={submit}>
    <div className="flow-steps" aria-label={`Etapa ${step} de 3`}>
      <div className={step >= 1 ? 'active' : ''}><span>1</span><small>Dados</small></div><i className={step > 1 ? 'done' : ''} />
      <div className={step >= 2 ? 'active' : ''}><span>2</span><small>Presbíteros</small></div><i className={step > 2 ? 'done' : ''} />
      <div className={step >= 3 ? 'active' : ''}><span>3</span><small>Diáconos</small></div>
    </div>
    {step === 1 && <section className="panel stack"><div className="section-heading"><div><p className="eyebrow">Etapa 1 de 3</p><h2>Informações da eleição</h2><p>Comece pelos dados gerais e pela quantidade de vagas.</p></div></div>
      <div className="form-grid"><label className="field field--wide">Nome da igreja<input value={form.churchName} onChange={(e) => setForm({ ...form, churchName: e.target.value })} placeholder="Ex.: IPB Central" required /></label>
        <label className="field">Data da eleição<input type="date" value={form.electionDate} onChange={(e) => setForm({ ...form, electionDate: e.target.value })} required /></label>
        <div />
        <label className="field">Vagas de presbíteros<input type="number" min="0" value={form.elderSeats} onChange={(e) => setForm({ ...form, elderSeats: Number(e.target.value) })} /></label>
        <label className="field">Vagas de diáconos<input type="number" min="0" value={form.deaconSeats} onChange={(e) => setForm({ ...form, deaconSeats: Number(e.target.value) })} /></label>
      </div>
    </section>}
    {step === 2 && <section className="panel stack"><div><p className="eyebrow">Etapa 2 de 3</p></div>{form.elderSeats > 0
      ? <CandidateEditor title="Indicados a presbítero" value={elders} onChange={setElders} />
      : <div className="empty-step"><h2>Sem votação para presbíteros</h2><p>Você definiu zero vagas. Esta etapa será ignorada.</p></div>}</section>}
    {step === 3 && <><section className="panel stack"><div><p className="eyebrow">Etapa 3 de 3</p></div>{form.deaconSeats > 0
      ? <CandidateEditor title="Indicados a diácono" value={deacons} onChange={setDeacons} />
      : <div className="empty-step"><h2>Sem votação para diáconos</h2><p>Você definiu zero vagas. A eleição terá apenas presbíteros.</p></div>}</section>
      <section className="review-strip"><div><strong>{form.churchName}</strong><span>{formatElectionDate(form.electionDate)}</span></div><div><strong>{form.elderSeats}</strong><span>vaga(s) de presbítero</span></div><div><strong>{form.deaconSeats}</strong><span>vaga(s) de diácono</span></div></section></>}
    {error && <p className="message message--error">{error}</p>}
    <div className="form-actions"><button type="button" className="button button--secondary" onClick={step === 1 ? onCancel : () => { setError(''); setStep((current) => current - 1); }}>{step === 1 ? 'Cancelar' : 'Voltar'}</button>
      {step < 3 ? <button key="continue" type="button" className="button button--primary" onClick={(event) => { event.preventDefault(); nextStep(); }}>Continuar</button>
        : <button key="submit" type="submit" className="button button--primary" disabled={busy}>{busy ? 'Criando eleição…' : 'Criar eleição'}</button>}</div>
  </form>;
}

function AdminDashboard() {
  const { electionId } = useParams(); const navigate = useNavigate();
  const routeElectionId = useRef(electionId); routeElectionId.current = electionId;
  const [elections, setElections] = useState<Array<Pick<Election, 'id' | 'churchName' | 'status' | 'electionDate' | 'elderSeats' | 'deaconSeats'> & { codeCount: number; electedCount: number }>>([]);
  const [selected, setSelected] = useState<Election | null>(null); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false); const [deleting, setDeleting] = useState(false);
  const currentElection = electionId && selected?.id === electionId ? selected : null;
  async function loadList() {
    try { setElections(await request('/admin/elections', {}, true)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao carregar.'); }
    finally { setLoading(false); }
  }
  async function loadDetail(id: string) {
    try {
      const election = await request<Election>(`/admin/elections/${id}`, {}, true);
      if (routeElectionId.current === id) { setSelected(election); setError(''); }
    } catch (cause) {
      if (routeElectionId.current === id) setError(cause instanceof Error ? cause.message : 'Falha ao carregar.');
    }
  }
  useEffect(() => { void loadList(); }, []);
  useEffect(() => { if (electionId) void loadDetail(electionId); else setSelected(null); }, [electionId]);
  useEffect(() => {
    if (!electionId) return;
    const update = () => { if (document.visibilityState === 'visible') void loadDetail(electionId); };
    const interval = window.setInterval(update, 5_000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', update); };
  }, [electionId]);
  async function logout() { await supabase.auth.signOut(); navigate('/admin/login'); }
  async function deleteCurrentElection() {
    if (!currentElection) return;
    setDeleting(true); setError('');
    try {
      await request(`/admin/elections/${currentElection.id}`, { method: 'DELETE' }, true);
      setElections((items) => items.filter((item) => item.id !== currentElection.id));
      setSelected(null); setConfirmDelete(false);
      navigate('/admin');
      void loadList();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível excluir a eleição.');
    } finally { setDeleting(false); }
  }

  return <div className="admin-layout"><aside className="sidebar"><Brand compact /><nav aria-label="Administração">
    <p className="sidebar-caption">Gestão</p>
    <Link className={!electionId ? 'active' : ''} to="/admin"><span className="nav-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 12h8M8 15h5" /></svg></span><span>Eleições</span></Link>
  </nav><div className="sidebar-footer"><div className="admin-identity"><span>Área segura</span><strong>Acesso admin</strong></div><button className="button button--text sidebar-exit" onClick={logout}><span aria-hidden="true">↪</span> Sair</button></div></aside>
  <main className="admin-main"><div className="admin-top"><div>{currentElection && <Link className="back-link" to="/admin">← Todas as eleições</Link>}<p className="eyebrow">Administração</p><h1>{currentElection ? currentElection.churchName : showCreate ? 'Nova eleição' : 'Eleições'}</h1>
      <p>{currentElection ? `${formatElectionDate(currentElection.electionDate, { dateStyle: 'long' })} · Acompanhe e conduza cada etapa.` : showCreate ? 'Configure as vagas e os indicados.' : 'Consulte eleições realizadas e prepare uma nova votação.'}</p></div>
    <div className="top-actions">{currentElection && <button className="button button--secondary button--danger-text" onClick={() => setConfirmDelete(true)}>Excluir eleição</button>}{!electionId && !showCreate && <button className="button button--primary" onClick={() => setShowCreate(true)}>＋ Nova eleição</button>}
      <Link className="button button--secondary" to="/">Tela de votação</Link></div></div>
    {error && <p className="message message--error">{error}</p>}
    {!electionId && showCreate && <CreateElection onCancel={() => setShowCreate(false)} onCreated={(election) => { void loadList(); setShowCreate(false); navigate(`/admin/elections/${election.id}`); }} />}
    {!electionId && !showCreate && <section>{loading ? <div className="panel empty-state"><p>Carregando eleições…</p></div> : elections.length === 0 ? <div className="panel empty-state"><div className="empty-icon">＋</div><h2>Nenhuma eleição cadastrada</h2><p>Crie a primeira eleição para cadastrar indicados e gerar as senhas.</p><button className="button button--primary" onClick={() => setShowCreate(true)}>Criar primeira eleição</button></div> : <div className="election-cards">{elections.map((item) => <Link className="election-card" key={item.id} to={`/admin/elections/${item.id}`}>
      <div className="election-card-top"><span className={`status-pill status-pill--${item.status}`}>{item.status === 'draft' ? 'Preparação' : item.status === 'open' ? 'Em andamento' : 'Concluída'}</span><span className="arrow">→</span></div>
      <h2>{item.churchName}</h2><p>{formatElectionDate(item.electionDate, { dateStyle: 'long' })}</p>
      <div className="election-card-meta"><span><strong>{item.elderSeats}</strong> presbítero(s)</span><span><strong>{item.deaconSeats}</strong> diácono(s)</span><span><strong>{item.codeCount}</strong> senhas</span></div>
    </Link>)}</div>}</section>}
    {currentElection && <ElectionControl election={currentElection} refresh={async () => { await Promise.all([loadDetail(currentElection.id), loadList()]); }} />}
    {currentElection && confirmDelete && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !deleting) setConfirmDelete(false); }}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-election-title">
        <div className="confirm-dialog-icon" aria-hidden="true">!</div><div><p className="eyebrow">Ação permanente</p><h2 id="delete-election-title">Excluir esta eleição?</h2><p>A eleição de <strong>{currentElection.churchName}</strong> e todos os candidatos, senhas, votos e resultados vinculados serão excluídos definitivamente.</p></div>
        <div className="confirm-dialog-actions"><button className="button button--secondary" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancelar</button><button className="button button--danger" disabled={deleting} onClick={() => void deleteCurrentElection()}>{deleting ? 'Excluindo…' : 'Sim, excluir eleição'}</button></div>
      </section>
    </div>}
  </main></div>;
}

function ElectionControl({ election, refresh }: { election: Election; refresh: () => Promise<void> }) {
  const [quantity, setQuantity] = useState(200); const [presence, setPresence] = useState(election.presentMembers || 0);
  const [invalidCode, setInvalidCode] = useState('');
  const [credentialAction, setCredentialAction] = useState<string | null>(null);
  const [next, setNext] = useState<NextScrutiny | null>(null); const [finalists, setFinalists] = useState<string[]>([]);
  const [tally, setTally] = useState<Tally | null>(null);
  const [paperBallotCount, setPaperBallotCount] = useState(0);
  const [paperCandidateVotes, setPaperCandidateVotes] = useState<Record<string, number>>({});
  const [winners, setWinners] = useState<string[]>([]); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [editingCandidates, setEditingCandidates] = useState(false);
  const [elderDrafts, setElderDrafts] = useState<CandidateDraft[]>(() => election.candidates.filter((candidate) => candidate.office === 'elder').map((candidate) => candidateDraft(candidate.name)));
  const [deaconDrafts, setDeaconDrafts] = useState<CandidateDraft[]>(() => election.candidates.filter((candidate) => candidate.office === 'deacon').map((candidate) => candidateDraft(candidate.name)));
  const active = election.scrutinies.find((item) => item.status === 'open');
  const closed = [...election.scrutinies].reverse().find((item) => item.status === 'closed');
  const hasStarted = election.scrutinies.length > 0;
  const elderVotingStarted = election.scrutinies.some((scrutiny) => scrutiny.office === 'elder');
  const deaconVotingStarted = election.scrutinies.some((scrutiny) => scrutiny.office === 'deacon');
  const canEditElders = election.status !== 'finished' && election.elderSeats > 0 && !elderVotingStarted;
  const canEditDeacons = election.status !== 'finished' && election.deaconSeats > 0 && !deaconVotingStarted;
  const canEditCandidates = canEditElders || canEditDeacons;

  useEffect(() => {
    setPresence(election.presentMembers || 0);
  }, [election.id, election.presentMembers]);
  useEffect(() => {
    if (editingCandidates) return;
    setElderDrafts(election.candidates.filter((candidate) => candidate.office === 'elder').map((candidate) => candidateDraft(candidate.name)));
    setDeaconDrafts(election.candidates.filter((candidate) => candidate.office === 'deacon').map((candidate) => candidateDraft(candidate.name)));
  }, [election.id, election.candidates, editingCandidates]);

  async function act(action: () => Promise<unknown>, successMessage = '') {
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(successMessage); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir.'); }
    finally { setBusy(false); }
  }
  async function credentialAct(key: string, action: () => Promise<unknown>, successMessage: string) {
    setCredentialAction(key);
    await act(action, successMessage);
    setCredentialAction(null);
  }
  useEffect(() => {
    if (election.status === 'open' && election.presentMembers && !active && !closed) {
      request<NextScrutiny>(`/admin/elections/${election.id}/next-scrutiny`, {}, true).then((value) => {
        setNext(value); setFinalists(value.defaultCandidateIds || []);
      }).catch(() => undefined);
    } else setNext(null);
  }, [election.id, election.status, election.presentMembers, election.scrutinies.length, active?.id, closed?.id]);
  useEffect(() => {
    if (closed) request<Tally>(`/admin/scrutinies/${closed.id}/tally`, {}, true).then((value) => {
      applyTally(value);
    }).catch(() => undefined); else setTally(null);
  }, [closed?.id, election.scrutinies.length]);
  useEffect(() => { if (!active) setConfirmClose(false); }, [active?.id]);

  function applyTally(value: Tally) {
    setTally(value); setWinners(value.suggestedWinnerIds);
    setPaperBallotCount(value.totals.paperCount);
    setPaperCandidateVotes(Object.fromEntries(value.candidates.map((candidate) => [candidate.id, candidate.paperVotes])));
  }

  async function closeActiveScrutiny() {
    if (!active) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<Tally>(`/admin/scrutinies/${active.id}/close`, { method: 'POST' }, true);
      applyTally(result); setConfirmClose(false);
      await refresh();
      setNotice('Votação encerrada. Confira os votos digitais e acrescente eventuais votos em papel.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível encerrar a votação.');
    } finally { setBusy(false); }
  }

  async function savePaperTotals() {
    if (!closed) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<Tally>(`/admin/scrutinies/${closed.id}/paper-totals`, {
        method: 'PUT',
        body: JSON.stringify({
          ballotCount: paperBallotCount,
          candidateVotes: tally?.candidates.map((candidate) => ({
            candidateId: candidate.id,
            votes: paperCandidateVotes[candidate.id] || 0
          })) ?? []
        })
      }, true);
      applyTally(result); await refresh();
      setNotice('Apuração dos votos em papel salva em conjunto.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar os votos em papel.');
    } finally { setBusy(false); }
  }

  async function saveCandidates() {
    const elderCandidates = prepareCandidates(elderDrafts);
    const deaconCandidates = prepareCandidates(deaconDrafts);
    if (canEditElders && elderCandidates.length < election.elderSeats) {
      setError('Cadastre ao menos tantos indicados a presbítero quanto vagas.'); return;
    }
    if (canEditDeacons && deaconCandidates.length < election.deaconSeats) {
      setError('Cadastre ao menos tantos indicados a diácono quanto vagas.'); return;
    }
    await act(async () => {
      await request(`/admin/elections/${election.id}/candidates`, {
        method: 'PUT', body: JSON.stringify({ elderCandidates, deaconCandidates })
      }, true);
      setEditingCandidates(false);
    }, 'Lista de indicados atualizada.');
  }

  function cancelCandidateEditing() {
    setElderDrafts(election.candidates.filter((candidate) => candidate.office === 'elder').map((candidate) => candidateDraft(candidate.name)));
    setDeaconDrafts(election.candidates.filter((candidate) => candidate.office === 'deacon').map((candidate) => candidateDraft(candidate.name)));
    setEditingCandidates(false); setError('');
  }

  const canEditPresence = !hasStarted && election.status !== 'finished';
  const presenceChanged = presence !== (election.presentMembers || 0);
  const activeCodes = election.batches.reduce((sum, batch) => sum + batch.activeCount, 0);
  const setupComplete = Boolean(election.presentMembers) && activeCodes > 0;
  const paperNominalTotal = tally?.candidates.reduce((sum, candidate) => sum + (paperCandidateVotes[candidate.id] || 0), 0) ?? 0;
  const paperBlankTotal = closed ? (paperBallotCount * closed.maxMarks) - paperNominalTotal : 0;
  const maxPaperBallots = Math.max(0, (election.presentMembers || 0) - (tally?.totals.digitalCount || 0));
  const paperTotalsValid = Boolean(closed && tally) && Number.isInteger(paperBallotCount) && paperBallotCount >= 0 && paperBallotCount <= maxPaperBallots &&
    tally!.candidates.every((candidate) => {
      const votes = paperCandidateVotes[candidate.id] || 0;
      return Number.isInteger(votes) && votes >= 0 && votes <= paperBallotCount;
    }) && paperBlankTotal >= 0;

  function renderAdminTimelineStep(step: TimelineStep) {
    if (step.key === 'preparation') return <div className="timeline-admin-stack">
      {!hasStarted && election.status !== 'finished' ? <section className="setup-workspace stack-lg">
        <div className="section-heading setup-heading"><div><p className="eyebrow">Preparação</p><h2>Deixe tudo pronto para a votação</h2><p>Siga os passos abaixo. A data cadastrada não limita estas ações.</p></div>
          <span className={`readiness-badge ${setupComplete ? 'is-ready' : ''}`}>{election.status === 'open' ? 'Eleição aberta' : setupComplete ? 'Pronto para abrir' : 'Preparação pendente'}</span></div>
        <div className="setup-steps" aria-label="Progresso da preparação">
          <div className={election.presentMembers ? 'is-complete' : 'is-current'}><span>{election.presentMembers ? '✓' : '1'}</span><div><strong>Definir quórum</strong><small>{election.presentMembers ? `${election.presentMembers} presentes` : 'Informe os presentes'}</small></div></div>
          <div className={activeCodes > 0 ? 'is-complete' : election.presentMembers ? 'is-current' : ''}><span>{activeCodes > 0 ? '✓' : '2'}</span><div><strong>Gerar senhas</strong><small>{activeCodes > 0 ? `${activeCodes} ativas` : 'Prepare as credenciais'}</small></div></div>
          <div className={election.status === 'open' ? 'is-complete' : setupComplete ? 'is-current' : ''}><span>{election.status === 'open' ? '✓' : '3'}</span><div><strong>Abrir eleição</strong><small>{election.status === 'open' ? 'Eleição aberta' : 'Libere quando estiver pronto'}</small></div></div>
        </div>
        <div className="admin-grid setup-grid">
          <section className="panel setup-card stack"><div className="card-title-row"><span className="step-number">1</span><div><h3>Membros presentes</h3><p>Define o valor de 50% + 1 para todos os escrutínios.</p></div></div>
            <div className="inline-form"><label className="field">Quantidade de presentes<input aria-label="Membros presentes" type="number" min="1" value={presence || ''} disabled={!canEditPresence} onChange={(event) => setPresence(Number(event.target.value))} /></label>
              <button className="button button--primary" disabled={busy || !canEditPresence || presence < 1 || !presenceChanged} onClick={() => act(() => request(`/admin/elections/${election.id}/presence`, { method: 'POST', body: JSON.stringify({ presentMembers: presence }) }, true), election.presentMembers ? 'Quórum atualizado.' : 'Quórum confirmado.')}>{election.presentMembers ? 'Salvar alteração' : 'Confirmar presentes'}</button></div>
            {presence > 0 && <div className="calculation-preview"><span>Maioria necessária</span><strong>{Math.floor(presence / 2) + 1} votos</strong></div>}
          </section>
          <section className="panel setup-card stack"><div className="card-title-row"><span className="step-number">2</span><div><h3>Senhas de votação</h3><p>Gere novos lotes quando precisar; os anteriores continuam válidos.</p></div></div>
            <div className="inline-form"><label className="field">Quantidade<input aria-label="Quantidade de senhas" type="number" min="1" max="1000" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
              <button className="button button--secondary" disabled={busy || quantity < 1 || quantity > 1000} onClick={() => void credentialAct('generate', () => downloadCodes(election.id, quantity), 'Novo lote gerado e baixado.')}>{credentialAction === 'generate' ? 'Gerando senhas…' : 'Gerar e baixar PDF'}</button></div>
            <div className="credential-summary"><strong>{activeCodes}</strong><span>senhas em {election.batches.length} lote(s)</span></div>
            {election.batches.length > 0 && <div className="batch-list">{election.batches.map((batch) => <div className="batch-row" key={batch.id}><div><strong>Lote {batch.sequenceNumber}</strong><span>{batch.quantity} senhas</span></div><div className="batch-actions"><button className="button button--text" disabled={busy} onClick={() => void credentialAct(`download-${batch.id}`, () => downloadBatchCodes(election.id, batch.id), `Lote ${batch.sequenceNumber} baixado novamente.`)}>{credentialAction === `download-${batch.id}` ? 'Baixando…' : 'Baixar novamente'}</button><button className="button button--text button--danger-text" disabled={busy || hasStarted} onClick={() => { if (window.confirm(`Excluir permanentemente o lote ${batch.sequenceNumber} e suas ${batch.quantity} senhas?`)) void credentialAct(`delete-${batch.id}`, () => request(`/admin/elections/${election.id}/codes/batches/${batch.id}`, { method: 'DELETE' }, true), `Lote ${batch.sequenceNumber} e suas senhas foram excluídos.`); }}>{credentialAction === `delete-${batch.id}` ? 'Excluindo…' : 'Excluir lote'}</button></div></div>)}</div>}
          </section>
        </div>
        {election.status === 'draft' && <section className="launch-panel"><div className="launch-icon">3</div><div><h3>Abrir a eleição</h3><p>{setupComplete ? 'Quórum e senhas estão prontos. Ao abrir, o primeiro escrutínio ficará disponível na próxima etapa.' : 'Antes de abrir, confirme o quórum e gere pelo menos um lote de senhas.'}</p></div><button className="button button--primary" disabled={busy || !setupComplete} onClick={() => act(() => request(`/admin/elections/${election.id}/open`, { method: 'POST' }, true), 'Eleição aberta. O primeiro escrutínio está pronto para ser iniciado.')}>Abrir eleição</button></section>}
      </section> : <section className="panel compact-tools"><div><p className="eyebrow">Dados confirmados</p><h3>Quórum e credenciais</h3></div><div className="compact-stats"><span><strong>{election.presentMembers}</strong> presentes</span><span><strong>{election.presentMembers ? Math.floor(election.presentMembers / 2) + 1 : '—'}</strong> maioria</span><span><strong>{activeCodes}</strong> senhas ativas</span></div>
        <details><summary>Ver lotes e gerenciar credenciais</summary><div className="tool-drawer stack">{election.status === 'open' && <><div className="inline-form"><label className="field">Gerar mais senhas<input aria-label="Quantidade de senhas" type="number" min="1" max="1000" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label><button className="button button--secondary" disabled={busy || quantity < 1 || quantity > 1000} onClick={() => void credentialAct('generate', () => downloadCodes(election.id, quantity), 'Novo lote gerado e baixado.')}>{credentialAction === 'generate' ? 'Gerando senhas…' : 'Gerar e baixar PDF'}</button></div><div className="inline-form"><label className="field">Invalidar senha para voto em papel<input aria-label="Senha para invalidar" maxLength={6} value={invalidCode} onChange={(event) => setInvalidCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} /></label><button className="button button--secondary" disabled={busy || invalidCode.length !== 6} onClick={() => act(async () => { await request(`/admin/elections/${election.id}/codes/invalidate`, { method: 'POST', body: JSON.stringify({ code: invalidCode }) }, true); setInvalidCode(''); }, 'Senha invalidada para lançamento em papel.')}>Invalidar senha</button></div></>}
          <div className="credential-summary"><strong>{activeCodes}</strong><span>senhas ativas em {election.batches.length} lote(s)</span></div>{election.batches.length > 0 ? <div className="batch-list">{election.batches.map((batch) => <div className="batch-row" key={batch.id}><div><strong>Lote {batch.sequenceNumber}</strong><span>{batch.quantity} geradas · {batch.activeCount} ativas</span></div><div className="batch-actions"><button className="button button--text" disabled={busy} onClick={() => void credentialAct(`download-${batch.id}`, () => downloadBatchCodes(election.id, batch.id), `Lote ${batch.sequenceNumber} baixado novamente.`)}>{credentialAction === `download-${batch.id}` ? 'Baixando…' : 'Baixar novamente'}</button></div></div>)}</div> : <p className="muted">Nenhum lote disponível.</p>}</div></details>
      </section>}
      <section className="panel stack candidate-management"><div className="section-heading"><div><p className="eyebrow">Candidatos</p><h2>Indicados pelo Conselho</h2><p>{election.status === 'finished' ? 'Lista utilizada na eleição.' : 'A lista de cada cargo pode ser alterada até a abertura do primeiro escrutínio daquele cargo.'}</p></div>{canEditCandidates && !editingCandidates && <button className="button button--secondary" onClick={() => setEditingCandidates(true)}>Editar indicados</button>}</div>
        {editingCandidates ? <div className="stack-lg candidate-editing">{election.elderSeats > 0 && (canEditElders ? <CandidateEditor title="Indicados a presbítero" value={elderDrafts} onChange={setElderDrafts} /> : <LockedCandidateList title="Indicados a presbítero" candidates={election.candidates.filter((candidate) => candidate.office === 'elder')} />)}{election.deaconSeats > 0 && (canEditDeacons ? <CandidateEditor title="Indicados a diácono" value={deaconDrafts} onChange={setDeaconDrafts} /> : <LockedCandidateList title="Indicados a diácono" candidates={election.candidates.filter((candidate) => candidate.office === 'deacon')} />)}<div className="form-actions"><button className="button button--secondary" disabled={busy} onClick={cancelCandidateEditing}>Cancelar</button><button className="button button--primary" disabled={busy} onClick={() => void saveCandidates()}>{busy ? 'Salvando…' : 'Salvar indicados'}</button></div></div>
          : <div className="candidate-groups">{(['elder', 'deacon'] as Office[]).map((office) => election.candidates.some((candidate) => candidate.office === office) && <div key={office}><h3>{officeName(office, true)}</h3>{election.candidates.filter((candidate) => candidate.office === office).map((candidate) => <div className="candidate-result-row" key={candidate.id}><span>{candidate.name}</span>{candidate.elected && <span className="elected-badge">Eleito no {candidate.electedRound}º</span>}</div>)}</div>)}</div>}
      </section>
    </div>;

    const scrutiny = election.scrutinies.find((item) => step.key === `${item.office}-${item.roundNumber}`);
    if (scrutiny?.status === 'published') return <ScrutinyResultCard scrutiny={scrutiny} presentMembers={election.presentMembers} embedded />;
    if (active && step.key === `${active.office}-${active.roundNumber}`) return <section className="panel live-panel timeline-action-panel"><div><p className="eyebrow live-eyebrow"><span /> Votação aberta</p><h2>{active.roundNumber}º escrutínio de {officeName(active.office, true)}</h2><p>Atualização automática a cada 5 segundos.</p></div><LiveVoteProgress received={active.ballotCount} expected={election.presentMembers} /><div className="live-actions"><button className="button button--secondary" onClick={refresh}>Atualizar agora</button><button className="button button--danger" disabled={busy} onClick={() => setConfirmClose(true)}>Encerrar votação</button></div></section>;
    if (closed && tally && step.key === `${closed.office}-${closed.roundNumber}`) return <section className="panel stack timeline-action-panel"><div><p className="eyebrow">Conferência da mesa</p><h2>Apuração do {closed.roundNumber}º escrutínio</h2></div>
      <div className="summary-metrics"><span><strong>{tally.totals.ballotCount} de {election.presentMembers ?? '—'}</strong> votos recebidos · {percentageLabel(tally.totals.ballotCount, election.presentMembers)}</span><span><strong>{tally.totals.digitalCount}</strong> digitais</span><span><strong>{tally.totals.paperCount}</strong> em papel</span><span><strong>{tally.totals.blankCount}</strong> votos brancos</span></div>
      <div className="tally-table">{tally.candidates.map((candidate) => <div key={candidate.id}><span>{candidate.name}{candidate.qualified && <small>Atingiu a maioria</small>}</span><strong>{candidate.votes}</strong></div>)}</div>
      <section className="paper-entry stack"><div className="paper-entry-heading"><div><p className="eyebrow">Votação excepcional</p><h3>Apuração conjunta dos votos em papel</h3><p>Informe uma vez o total de cédulas e quantos votos cada candidato recebeu no papel.</p></div><span>{tally.totals.ballotCount} de {election.presentMembers ?? '—'} recebidos · {percentageLabel(tally.totals.ballotCount, election.presentMembers)}</span></div><label className="field paper-total-field">Total de cédulas em papel<input aria-label="Total de cédulas em papel" type="number" min="0" max={maxPaperBallots} value={paperBallotCount} onChange={(event) => setPaperBallotCount(Number(event.target.value) || 0)} /><small>Podem ser informadas até {maxPaperBallots}, considerando os {tally.totals.digitalCount} votos digitais já recebidos.</small></label>
        <div className="paper-totals-table"><div className="paper-totals-head"><span>Candidato</span><span>Digital</span><span>Papel</span><span>Total</span></div>{tally.candidates.map((candidate) => <div className="paper-total-row" key={candidate.id}><span><strong>{candidate.name}</strong></span><span>{candidate.digitalVotes}</span><label><span className="sr-only">Votos em papel para {candidate.name}</span><input aria-label={`Votos em papel para ${candidate.name}`} type="number" min="0" max={paperBallotCount} value={paperCandidateVotes[candidate.id] || 0} onChange={(event) => setPaperCandidateVotes((current) => ({ ...current, [candidate.id]: Number(event.target.value) || 0 }))} /></label><strong>{candidate.digitalVotes + (paperCandidateVotes[candidate.id] || 0)}</strong></div>)}</div>
        <div className={`paper-calculation ${paperTotalsValid ? '' : 'is-invalid'}`}><span>Total após salvar: <strong>{tally.totals.digitalCount + paperBallotCount} de {election.presentMembers ?? '—'} recebidos · {percentageLabel(tally.totals.digitalCount + paperBallotCount, election.presentMembers)}</strong></span><span>Votos em branco calculados: <strong>{Math.max(0, paperBlankTotal)}</strong></span></div>{!paperTotalsValid && <p className="message message--error">Confira as quantidades: cada candidato pode receber no máximo {paperBallotCount} voto(s) em papel e o total recebido não pode passar de {election.presentMembers}.</p>}<div className="paper-entry-action"><p>Ao salvar, a apuração anterior em papel será substituída por estes totais.</p><button className="button button--secondary" disabled={busy || !paperTotalsValid} onClick={() => void savePaperTotals()}>{busy ? 'Salvando apuração…' : 'Salvar todos os votos em papel'}</button></div>
      </section>{tally.requiresAdminSelection && <div className="message message--warning"><strong>Defina os eleitos.</strong> Mais candidatos atingiram a maioria do que há vagas.<div className="admin-choices compact">{tally.candidates.filter((candidate) => candidate.qualified).map((candidate) => <label key={candidate.id}><input type="checkbox" checked={winners.includes(candidate.id)} onChange={() => setWinners((current) => current.includes(candidate.id) ? current.filter((id) => id !== candidate.id) : current.length < closed.seatsOpen ? [...current, candidate.id] : current)} /><span>{candidate.name}</span></label>)}</div></div>}<div className="action-footer"><p>Confira a apuração e publique para liberar a próxima etapa.</p><button className="button button--primary" disabled={busy || (tally.requiresAdminSelection && winners.length !== closed.seatsOpen)} onClick={() => act(() => request(`/admin/scrutinies/${closed.id}/publish`, { method: 'POST', body: JSON.stringify({ winnerIds: winners }) }, true), 'Resultado publicado. A próxima etapa já está disponível na timeline.')}>Aprovar e publicar resultado</button></div>
    </section>;
    if (next?.available && step.key === `${next.office}-${next.roundNumber}`) return <section className="panel stack action-panel timeline-action-panel"><div className="action-panel-heading"><div><p className="eyebrow">Próxima ação</p><h2>Abrir o {next.roundNumber}º escrutínio de {officeName(next.office!, true)}</h2><p>{next.seatsOpen} vaga(s) restante(s) · até {next.maxMarks} escolha(s) · maioria de {next.majorityRequired} votos.</p></div><span className="action-badge">Pronto para abrir</span></div>{next.roundNumber === 3 && <><p className={next.tiedAtCutoff ? 'message message--warning' : 'message'}>{next.tiedAtCutoff ? 'Há empate no corte. A mesa deve escolher os finalistas.' : 'Confira os finalistas mais votados no segundo escrutínio.'}</p><div className="admin-choices">{next.candidates?.map((candidate) => <label key={candidate.id}><input type="checkbox" checked={finalists.includes(candidate.id)} onChange={() => setFinalists((current) => current.includes(candidate.id) ? current.filter((id) => id !== candidate.id) : current.length < next.finalistLimit! ? [...current, candidate.id] : current)} /><span>{candidate.name}<small>{candidate.previousVotes} voto(s) no 2º</small></span></label>)}</div></>}<div className="action-footer"><p>Ao abrir, as senhas poderão votar imediatamente.</p><button className="button button--primary" disabled={busy || (next.roundNumber === 3 && finalists.length !== next.finalistLimit)} onClick={() => act(() => request(`/admin/elections/${election.id}/scrutinies`, { method: 'POST', body: JSON.stringify({ candidateIds: finalists }) }, true), `${next.roundNumber}º escrutínio aberto.`)}>Abrir escrutínio</button></div></section>;
    if (step.key === 'finished' && election.status === 'finished') return <section className="panel final-report timeline-action-panel"><div><p className="eyebrow">Processo concluído</p><h2>Resultado pronto para a ata</h2><p>Baixe o PDF final, sem cabeçalhos ou endereços adicionados pelo navegador.</p></div><button className="button button--secondary" disabled={busy} onClick={() => act(() => downloadMinutesReport(election.id), 'PDF do resultado gerado.')}>{busy ? 'Gerando PDF…' : 'Baixar PDF para a ata'}</button></section>;
    if (step.state === 'current') return <p className="timeline-loading">Preparando a próxima ação…</p>;
    return null;
  }
  return <div className="stack-lg">
    <section className="status-strip election-overview"><span className={`status-dot status-${election.status}`} />
      <div className="status-copy"><strong>{election.status === 'draft' ? 'Em preparação' : election.status === 'open' ? 'Eleição aberta' : 'Eleição concluída'}</strong>
        <span>{election.status === 'draft' ? 'Complete os dados necessários antes de liberar a votação.' : election.currentOffice ? `Condução da votação de ${officeName(election.currentOffice, true)}.` : 'Processo finalizado.'}</span></div>
      <div className="overview-facts"><span><strong>{election.elderSeats}</strong> presbítero(s)</span><span><strong>{election.deaconSeats}</strong> diácono(s)</span><span><strong>{activeCodes}</strong> senhas ativas</span></div>
      <Link className="button button--secondary projection-link" to={`/resultado/${election.id}`} target="_blank" rel="noreferrer">Abrir painel de projeção ↗</Link>
    </section>
    {error && <p className="message message--error">{error}</p>}
    {notice && <p className="message message--success" role="status">✓ {notice}</p>}

    <ElectionTimeline election={election} renderStepContent={renderAdminTimelineStep} />
    {active && confirmClose && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setConfirmClose(false); }}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="close-scrutiny-title">
        <div className="confirm-dialog-icon" aria-hidden="true">!</div><div><p className="eyebrow">Confirme o encerramento</p><h2 id="close-scrutiny-title">Encerrar o {active.roundNumber}º escrutínio?</h2><p>Novos votos digitais não serão mais aceitos. Em seguida, você poderá conferir a apuração e acrescentar os votos recebidos em papel.</p></div>
        <div className="confirm-dialog-actions"><button className="button button--secondary" disabled={busy} onClick={() => setConfirmClose(false)}>Continuar recebendo votos</button><button className="button button--danger" disabled={busy} onClick={() => void closeActiveScrutiny()}>{busy ? 'Encerrando…' : 'Sim, encerrar votação'}</button></div>
      </section>
    </div>}

  </div>;
}

function ProjectionPage() {
  const { electionId } = useParams();
  const [election, setElection] = useState<PublicElection | null>(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!electionId) return;
    let mounted = true;
    async function load() {
      try {
        const result = await request<PublicElection>(`/voter/elections/${electionId}/results`);
        if (mounted) { setElection(result); setLastUpdated(new Date()); setError(''); }
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o resultado.');
      }
    }
    void load();
    const interval = window.setInterval(() => void load(), 5_000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [electionId]);

  if (error && !election) return <main className="projection-shell projection-center"><Brand /><h1>Resultado indisponível</h1><p>{error}</p></main>;
  if (!election) return <main className="projection-shell projection-center"><Brand /><p>Carregando resultado da eleição…</p></main>;
  const active = election.scrutinies.find((item) => item.status === 'open');
  const closed = [...election.scrutinies].reverse().find((item) => item.status === 'closed');
  const publishedCount = election.scrutinies.filter((item) => item.status === 'published').length;

  return <main className="projection-shell">
    <header className="projection-header"><Brand compact /><div className="projection-title"><p className="eyebrow">Acompanhamento da eleição</p><h1>{election.churchName}</h1><p>{formatElectionDate(election.electionDate, { dateStyle: 'long' })}</p></div>
      <div className="projection-refresh"><span className="refresh-dot" />Atualização automática<small>{lastUpdated ? `Atualizado às ${lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</small></div></header>

    {active ? <section className="projection-live"><div><p className="eyebrow live-eyebrow"><span /> Votação em andamento</p><h2>{active.roundNumber}º escrutínio de {officeName(active.office, true)}</h2><p>A mesa receberá os votos até encerrar este escrutínio.</p></div><LiveVoteProgress received={active.ballotCount} expected={election.presentMembers} large /></section>
      : <section className={`projection-state projection-state--${election.status}`}><span>{election.status === 'finished' ? '✓' : '•'}</span><div><strong>{election.status === 'finished' ? 'Eleição concluída' : election.status === 'draft' ? 'Eleição em preparação' : closed ? 'Escrutínio em conferência' : 'Aguardando o próximo escrutínio'}</strong><small>{closed ? `${closed.ballotCount} de ${election.presentMembers ?? '—'} votos recebidos · ${percentageLabel(closed.ballotCount, election.presentMembers)} · aguardando publicação` : `${countLabel(publishedCount, 'resultado')} publicado${publishedCount === 1 ? '' : 's'} até agora`}</small></div></section>}

    <div className="projection-grid">
      <ElectionTimeline election={election} compact />
      <CurrentPartialResults election={election} />
    </div>
  </main>;
}

function AdminGate() {
  const location = useLocation();
  const [access, setAccess] = useState<'checking' | 'allowed' | 'denied'>('checking');
  useEffect(() => {
    let active = true;
    async function verify() {
      if (!devAdmin) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) { if (active) setAccess('denied'); return; }
      }
      try {
        const result = await request<{ authenticated: boolean }>('/admin/session', {}, true);
        if (active) setAccess(result.authenticated ? 'allowed' : 'denied');
      } catch { if (active) setAccess('denied'); }
    }
    void verify();
    if (devAdmin) return () => { active = false; };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && (event === 'SIGNED_OUT' || !session)) setAccess('denied');
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  if (access === 'checking') return <main className="center"><p>Verificando acesso…</p></main>;
  return access === 'allowed'
    ? <AdminDashboard />
    : <Navigate to="/admin/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
}

export default function App() {
  return <Routes><Route path="/" element={<VoterPage />} /><Route path="/admin/login" element={<AdminLogin />} />
    <Route path="/resultado/:electionId" element={<ProjectionPage />} />
    <Route path="/admin" element={<AdminGate />} /><Route path="/admin/elections/:electionId" element={<AdminGate />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
}
