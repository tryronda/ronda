import { invoke } from '@/lib/tauri';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useState } from 'react';
import { Switch } from '@/components/motion/switch';
import { saveTheme, themes, type ThemePreference } from '@/lib/theme';
import { PixelStrip } from '@/components/brand/pixel-field';
import './panels.css';

type Section = 'general' | 'locations' | 'remote' | 'connect' | 'data' | 'updates' | 'about';
type Location = { agent: string; path: string; enabled: boolean; custom: boolean };
type RemoteHost = { host: string; enabled: boolean; last_sync_ms: number | null; last_error: string | null };
type CustomRoots = Record<string, string[]>;

const agents = ['claude-code','codex','qoder','copilot','cursor','opencode','kiro','gemini','pi','omp',
  'grok','kimi','antigravity','dsh','hermes','openclaw','codebuddy','workbuddy'];

const copy = {
  title: 'Settings', subtitle: 'Tune where Ronda looks, how it looks, and who can read your library.', eyebrow: 'Preferences', general: 'General', locations: 'Locations', remote: 'Remote hosts',
  connect: 'Connect', data: 'Data', updates: 'Updates', about: 'About',
  appearance: 'Appearance', theme: 'Theme', themeHelp: 'Four times of day, from dawn to night.',
  system: 'System', dawn: 'Dawn', morning: 'Morning', dusk: 'Dusk', night: 'Night',
  sourceLocations: 'Session locations', locationsHelp: 'Ronda reads these paths without changing agent data.',
  enabled: 'Enabled', disabled: 'Disabled', default: 'Default', custom: 'Custom',
  addLocation: 'Add location', agent: 'Agent', path: 'Absolute folder path', add: 'Add', remove: 'Remove',
  missingPath: 'Enter an absolute folder path.', noLocations: 'No locations found.',
  remoteHelp: 'Sync another machine over SSH. The host must already connect without prompts.',
  sshHost: 'SSH host or alias', sync: 'Sync now', lastSync: 'Last sync', never: 'Never',
  remoteError: 'Last error', noHosts: 'No remote hosts configured.',
  connectHelp: 'Let an MCP client search and read your indexed sessions.',
  claudeSetup: 'Claude Code', codexSetup: 'Codex', genericSetup: 'Other MCP clients',
  copy: 'Copy', copied: 'Copied', index: 'Index database', refresh: 'Rebuild index',
  dataHelp: 'Re-read agent files and refresh Ronda’s searchable index.',
  updateHelp: 'Check the latest release only when you ask.', check: 'Check for updates',
  latest: 'Open latest release', noRelease: 'No public release found.',
  aboutText: 'A local library for coding-agent sessions. Agent files stay on your computer.',
  version: 'Version', saved: 'Saved', refreshed: 'Index refreshed', synced: 'Host synced',
  loading: 'Loading settings…', working: 'Working…',
} as const;

function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }

