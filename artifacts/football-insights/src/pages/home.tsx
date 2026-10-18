import { useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useGetFootballSummary, getGetFootballSummaryQueryKey, useListFootballLeagues, getListFootballLeaguesQueryKey, useListFootballMatches, getListFootballMatchesQueryKey } from '@workspace/api-client-react';
import type { ListFootballMatchesStatus } from '@workspace/api-client-react';
import { AppShell, DateNavigation, EmptyState, ErrorState, FixtureCard, LoadingRows, ProviderList, SummaryStrip, Topline, dateString, readableDate } from '@/components/football-ui';

const statusOptions: { label: string; value: ListFootballMatchesStatus }[] = [
  { label: 'All', value: 'all' }, { label: 'Upcoming', value: 'upcoming' }, { label: 'Live', value: 'live' }, { label: 'Finished', value: 'finished' },
];

export default function HomePage() {
  const [date, setDate] = useState(() => dateString(new Date()));
  const [league, setLeague] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ListFootballMatchesStatus>('all');
  const matchesQuery = useListFootballMatches({ date, ...(league ? { league } : {}), ...(search.trim() ? { search: search.trim() } : {}), status }, { query: { queryKey: getListFootballMatchesQueryKey({ date, ...(league ? { league } : {}), ...(search.trim() ? { search: search.trim() } : {}), status }) } });
  const leaguesQuery = useListFootballLeagues({ date }, { query: { queryKey: getListFootballLeaguesQueryKey({ date }) } });
  const summaryQuery = useGetFootballSummary({ date }, { query: { queryKey: getGetFootballSummaryQueryKey({ date }) } });
  const matches = matchesQuery.data?.matches ?? [];
  const summary = summaryQuery.data;

  return <AppShell active="matches">
    <Topline />
    <div className="page-heading">
      <div><div className="eyebrow">The fixture desk</div><h1 data-testid="text-page-title">Matchday, in focus.</h1><div className="subhead" data-testid="text-selected-date">{readableDate(date)}</div></div>
      <DateNavigation date={date} onDate={(next) => { setDate(next); setLeague(''); }} />
    </div>
    {summaryQuery.isError && <div className="notice" role="status" data-testid="state-summary-partial">Fixture summary is temporarily unavailable. Match data may still be shown below.</div>}
    {summary && <SummaryStrip total={summary.totalMatches} upcoming={summary.upcomingMatches} live={summary.liveMatches} finished={summary.finishedMatches} average={{ home: summary.averageHomeProbability, draw: summary.averageDrawProbability, away: summary.averageAwayProbability }} />}
    {!summary && matchesQuery.data && <SummaryStrip total={matches.length} upcoming={matches.filter((match) => match.status === 'upcoming').length} live={matches.filter((match) => match.status === 'live').length} finished={matches.filter((match) => match.status === 'finished').length} />}

    <div className="filters">
      <div className="search-wrap"><Search size={15} /><input className="control" type="search" placeholder="Search a team…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search teams" data-testid="input-team-search" /></div>
      <select className="control" value={league} onChange={(event) => setLeague(event.target.value)} aria-label="Filter by league" data-testid="select-league">
        <option value="">All competitions</option>{(leaguesQuery.data?.leagues ?? []).map((item) => <option key={item.id ?? item.name} value={item.id ?? item.name}>{item.name}{item.country ? ` · ${item.country}` : ''}</option>)}
      </select>
      <div className="filter-status" role="group" aria-label="Filter match status" data-testid="filter-status">
        {statusOptions.map((option) => <button type="button" key={option.value} className={status === option.value ? 'active' : ''} onClick={() => setStatus(option.value)} data-testid={`button-status-${option.value}`}>{option.label}</button>)}
      </div>
    </div>

    {matchesQuery.isError && !matchesQuery.data && <ErrorState onRetry={() => { void matchesQuery.refetch(); }} />}
    {matchesQuery.isLoading && <LoadingRows />}
    {matchesQuery.isError && matchesQuery.data && <ErrorState onRetry={() => { void matchesQuery.refetch(); }} message="Showing the last available response. Refresh to try again." />}
    {matchesQuery.data?.warnings.map((warning, index) => <div className="notice" key={`${warning}-${index}`} data-testid={`notice-source-warning-${index}`}>{warning}</div>)}
    {matchesQuery.data?.sources?.some((source) => source.status !== 'ready') && <div className="panel" style={{ marginBottom: 16, padding: '14px 18px' }}><div className="section-label" style={{ margin: '0 0 4px' }}><span>Source health · partial coverage</span></div><ProviderList providers={matchesQuery.data.sources} /></div>}
    {!matchesQuery.isLoading && matchesQuery.data && matches.length === 0 && <EmptyState title={search || league || status !== 'all' ? 'No matches in this view' : 'No fixtures returned'}>{search || league || status !== 'all' ? 'Try another team, competition or match status.' : 'There are no fixtures available for this date from the connected sources.'}</EmptyState>}
    {matches.length > 0 && <>
      <div className="section-label"><span><SlidersHorizontal size={13} style={{ verticalAlign: 'middle', marginRight: 7 }} />{status === 'all' ? 'All fixtures' : `${status} fixtures`}</span><span>{matches.length} matches · provider-reported kick-off times (UTC shown when supplied)</span></div>
      <div className="fixture-list">{matches.map((match) => <FixtureCard key={match.id} match={match} date={date} />)}</div>
    </>}
    <div className="footnote">Percentages are model estimates, not guarantees or bookmaker odds. Availability and completeness depend on the connected data providers.</div>
  </AppShell>;
}
