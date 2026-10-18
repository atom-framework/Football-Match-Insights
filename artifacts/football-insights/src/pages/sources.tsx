import { Database, ExternalLink, GitBranch, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import { getGetFootballSourcesQueryKey, useGetFootballSources } from '@workspace/api-client-react';
import { AppShell, ErrorState, ProviderList, Topline } from '@/components/football-ui';

export default function SourcesPage() {
  const sourcesQuery = useGetFootballSources({ query: { queryKey: getGetFootballSourcesQueryKey() } });
  const sources = sourcesQuery.data;
  return <AppShell active="sources">
    <Topline crumb="FIELD NOTES / SOURCES & METHOD" />
    <section className="sources-hero">
      <div className="eyebrow" style={{ color: '#e4ce82' }}>How the picture is assembled</div>
      <h1>Clear about the data.<br />Honest about the unknowns.</h1>
      <p>Football Insights brings fixtures, team context and a probability estimate into one matchday view. Provider attribution and data gaps stay visible, so the numbers can be read in context.</p>
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', color: '#e4ce82', font: '11px var(--app-font-mono)', marginTop: 20 }}><ShieldCheck size={15} /> ESTIMATES, NEVER CERTAINTIES</div>
    </section>
    {sourcesQuery.isError && !sources && <ErrorState onRetry={() => { void sourcesQuery.refetch(); }} message="Provider and methodology details could not be loaded." />}
    {sourcesQuery.isLoading && <div className="fixture-list"><div className="skeleton" style={{ height: 170 }} /><div className="skeleton" /></div>}
    {sourcesQuery.isError && sources && <ErrorState onRetry={() => { void sourcesQuery.refetch(); }} message="Showing the last available source information." />}
    {sources && <>
      <section className="panel" data-testid="panel-provider-attribution">
        <div className="panel-title"><h2><Database size={17} style={{ verticalAlign: 'middle', marginRight: 8 }} />Provider attribution</h2><span>{sources.providers.length} providers reported</span></div>
        <ProviderList providers={sources.providers} />
        {sources.providers.map((provider) => <div className="footnote" key={`${provider.name}-attribution`}><a className="source-link" href={provider.attributionUrl} target="_blank" rel="noreferrer" data-testid={`link-provider-${provider.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{provider.name} attribution <ExternalLink size={11} style={{ verticalAlign: 'middle', marginLeft: 4 }} /></a> · {provider.purpose}</div>)}
        {!sources.providers.length && <div className="footnote">No provider status details were included in the server response.</div>}
      </section>
      <div className="method-grid">
        <section className="method-card" data-testid="panel-methodology"><h2><GitBranch size={17} style={{ verticalAlign: 'middle', marginRight: 7 }} />Estimation method</h2><p>{sources.predictionMethod}</p></section>
        <section className="method-card" data-testid="panel-estimate-disclaimer"><h2><Info size={17} style={{ verticalAlign: 'middle', marginRight: 7 }} />How to read an estimate</h2><p>{sources.predictionDisclaimer}</p></section>
      </div>
      <div className="footnote"><RefreshCw size={11} style={{ verticalAlign: 'middle', marginRight: 5 }} />Provider availability and refresh times can vary. Missing or degraded sources may reduce the context available for individual matches. Estimates are not guarantees and are not bookmaker odds.</div>
    </>}
  </AppShell>;
}