export function SettingsView() {
  const t = copy;
  const [section, setSection] = useState<Section>('general');
  const [theme, setTheme] = useState('morning');
  const [locations, setLocations] = useState<Location[]>([]);
  const [customRoots, setCustomRoots] = useState<CustomRoots>({});
  const [disabledRoots, setDisabledRoots] = useState<string[]>([]);
  const [locationAgent, setLocationAgent] = useState('claude-code');
  const [locationPath, setLocationPath] = useState('');
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [hostInput, setHostInput] = useState('');
  const [paths, setPaths] = useState<[string, string, string] | null>(null);
  const [release, setRelease] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadLocations() {
    const [rows, custom, disabled] = await Promise.all([
      invoke<Location[]>('list_locations'),
      invoke<string | null>('get_pref', { key: 'custom_roots' }),
      invoke<string | null>('get_pref', { key: 'disabled_roots' }),
    ]);
    setLocations(rows);
    try { setCustomRoots(custom ? JSON.parse(custom) as CustomRoots : {}); } catch { setCustomRoots({}); }
    try { setDisabledRoots(disabled ? JSON.parse(disabled) as string[] : []); } catch { setDisabledRoots([]); }
  }

  async function loadHosts() { setHosts(await invoke<RemoteHost[]>('list_remote_hosts')); }

  useEffect(() => {
    void Promise.all([
      invoke<string | null>('get_pref', { key: 'theme' }).then(value => setTheme(value === 'light' ? 'morning' : value === 'dark' ? 'night' : value ?? 'morning')),
      loadLocations(), loadHosts(), invoke<[string, string, string]>('app_paths').then(setPaths),
    ]).catch(reason => setError(String(reason))).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onTheme = (event: Event) => setTheme((event as CustomEvent<string>).detail);
    window.addEventListener('ronda:theme', onTheme);
    return () => window.removeEventListener('ronda:theme', onTheme);
  }, []);

  async function act(work: () => Promise<unknown>, success?: string) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); if (success) setNotice(success); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  function changeTheme(value: string) {
    void act(async () => {
      setTheme(value); await saveTheme(value as ThemePreference);
    }, t.saved);
  }

  async function saveLocations(custom: CustomRoots, disabled: string[]) {
    await invoke('set_pref', { key: 'custom_roots', value: JSON.stringify(custom) });
    await invoke('set_pref', { key: 'disabled_roots', value: JSON.stringify(disabled) });
    await loadLocations();
    await invoke('scan');
  }

  function addLocation() {
    const path = locationPath.trim();
    if (!path || !(path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\'))) {
      setError(t.missingPath); return;
    }
    if (locations.some(row => row.agent === locationAgent && row.path === path)) {
      setLocationPath(''); return;
    }
    const custom = { ...customRoots, [locationAgent]: [...(customRoots[locationAgent] ?? []), path] };
    void act(async () => { await saveLocations(custom, disabledRoots); setLocationPath(''); }, t.saved);
  }

  function toggleLocation(location: Location) {
    const disabled = location.enabled ? [...disabledRoots, location.path]
      : disabledRoots.filter(path => path !== location.path);
    void act(() => saveLocations(customRoots, disabled), t.saved);
  }

  function removeLocation(location: Location) {
    const custom = { ...customRoots,
      [location.agent]: (customRoots[location.agent] ?? []).filter(path => path !== location.path) };
    const disabled = disabledRoots.filter(path => path !== location.path);
    void act(() => saveLocations(custom, disabled), t.saved);
  }

  function addHost() {
    const host = hostInput.trim(); if (!host) return;
    void act(async () => { await invoke('set_remote_host', { host, enabled: true });
      await loadHosts(); setHostInput(''); }, t.saved);
  }

  function toggleHost(host: RemoteHost) {
    void act(async () => { await invoke('set_remote_host', { host: host.host, enabled: !host.enabled });
      await loadHosts(); }, t.saved);
  }

  function removeHost(host: RemoteHost) {
    void act(async () => { await invoke('remove_remote_host', { host: host.host }); await loadHosts(); }, t.saved);
  }

  function syncHost(host: RemoteHost) {
    void act(async () => { await invoke('sync_remote_host', { host: host.host }); await loadHosts(); }, t.synced);
  }

  async function copyText(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice(t.copied); setError(''); }
    catch (reason) { setError(String(reason)); }
  }

  const mcp = paths?.[0] ?? 'ronda-mcp';
  const snippets = [
    [t.claudeSetup, `claude mcp add --scope user ronda -- ${shellQuote(mcp)}`],
    [t.codexSetup, `[mcp_servers.ronda]\ncommand = ${JSON.stringify(mcp)}`],
    [t.genericSetup, JSON.stringify({ mcpServers: { ronda: { command: mcp } } }, null, 2)],
  ];

  return <div className="ronda-panel settings-panel">
    <header className="panel-header"><span className="eyebrow-chip">{t.eyebrow}</span><h1>{t.title}</h1><p>{t.subtitle}</p><PixelStrip cols={48} seed={5} className="panel-strip" /></header>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t.title}>
        {(['general','locations','remote','connect','data','updates','about'] as Section[]).map(key =>
          <button key={key} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => { setSection(key); setError(''); setNotice(''); }}>
            {section === key && <span className="settings-nav-indicator" />}
            <span className="settings-nav-label">{t[key]}</span></button>)}
      </nav>
      <div className="settings-body" aria-busy={loading || busy}>
        {loading ? <div className="settings-loading" role="status" aria-label={t.loading}>
          <div className="panel-card panel-skeleton"><i /><i /><i /></div>
        </div> : <>
        {error && <p className="panel-error" role="alert">{error}</p>}
        {notice && <p className="panel-notice" role="status">{notice}</p>}
        {busy && <p className="panel-busy" role="status"><span className="mini-spinner" />{t.working}</p>}
        {section === 'general' && <>
          <section className="panel-card"><h2>{t.appearance}</h2>
            <div className="settings-field"><div><strong>{t.theme}</strong><p>{t.themeHelp}</p></div>
              <select aria-label={t.theme} value={theme} disabled={busy} onChange={event => changeTheme(event.target.value)}>
                <option value="system">{t.system}</option>{themes.map(name => <option key={name} value={name}>{t[name]}</option>)}
              </select></div>
          </section>
        </>}
        {section === 'locations' && <section className="panel-card">
          <h2>{t.sourceLocations}</h2><p className="panel-help">{t.locationsHelp}</p>
          <div className="location-list">{locations.length ? locations.map(location =>
            <div className="location-row" key={`${location.agent}:${location.path}`}>
              <div><strong>{location.agent}</strong><small>{location.custom ? t.custom : t.default}</small>
                <code title={location.path}>{location.path}</code></div>
              <div className="location-actions"><span className="panel-switch">
                <Switch checked={location.enabled} disabled={busy} onCheckedChange={() => toggleLocation(location)} ariaLabel={`${location.agent} ${location.path}`} />
                <span>{location.enabled ? t.enabled : t.disabled}</span>
              </span>{location.custom && <button className="panel-link" disabled={busy} onClick={() => removeLocation(location)}>{t.remove}</button>}</div>
            </div>) : <p className="panel-empty">{t.noLocations}</p>}</div>
          <h3>{t.addLocation}</h3><div className="settings-form">
            <select aria-label={t.agent} value={locationAgent} onChange={event => setLocationAgent(event.target.value)}>{agents.map(agent => <option key={agent}>{agent}</option>)}</select>
            <input aria-label={t.path} placeholder={t.path} value={locationPath} onChange={event => setLocationPath(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addLocation(); }} />
            <button disabled={busy} onClick={addLocation}>{t.add}</button>
          </div>
        </section>}
        {section === 'remote' && <section className="panel-card">
          <h2>{t.remote}</h2><p className="panel-help">{t.remoteHelp}</p>
          <div className="settings-form"><input aria-label={t.sshHost} placeholder={t.sshHost} value={hostInput}
            onChange={event => setHostInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addHost(); }} />
            <button disabled={busy || !hostInput.trim()} onClick={addHost}>{t.add}</button></div>
          {hosts.length ? <div className="remote-list">{hosts.map(host => <div className="remote-row" key={host.host}>
            <div><strong>{host.host}</strong><small>{t.lastSync}: {host.last_sync_ms ? new Date(host.last_sync_ms).toLocaleString() : t.never}</small>
              {host.last_error && <small className="panel-danger">{t.remoteError}: {host.last_error}</small>}</div>
            <div className="location-actions"><span className="panel-switch"><Switch checked={host.enabled}
              disabled={busy} onCheckedChange={() => toggleHost(host)} ariaLabel={host.host} /><span>{host.enabled ? t.enabled : t.disabled}</span></span>
              <button disabled={busy || !host.enabled} onClick={() => syncHost(host)}>{t.sync}</button>
              <button className="panel-link" disabled={busy} onClick={() => removeHost(host)}>{t.remove}</button></div>
          </div>)}</div> : <p className="panel-empty">{t.noHosts}</p>}
        </section>}
        {section === 'connect' && <section className="panel-card">
          <h2>{t.connect}</h2><p className="panel-help">{t.connectHelp}</p>
          {snippets.map(([name, snippet]) => <div className="settings-snippet" key={name}>
            <div><strong>{name}</strong><button onClick={() => void copyText(snippet)}>{t.copy}</button></div>
            <pre><code>{snippet}</code></pre>
          </div>)}
        </section>}
        {section === 'data' && <section className="panel-card"><h2>{t.data}</h2><p className="panel-help">{t.dataHelp}</p>
          <div className="settings-field"><div><strong>{t.index}</strong><code className="settings-path">{paths?.[2] ?? '…'}</code></div></div>
          <button disabled={busy} onClick={() => void act(() => invoke('scan'), t.refreshed)}>{t.refresh}</button>
        </section>}
        {section === 'updates' && <section className="panel-card"><h2>{t.updates}</h2><p className="panel-help">{t.updateHelp}</p>
          <button disabled={busy} onClick={() => void act(async () => {
            const url = await invoke<string | null>('check_updates'); setRelease(url); if (!url) setNotice(t.noRelease);
          })}>{t.check}</button>
          {release && <button className="panel-link" onClick={() => void openUrl(release)}>{t.latest}</button>}
        </section>}
        {section === 'about' && <section className="panel-card"><h2>Ronda</h2><p className="panel-help">{t.aboutText}</p>
          <p>{t.version} 1.0.0</p>
        </section>}
        </>}
      </div>
    </div>
  </div>;
}
