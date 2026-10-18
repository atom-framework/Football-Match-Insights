import { Activity, ArrowLeft, ArrowRight, BarChart3, CalendarDays, ChevronLeft, ChevronRight, Clock3, Database, MapPin, Search, Shield, Trophy } from 'lucide-react';
import { Link } from 'wouter';
import type { FootballMatch, ProviderStatus, RecentMatch, FootballTeamProfile } from '@workspace/api-client-react';

export function dateString(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function readableDate(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', options ?? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

export function AppShell({ children, active }: { children: React.ReactNode; active: 'matches' | 'sources' }) {
  return <div className="shell">
    <aside className="sidebar">
      <Link href="/" className="brand" data-testid="link-home">
        <span className="brand-mark">F</span><span><span className="brand-name">Football Insights</span><span className="brand-sub">Matchday control room</span></span>
      </Link>
      <nav aria-label="Main navigation">
        <div className="nav-label">Workspace</div>
        <Link href="/" className={`nav-link ${active === 'matches' ? 'active' : ''}`} data-testid="link-fixtures"><Activity size={17} /> Fixtures</Link>
        <Link href="/sources" className={`nav-link ${active === 'sources' ? 'active' : ''}`} data-testid="link-sources"><Database size={17} /> Sources & method</Link>
      </nav>
      <div className="sidebar-note"><strong>ESTIMATES, NOT CERTAINTY</strong>Every probability is a model estimate built from available data. Football keeps its surprises.</div>
    </aside>
    <main className="main">{children}</main>
  </div>;
}

export function Topline({ crumb = 'MATCHDAY / FIXTURES' }: { crumb?: string }) {
  return <div className="topline"><div className="eyebrow">{crumb}</div><div className="live-indicator"><span className="live-dot" /> Data-led. Uncertainty-aware.</div></div>;
}

export function Crest({ src, name }: { src?: string | null; name: string }) {
  return src ? <img className="crest" src={src} alt={`${name} crest`} onError={(event) => { event.currentTarget.style.display = 'none'; }} data-testid={`img-crest-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} /> : <span className="crest-fallback" aria-label={`${name} crest unavailable`}>{name.slice(0, 2).toUpperCase()}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    upcoming: 'Scheduled',
    live: 'Live',
    finished: 'Full time',
    paused: 'Paused',
    postponed: 'Postponed',
    canceled: 'Canceled',
    unknown: 'Status unconfirmed',
  };
  const label = labels[status] ?? status;
  return <span className={`status-pill ${status === 'live' || status === 'paused' ? 'live' : ''}`} data-testid={`status-match-${status}`}>{label}</span>;
}

export function ProbabilityBar({ prediction }: { prediction: FootballMatch['prediction'] }) {
  const { home, draw, away } = prediction.probabilities;
  return <div className="prob-block" data-testid="text-match-probabilities">
    <div className="prob-head"><span>MODEL ESTIMATE</span><span>{prediction.confidenceLabel} confidence</span></div>
    <div className="prob-bar" aria-label={`Home ${home}%, draw ${draw}%, away ${away}%`}><span style={{ width: `${home}%` }} /><span style={{ width: `${draw}%` }} /><span style={{ width: `${away}%` }} /></div>
    <div className="prob-labels"><span>H {home}%</span><span>D {draw}%</span><span>A {away}%</span></div>
  </div>;
}

export function FixtureCard({ match, date }: { match: FootballMatch; date: string }) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;
  return <Link href={`/match/${encodeURIComponent(match.id)}?date=${encodeURIComponent(date)}`} className="fixture" data-testid={`card-match-${match.id}`}>
    <div><div className="league-kicker">{match.league.name}</div><div className="match-time">{match.kickoffLocal || 'Kick-off time not provided'}</div><div className="provider-source" title={`Fixture source: ${match.primarySource}`}>{match.primarySource}</div></div>
    <div><div className="team-line"><Crest src={match.homeTeam.badgeUrl} name={match.homeTeam.name} /><span>{match.homeTeam.name}</span>{hasScore && <span className="fixture-score">{match.homeScore}</span>}</div>
      <div className="team-line"><Crest src={match.awayTeam.badgeUrl} name={match.awayTeam.name} /><span>{match.awayTeam.name}</span>{hasScore && <span className="fixture-score">{match.awayScore}</span>}</div></div>
    <div className="fixture-score"><StatusPill status={match.status} /></div>
    <ProbabilityBar prediction={match.prediction} /><ArrowRight className="card-arrow" size={16} />
  </Link>;
}

export function SummaryStrip({ total, upcoming, live, finished, average }: { total: number; upcoming: number; live: number; finished: number; average?: { home: number; draw: number; away: number } }) {
  return <div className="summary-strip" data-testid="summary-fixtures">
    <div className="summary-cell"><div className="summary-k">Matches on selected date</div><div className="summary-v">{total}</div><div className="summary-foot">Across available competitions</div></div>
    <div className="summary-cell"><div className="summary-k">Upcoming</div><div className="summary-v">{upcoming}</div><div className="summary-foot">Scheduled kick-offs</div></div>
    <div className="summary-cell"><div className="summary-k">Live now</div><div className="summary-v">{live}</div><div className="summary-foot">{finished} finished</div></div>
    <div className="summary-cell"><div className="summary-k">Average estimate</div><div className="summary-v">{average ? `${average.home} / ${average.draw} / ${average.away}` : '—'}</div><div className="summary-foot">H / D / A average probabilities</div></div>
  </div>;
}

export function ProviderList({ providers }: { providers: ProviderStatus[] }) {
  if (!providers.length) return <div className="footnote">Provider status was not included in this response.</div>;
  return <div>{providers.map((provider) => <div className="source-row" key={provider.name} data-testid={`source-provider-${provider.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
    <span className={`provider-dot ${provider.status}`} /><div><strong>{provider.name}</strong><small>{provider.message || provider.purpose}{provider.lastSuccessAt ? ` · Last success ${new Date(provider.lastSuccessAt).toLocaleString()}` : ''}</small></div>
    <span className="source-state">{provider.status}</span>
  </div>)}</div>;
}

export function RecentMatches({ profile }: { profile: FootballTeamProfile }) {
  return <section className="panel">
    <div className="profile-head"><Crest src={profile.badgeUrl} name={profile.name} /><div><h3>{profile.name}</h3><p>{[profile.country, profile.stadium].filter(Boolean).join(' · ') || 'Team profile'}</p></div></div>
    {profile.description && <p className="profile-copy">{profile.description}</p>}
    <div className="section-label"><span>Recent form</span><span>{profile.recentMatches.length} matches</span></div>
    {profile.recentMatches.length ? profile.recentMatches.map((item, index) => <RecentRow item={item} key={`${item.date}-${index}`} />) : <div className="footnote">No recent match data was returned for this team.</div>}
  </section>;
}

export function RecentRow({ item }: { item: RecentMatch }) {
  return <div className="recent-row" data-testid={`row-recent-${item.date}-${item.opponent.replace(/[^a-z0-9]+/gi, '-')}`}><span>{readableDate(item.date, { day: 'numeric', month: 'short' })}</span><span>{item.location === 'home' ? 'vs' : '@'} {item.opponent}</span><span>{item.scoreFor === null || item.scoreAgainst === null ? '—' : `${item.scoreFor}–${item.scoreAgainst}`}</span><span className={`result-mark ${item.result}`}>{item.result === 'unknown' ? '—' : item.result}</span></div>;
}

export function LoadingRows() {
  return <div className="fixture-list" aria-label="Loading fixtures">{[0, 1, 2, 3].map((item) => <div className="skeleton" key={item} />)}</div>;
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="empty-state" data-testid="state-empty"><Shield size={25} strokeWidth={1.5} /><h3>{title}</h3><div>{children}</div></div>;
}

export function ErrorState({ onRetry, message = 'The match feed could not be reached.' }: { onRetry: () => void; message?: string }) {
  return <div className="notice error" role="alert" data-testid="state-error"><strong>Feed temporarily unavailable.</strong> {message} <button type="button" className="source-link" onClick={onRetry} data-testid="button-retry">Try again</button></div>;
}

export function DateNavigation({ date, onDate }: { date: string; onDate: (date: string) => void }) {
  const shift = (days: number) => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); onDate(dateString(value)); };
  const today = dateString(new Date());
  const labels = [{ key: 'yesterday', date: dateString(new Date(new Date().setDate(new Date().getDate() - 1))) }, { key: 'today', date: today }, { key: 'tomorrow', date: dateString(new Date(new Date().setDate(new Date().getDate() + 1))) }];
  return <div className="date-nav" data-testid="navigation-date">
    <button type="button" aria-label="Previous day" onClick={() => shift(-1)} data-testid="button-previous-day"><ChevronLeft size={16} /></button>
    {labels.map((item) => <button type="button" key={item.key} className={`today-label ${date === item.date ? 'selected' : ''}`} onClick={() => onDate(item.date)} data-testid={`button-date-${item.key}`}>{item.key}</button>)}
    <button type="button" aria-label="Next day" onClick={() => shift(1)} data-testid="button-next-day"><ChevronRight size={16} /></button>
    <label className="date-pick" aria-label="Choose a date"><CalendarDays size={15} /><input className="date-input" type="date" value={date} onChange={(event) => event.target.value && onDate(event.target.value)} data-testid="input-custom-date" /></label>
  </div>;
}

export function BackLink() { return <Link href="/" className="source-link" data-testid="link-back-fixtures"><ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />All fixtures</Link>; }

export function MatchVenue({ venue }: { venue: string | null }) { return venue ? <span className="hero-venue"><MapPin size={13} />{venue}</span> : <span className="hero-venue"><Clock3 size={13} />Venue not listed</span>; }

export function CompetitionMark() { return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Trophy size={13} /> Competition</span>; }

export function ProbabilityLegend() { return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><BarChart3 size={13} /> H / D / A</span>; }

export function PagerButton({ direction, onClick, disabled }: { direction: 'left' | 'right'; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="icon-button" onClick={onClick} disabled={disabled} aria-label={direction === 'left' ? 'Previous date' : 'Next date'}>{direction === 'left' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button>;
}
