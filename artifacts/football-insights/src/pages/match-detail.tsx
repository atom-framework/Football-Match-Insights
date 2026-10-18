import { useParams, useSearch } from 'wouter';
import { BarChart3, CalendarDays, Info, Scale } from 'lucide-react';
import { getGetFootballMatchQueryKey, useGetFootballMatch } from '@workspace/api-client-react';
import { AppShell, BackLink, Crest, EmptyState, ErrorState, MatchVenue, ProviderList, RecentMatches, RecentRow, StatusPill, Topline, dateString, readableDate } from '@/components/football-ui';

export default function MatchDetailPage() {
  const params = useParams<{ matchId: string }>();
  const search = useSearch();
  const requestedDate = new URLSearchParams(search).get('date') || dateString(new Date());
  const matchId = params.matchId || '';
  const matchQuery = useGetFootballMatch({ matchId, date: requestedDate }, { query: { enabled: !!matchId, queryKey: getGetFootballMatchQueryKey({ matchId, date: requestedDate }) } });
  const detail = matchQuery.data;
  const match = detail?.match;

  return <AppShell active="matches">
    <Topline crumb="MATCHDAY / MATCH DETAIL" />
    <div style={{ marginBottom: 17 }}><BackLink /></div>
    {matchQuery.isError && !detail && <ErrorState onRetry={() => { void matchQuery.refetch(); }} message="We could not load this match detail. The fixture may have moved or the source may be recovering." />}
    {matchQuery.isLoading && <div className="fixture-list"><div className="skeleton" style={{ height: 210 }} /><div className="skeleton" /><div className="skeleton" /></div>}
    {!matchQuery.isLoading && !matchQuery.isError && !detail && <EmptyState title="Match details unavailable">No detail response was returned for this fixture.</EmptyState>}
    {matchQuery.isError && detail && <ErrorState onRetry={() => { void matchQuery.refetch(); }} message="Showing the last available detail response." />}
    {detail && match && <>
      {detail.warnings.map((warning, index) => <div className="notice" key={`${warning}-${index}`} data-testid={`notice-detail-warning-${index}`}>{warning}</div>)}
      <section className="detail-hero" data-testid="panel-match-summary">
        <div className="detail-meta">{match.league.name}{match.league.country ? ` · ${match.league.country}` : ''} <span style={{ opacity: .6 }}> / </span> {match.round || 'Fixture'} <span style={{ opacity: .6 }}> / </span> {readableDate(match.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
        <div className="detail-teams">
          <div className="detail-team"><Crest src={detail.homeTeamProfile.badgeUrl || match.homeTeam.badgeUrl} name={match.homeTeam.name} /><span>{match.homeTeam.name}</span></div>
          <div className="hero-score">{match.homeScore !== null && match.awayScore !== null ? `${match.homeScore} — ${match.awayScore}` : match.kickoffLocal || 'vs'}</div>
          <div className="detail-team away"><Crest src={detail.awayTeamProfile.badgeUrl || match.awayTeam.badgeUrl} name={match.awayTeam.name} /><span>{match.awayTeam.name}</span></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}><StatusPill status={match.status} /><MatchVenue venue={match.venue} /><span className="hero-venue"><CalendarDays size={13} />{match.kickoffLocal || 'Kick-off time not listed'}</span></div>
      </section>

      <div className="detail-grid">
        <section className="panel" data-testid="panel-probabilities">
          <div className="panel-title"><h2>Outcome estimate</h2><span><BarChart3 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />{match.prediction.model}</span></div>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Model-estimated probabilities · not a guarantee</div>
          {[['Home win', match.prediction.probabilities.home], ['Draw', match.prediction.probabilities.draw], ['Away win', match.prediction.probabilities.away]].map(([label, value], index) => <div className="prob-row" key={label as string}><span>{label}</span><div className="prob-track"><div className="prob-fill" style={{ width: `${value}%` }} /></div><strong>{value}%</strong></div>)}
          <div className="confidence"><span>Confidence: <strong style={{ color: '#365a40', textTransform: 'capitalize' }}>{match.prediction.confidenceLabel}</strong></span><span>{match.prediction.confidence}% signal strength</span></div>
          <p className="footnote"><Info size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} />{match.prediction.disclaimer}</p>
        </section>
        <section className="panel" data-testid="panel-prediction-factors">
          <div className="panel-title"><h2>What shapes this view</h2><span>{match.prediction.factors.length} factors</span></div>
          {match.prediction.factors.length ? match.prediction.factors.map((factor) => <div className="factor" key={factor.key} data-testid={`factor-${factor.key}`}><div><strong>{factor.label}</strong><p>{factor.summary}{!factor.available ? ' · Data unavailable' : ''}</p></div><span className="effect">{factor.effect} · {Math.round(factor.weight * 100)}%</span></div>) : <div className="footnote">No prediction factors were returned.</div>}
        </section>
      </div>

      <div className="team-profiles">
        <RecentMatches profile={detail.homeTeamProfile} />
        <RecentMatches profile={detail.awayTeamProfile} />
      </div>
      <section className="panel" style={{ marginTop: 18 }} data-testid="panel-head-to-head">
        <div className="panel-title"><h2><Scale size={17} style={{ verticalAlign: 'middle', marginRight: 8 }} />Head to head</h2><span>{detail.headToHead.length} records</span></div>
        {detail.headToHead.length ? detail.headToHead.map((item, index) => <RecentRow item={item} key={`${item.date}-${index}`} />) : <div className="footnote">No head-to-head results were included in the available data.</div>}
      </section>
      <section className="panel" style={{ marginTop: 18 }} data-testid="panel-match-sources">
        <div className="panel-title"><h2>Sources & coverage</h2><span>{match.sources.join(' · ') || 'No source labels'}</span></div>
        <ProviderList providers={detail.sources} />
        {match.sourceUrls.length > 0 && <div className="footnote">Event references: {match.sourceUrls.map((url, index) => <span key={url}>{index > 0 ? ' · ' : ''}<a className="source-link" href={url} target="_blank" rel="noreferrer">{match.sources[index] || `Source ${index + 1}`}</a></span>)}</div>}
      </section>
      <div className="footnote">Updated {new Date(match.updatedAt).toLocaleString()} · Probability estimates are not bookmaker odds.</div>
    </>}
  </AppShell>;
}
