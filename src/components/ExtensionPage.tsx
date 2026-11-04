import { useEffect, useMemo, useState } from 'react';
import { Download, Plus, RefreshCw, Trash2, Puzzle, ExternalLink, ShieldAlert, Search } from 'lucide-react';

type ExtensionEntry = {
  id: string; name: string; version: string; description?: string; lang?: string;
  nsfw?: boolean; type?: 'web' | 'apk'; manifest?: string; apk?: string;
  icon?: string; site?: string; source?: string;
};
type Repo = { id: string; url: string; name: string; extensions: ExtensionEntry[]; updatedAt: number };
const REPOS_KEY = 'rykoccllection-extension-repositories-v1';
const INSTALLED_KEY = 'rykoccllection-installed-extensions-v1';
const read = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const safeHttps = (value: string) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const repoUrl = (raw: string) => raw.trim().replace(/\/$/, '');
const resolveUrl = (base: string, path?: string) => { if (!path) return ''; try { return new URL(path, base).toString(); } catch { return ''; } };

export function ExtensionPage() {
  const [repos, setRepos] = useState<Repo[]>(() => read(REPOS_KEY, []));
  const [installed, setInstalled] = useState<string[]>(() => read(INSTALLED_KEY, []));
  const [repoInput, setRepoInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'all'|'web'|'apk'|'installed'>('all');
  useEffect(() => { localStorage.setItem(REPOS_KEY, JSON.stringify(repos)); }, [repos]);
  useEffect(() => { localStorage.setItem(INSTALLED_KEY, JSON.stringify(installed)); }, [installed]);
  const extensions = useMemo(() => repos.flatMap(repo => repo.extensions.map(extension => ({...extension, _repo: repo.id, _base: repo.url}))), [repos]);
  const visible = extensions.filter(item => (tab === 'all' || tab === 'installed' || item.type === tab) && (tab !== 'installed' || installed.includes(item.id)) && (item.name+' '+(item.description||'')+' '+(item.lang||'')).toLowerCase().includes(filter.toLowerCase()));

  const readIndex = async (raw: string): Promise<Repo> => {
    const url = repoUrl(raw);
    if (!safeHttps(url)) throw new Error('Repository must use a valid HTTPS URL.');
    const candidates = [/\.json$/i.test(url) ? url : '', url + '/index.min.json', url + '/index.json'].filter(Boolean);
    let lastError = 'Repository index not found.';
    for (const target of candidates) {
      try {
        const response = await fetch(target, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!response.ok) { lastError = 'Repository returned HTTP ' + response.status; continue; }
        const data = await response.json() as { name?: string; extensions?: ExtensionEntry[] };
        if (!Array.isArray(data.extensions)) { lastError = 'Invalid index: expected an extensions array.'; continue; }
        const ids = new Set<string>();
        const valid = data.extensions.filter(item => {
          if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.version !== 'string' || ids.has(item.id)) return false;
          ids.add(item.id);
          if (item.type === 'apk') return typeof item.apk === 'string' && safeHttps(resolveUrl(target, item.apk));
          return item.type === 'web' && typeof item.manifest === 'string' && safeHttps(resolveUrl(target, item.manifest));
        }).map(item => ({...item, manifest: item.manifest ? resolveUrl(target,item.manifest) : undefined, apk: item.apk ? resolveUrl(target,item.apk) : undefined}));
        return { id: url, url: target, name: data.name || new URL(url).host, extensions: valid, updatedAt: Date.now() };
      } catch (error) { lastError = error instanceof Error ? error.message : lastError; }
    }
    throw new Error(lastError + ' Check that the host permits browser CORS requests.');
  };

  const addRepository = async () => {
    if (busy || !repoInput.trim()) return;
    setBusy(true); setNotice('');
    try {
      const repo = await readIndex(repoInput);
      setRepos(old => [...old.filter(item => item.id !== repo.id), repo]);
      setRepoInput('');
      setNotice('Repository added: ' + repo.name + ' (' + repo.extensions.length + ' compatible extensions).');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not add repository.'); }
    finally { setBusy(false); }
  };
  const refreshRepo = async (repo: Repo) => {
    setBusy(true); setNotice('');
    try { const updated = await readIndex(repo.id); setRepos(old => old.map(item => item.id === repo.id ? updated : item)); setNotice('Repository refreshed.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Refresh failed.'); }
    finally { setBusy(false); }
  };
  const installWeb = async (item: ExtensionEntry & {_repo:string;_base:string}) => {
    if (!item.manifest || !safeHttps(item.manifest)) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch(item.manifest, {headers:{Accept:'application/json'}});
      if (!response.ok) throw new Error('Manifest download failed: HTTP '+response.status);
      const manifest = await response.json() as { id?:string; name?:string; version?:string; apiVersion?:number; description?:string; source?:string; baseUrl?:string };
      if (manifest.id !== item.id || manifest.version !== item.version || manifest.apiVersion !== 1) throw new Error('Manifest identity, version or API compatibility check failed.');
      if (!manifest.source || !safeHttps(resolveUrl(item.manifest, manifest.source))) throw new Error('Manifest must declare an HTTPS source descriptor.');
      const sourceResponse = await fetch(resolveUrl(item.manifest,manifest.source), {headers:{Accept:'application/json'}});
      if (!sourceResponse.ok) throw new Error('Source descriptor download failed.');
      const source = await sourceResponse.json() as { id?:string; name?:string; baseUrl?:string; searchPath?:string; searchParam?:string };
      if (source.id !== item.id || !source.baseUrl || !safeHttps(source.baseUrl) || !source.searchPath) throw new Error('Invalid source descriptor. Only declarative HTTPS sources are supported.');
      const record = {id:item.id,name:item.name,version:item.version,manifest:item.manifest,source,installedAt:Date.now()};
      localStorage.setItem('rykoccllection-web-extension:'+item.id,JSON.stringify(record));
      setInstalled(old => [...new Set([...old,item.id])]);
      setNotice(item.name+' installed. Review the source privacy policy before using it.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Extension installation failed.'); }
    finally { setBusy(false); }
  };
  const removeExtension = (id:string) => { localStorage.removeItem('rykoccllection-web-extension:'+id); setInstalled(old=>old.filter(value=>value!==id)); setNotice('Extension removed from this device.'); };

  return <main className="content-page extension-page">
    <div className="page-heading"><span className="eyebrow">MANGA READER · SOURCE MANAGER</span><h1>Extensions <em>hub.</em></h1><p>Add repositories, discover community sources and manage compatible reader extensions.</p></div>
    <div className="extension-warning"><ShieldAlert size={18}/><p>Only add repositories you trust. Extensions can expose browsing activity to their source providers. APK installation is handled separately by Android and always requires your confirmation.</p></div>
    <section className="extension-repo-card"><div><span className="eyebrow">REPOSITORY MANAGER</span><h2>Add extension repository</h2><p>Paste an HTTPS repository URL that provides an index.json or index.min.json file.</p></div><div className="extension-add-row"><input value={repoInput} onChange={event=>setRepoInput(event.target.value)} placeholder="https://example.org/extensions" inputMode="url"/><button className="primary-btn" onClick={()=>void addRepository()} disabled={busy||!repoInput.trim()}><Plus size={16}/>{busy?'Checking…':'Add repository'}</button></div>
    {repos.length>0 && <div className="extension-repo-list">{repos.map(repo=><div className="extension-repo" key={repo.id}><div><strong>{repo.name}</strong><span>{repo.extensions.length} compatible extensions · {new URL(repo.url).host}</span></div><button title="Refresh repository" onClick={()=>void refreshRepo(repo)} disabled={busy}><RefreshCw size={16}/></button><button title="Remove repository" onClick={()=>setRepos(old=>old.filter(item=>item.id!==repo.id))}><Trash2 size={16}/></button></div>)}</div>}</section>
    {notice && <p className="extension-notice" role="status">{notice}</p>}
    <div className="extension-toolbar"><label className="large-search"><Search size={17}/><input value={filter} onChange={event=>setFilter(event.target.value)} placeholder="Search extensions…"/></label><div className="extension-tabs">{(['all','web','apk','installed'] as const).map(value=><button key={value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{value==='all'?'All':value==='web'?'Web':value==='apk'?'Android APK':'Installed'}</button>)}</div></div>
    <div className="extension-grid">{visible.map(item=><article className="extension-card" key={item.id}><div className="extension-card-icon"><Puzzle size={22}/></div><div className="extension-card-main"><div className="extension-card-title"><h3>{item.name}</h3><span className="extension-type">{item.type==='apk'?'ANDROID APK':'WEB SOURCE'}</span></div><p>{item.description||'Community manga source extension.'}</p><div className="extension-meta"><span>{item.lang||'Unknown language'}</span><span>v{item.version}</span>{item.nsfw && <span>Restricted content</span>}</div><div className="extension-actions">{item.type==='web' ? installed.includes(item.id) ? <button className="secondary-btn" onClick={()=>removeExtension(item.id)}>Uninstall</button> : <button className="primary-btn" disabled={busy} onClick={()=>void installWeb(item)}> <Download size={15}/> Install</button> : <a className="primary-btn" href={item.apk} target="_blank" rel="noopener noreferrer"><Download size={15}/> Download APK</a>}{item.site && <a className="secondary-btn" href={item.site} target="_blank" rel="noopener noreferrer">Website <ExternalLink size={13}/></a>}</div></div></article>)}</div>
    {!visible.length && <div className="extension-empty"><Puzzle size={26}/><h3>{repos.length?'No extensions found':'No repositories added yet'}</h3><p>Add a compatible repository to discover web and Android extensions.</p></div>}
    <div className="extension-help"><h3>Supported repository format</h3><p>Index JSON: <code>{'{ "name": "My Repo", "extensions": [{ "id": "source-id", "name": "Source", "version": "1.0.0", "type": "web", "manifest": "source/manifest.json" }] }'}</code></p><p>Web extensions use a declarative HTTPS source descriptor (API v1). They do not execute arbitrary remote JavaScript. APK entries provide a download link; Android verifies and installs the package through its own system installer.</p></div>
  </main>;
}
