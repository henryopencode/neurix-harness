/** Independent MCP server list, tool details, and connection editor. @module */
import { useState } from 'react'
import { Button, IconChevronRightOutlineRegular, IconLinkOutlineRegular, Modal, Select, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpManagerSnapshot, McpServerDraft, McpServerId, McpServerView } from '../types.ts'
import css from './McpPage.module.css'

/** Server actions owned by the Client registration. */
export interface McpPageInjected {
  save: (id: McpServerId | null, draft: McpServerDraft, revision: string) => Promise<boolean>
  remove: (id: McpServerId, revision: string) => Promise<boolean>
  setEnabled: (id: McpServerId, enabled: boolean, revision: string) => Promise<boolean>
  reconnect: (id: McpServerId) => Promise<boolean>
}

/** Main-panel data and framework resource/localization hooks. */
export type McpPageProps = PropsRuntime<'main'> & PropsLocale<'mcpManager'> & InjectFace<McpPageInjected>

/** MCP sidebar glyph from the shared icon library.
 * @param props - icon size requested by the sidebar.
 * @returns the connection glyph.
 */
export function McpPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) { return <IconLinkOutlineRegular size={size} /> }

/** Credential-preserving form state for an existing or new server. */
const EMPTY: McpServerDraft = { serverName: '', transport: 'stdio', command: '', args: [], cwd: '', url: '' }

function Editor({ server, revision, save, close, t }: {
  server: McpServerView | null
  revision: string
  save: McpPageInjected['save']
  close: () => void
  t: McpPageProps['t']
}) {
  const [draft, setDraft] = useState(server?.draft ?? EMPTY)
  const [args, setArgs] = useState(draft.args.join('\n'))
  const [credentials, setCredentials] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const change = (patch: Partial<McpServerDraft>) => { setDraft(current => ({ ...current, ...patch })) }
  const submit = async () => {
    let secretFields: Record<string, string> | undefined
    if (credentials.trim()) {
      let parsed: unknown
      try { parsed = JSON.parse(credentials) }
      catch (_invalidJson) { setInvalid(true); return }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(value => typeof value !== 'string')) {
        setInvalid(true); return
      }
      secretFields = parsed as Record<string, string>
    }
    setInvalid(false); setBusy(true)
    try {
      if (await save(server?.id ?? null, { ...draft, args: args ? args.split(/\r?\n/) : [],
        ...secretFields === undefined ? {} : { credentials: secretFields } }, revision)) close()
    } finally { setBusy(false) }
  }
  return <Modal open title={t(server === null ? 'addTitle' : 'editTitle')} closeLabel={t('close')}
    onClose={() => { if (!busy) close() }} className={css.modal ?? ''}>
    <form className={css.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <p className={css.secondary}>{t('globalHint')}</p>
      <label>{t('name')}<input required pattern="([A-Za-z0-9_]|-){1,32}" value={draft.serverName} disabled={busy}
        onChange={(event) => { change({ serverName: event.target.value }) }} /></label>
      <label>{t('transport')}<Select value={draft.transport} disabled={busy} aria-label={t('transport')}
        options={[{ value: 'stdio', label: t('stdio') }, { value: 'streamable-http', label: t('http') }]}
        onValueChange={(value) => {
          change({ transport: value === 'stdio' ? 'stdio' : 'streamable-http' }); setCredentials('')
        }} /></label>
      {draft.transport === 'stdio' ? <>
        <label>{t('command')}<input required value={draft.command} disabled={busy} onChange={(event) => { change({ command: event.target.value }) }} /></label>
        <label>{t('args')}<textarea rows={3} value={args} disabled={busy} onChange={(event) => { setArgs(event.target.value) }} /></label>
        <label>{t('cwd')}<input value={draft.cwd} disabled={busy} onChange={(event) => { change({ cwd: event.target.value }) }} /></label>
      </> : <label>{t('url')}<input required type="url" value={draft.url} disabled={busy} onChange={(event) => { change({ url: event.target.value }) }} /></label>}
      <label>{t(draft.transport === 'stdio' ? 'env' : 'headers')}<textarea rows={2} value={credentials} disabled={busy}
        placeholder={t('preserveCredentials')} autoComplete="off" spellCheck={false}
        aria-invalid={invalid} onChange={(event) => { setCredentials(event.target.value); setInvalid(false) }} /></label>
      {invalid && <p className={css.error} role="alert">{t('invalidCredentials')}</p>}
      <div className={css.actions}><Button disabled={busy} onClick={close}>{t('cancel')}</Button>
        <Button variant="primary" type="submit" disabled={busy} onClick={(event) => {
          event.preventDefault()
          if (event.currentTarget.form?.reportValidity()) void submit()
        }}>{t('save')}</Button></div>
    </form>
  </Modal>
}

/** Render current server states and tools while preserving drafts during live updates.
 * @param props - framework resource hook, localized copy, and management actions.
 * @returns the MCP management panel.
 */
export function McpPage({ useResource, save, remove, setEnabled, reconnect, t }: McpPageProps) {
  const [refresh, setRefresh] = useState(0)
  const resource = useResource<'mcp'>('dsh-resource://mcp/servers?refresh=' + String(refresh))
  const snapshot: McpManagerSnapshot | undefined = resource.value
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<{ server: McpServerView | null; revision: string } | null>(null)
  const [removing, setRemoving] = useState<{ server: McpServerView; revision: string } | null>(null)
  const [busy, setBusy] = useState<McpServerId | null>(null)
  const act = async (id: McpServerId, operation: () => Promise<boolean>) => {
    setBusy(id)
    try { await operation() } finally { setBusy(null) }
  }
  const normalized = query.trim().toLocaleLowerCase()
  const servers = snapshot?.servers.filter(server => [server.serverName, server.id,
    ...server.connection?.tools.map(tool => tool.name) ?? []]
    .some(value => value.toLocaleLowerCase().includes(normalized))) ?? []
  return <section className={css.page} aria-label={t('title')}>
    <div className={css.content}>
      <header className={css.header} data-window-drag><h1>{t('title')}</h1><div className={css.actions}>
        <Button variant="outline" onClick={() => { setRefresh(value => value + 1) }}>{t('refresh')}</Button>
        <Button variant="primary" disabled={!snapshot?.writable || busy !== null}
          onClick={() => { if (snapshot) setEditor({ server: null, revision: snapshot.revision }) }}>{t('add')}</Button>
      </div></header>
      <input className={css.search} type="search" aria-label={t('search')} placeholder={t('search')} value={query}
        onChange={(event) => { setQuery(event.target.value) }} />
      {resource.status === 'failed' && <p className={css.error} role="alert">{t('loadFailed')}</p>}
      {snapshot?.recoveryRequired && <p className={css.error} role="alert">{t('recoveryRequired')}</p>}
      {snapshot && !snapshot.writable && !snapshot.recoveryRequired && <p className={css.secondary}>{t('readOnly')}</p>}
      {snapshot === undefined && resource.status !== 'failed' ? <div className={css.list} aria-busy="true">
        {[0, 1, 2].map(index => <div key={index} className={css.skeleton} />)}
      </div> : snapshot && servers.length === 0 ? <p className={css.empty}>{t(normalized ? 'noMatches' : 'empty')}</p>
        : <ul className={css.list}>{servers.map((server) => {
          const state = !server.enabled ? 'disabled' : server.connection?.state ?? 'unknown'
          return <li className={css.card} key={server.id} data-mcp-server={server.serverName}>
            <div className={css.cardHeader}><div className={css.heading}><h2>{server.serverName}</h2>
              <Tag tone={state === 'connected' ? 'success' : state === 'disconnected' ? 'warning' : 'neutral'}>{t(state)}</Tag>
            </div><Switch checked={server.enabled} disabled={!snapshot?.writable || busy !== null}
              label={t('enable', { name: server.serverName })}
              onChange={(enabled) => {
                if (snapshot) void act(server.id, () => setEnabled(server.id, enabled, snapshot.revision))
              }} /></div>
            <div className={css.secondary}>{t(server.draft.transport === 'stdio' ? 'stdio' : 'http')}</div>
            <div className={css.actions}>
              <Button size="sm" disabled={!snapshot?.writable || busy !== null || !server.enabled}
                onClick={() => { void act(server.id, () => reconnect(server.id)) }}>{t('reconnect')}</Button>
              <Button size="sm" disabled={!snapshot?.writable || busy !== null || !server.editable}
                onClick={() => { if (snapshot) setEditor({ server, revision: snapshot.revision }) }}>{t('edit')}</Button>
              {server.removable && <Button size="sm" disabled={!snapshot?.writable || busy !== null}
                onClick={() => { if (snapshot) setRemoving({ server, revision: snapshot.revision }) }}>{t('remove')}</Button>}
            </div>
            {!server.editable && <p className={css.secondary}>{t('expression')}</p>}
            <details className={css.tools}><summary>
              <IconChevronRightOutlineRegular className={css.toolsChevron} size={14} aria-hidden="true" />
              {t('tools', { count: server.connection?.tools.length ?? 0 })}
            </summary>
            {server.connection?.tools.length ? <ul>{server.connection.tools.map(tool => <li key={tool.name}>
              <code>{tool.name}</code>{tool.description && <p>{tool.description}</p>}
            </li>)}</ul> : <p className={css.secondary}>{t('noTools')}</p>}
            </details>
          </li>
        })}</ul>}
    </div>
    {editor && <Editor server={editor.server} revision={editor.revision} save={save} close={() => { setEditor(null) }} t={t} />}
    {removing && <Modal open title={t('removeTitle')} closeLabel={t('close')} onClose={() => { if (busy === null) setRemoving(null) }}
      description={t('removeDescription', { name: removing.server.serverName })} footer={<div className={css.actions}>
        <Button disabled={busy !== null} onClick={() => { setRemoving(null) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy !== null} onClick={() => { void act(removing.server.id, async () => {
          const ok = await remove(removing.server.id, removing.revision)
          if (ok) setRemoving(null)
          return ok
        }) }}>{t('remove')}</Button>
      </div>} />}
  </section>
}
