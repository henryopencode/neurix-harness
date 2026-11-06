/** Read-only context diagnostics over Host projections and loaded request history. */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { deriveContextRequests, rankContextTools, sameContextRequests } from './context-diagnostics.ts'
import type { TrajectoryViewInjected } from './TrajectoryView.tsx'
import css from './ContextDiagnosticsPanel.module.css'

type Props = Pick<ConvViewProps, 'useProjection' | 'useTrajectory' | 'useSession'>
  & Pick<TrajectoryViewInjected, 'loadOlder'>
  & PropsLocale<'trajectory'>
  & { onClose: () => void }

function number(value: number | undefined): string {
  return value === undefined ? '—' : String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Render context estimates, reported request usage and selected tool definitions.
 * @param props - Session-bound readers, history paging and modal dismissal.
 * @returns a responsive modal; paging failures retain all loaded diagnostics.
 */
export function ContextDiagnosticsPanel({ useProjection, useTrajectory, useSession, loadOlder, onClose, t }: Props) {
  const pressure = useProjection('contextPressure')
  const breakdown = useProjection('contextBreakdown')
  const requests = useTrajectory(snapshot => snapshot.requests, sameContextRequests)
  const hasMore = useSession(snapshot => snapshot.hasMore)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const metrics = useMemo(() => deriveContextRequests(requests), [requests])
  const selected = metrics.find(metric => metric.request.startSeq === selectedSeq) ?? metrics.at(-1)
  const tools = useMemo(() => rankContextTools(selected?.request.prompt), [selected?.request.prompt])
  const largestInput = metrics.reduce((largest, metric) => Math.max(largest, metric.input ?? 0), 1)
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const capacity = pressure?.contextWindow
  const occupancy = used !== undefined && capacity !== undefined && capacity > 0
    ? Math.round(used / capacity * 100)
    : undefined
  const parts = breakdown === undefined ? [] : [
    { label: t('diagnostics.system'), tokens: breakdown.systemTokens, color: css.system },
    { label: t('diagnostics.tools'), tokens: breakdown.toolsTokens, color: css.tools },
    { label: t('diagnostics.messages'), tokens: breakdown.messageTokens, color: css.messages },
  ]
  const total = parts.reduce((sum, part) => sum + part.tokens, 0)
  const requestLabel = (turn: number, step: number): string => t('diagnostics.request', { turn, step })

  const loadEarlier = async (): Promise<void> => {
    setLoadState('loading')
    try {
      await loadOlder()
      setLoadState('idle')
    } catch (_error) {
      // Session paging owns the failure; the dialog keeps its loaded data and retry action.
      setLoadState('error')
    }
  }

  return (
    <Modal open onClose={onClose} title={t('diagnostics.open')} closeLabel={t('details.close')}
      className={clsx(css.dialog)} contentClassName={clsx(css.content)}>
      <div className={css.body}>
        <dl className={css.figures}>
          <div>
            <dt>{t('diagnostics.occupancy')}</dt>
            <dd>{used === undefined ? '—' : `~${number(used)}`}
              {occupancy !== undefined && <span className={css.secondary}>{`${occupancy}%`}</span>}
            </dd>
          </div>
          <div>
            <dt>{t('diagnostics.capacity')}</dt>
            <dd>{number(capacity)}</dd>
          </div>
        </dl>
        <section aria-label={t('diagnostics.composition')}>
          <h3>{t('diagnostics.composition')}</h3>
          {breakdown === undefined ? <p className={css.secondary}>{t('diagnostics.unknown')}</p> : <>
            <div className={css.composition} aria-hidden="true">
              {parts.filter(part => part.tokens > 0).map(part => (
                <span key={part.label} className={part.color} style={{ width: `${part.tokens / total * 100}%` }} />
              ))}
            </div>
            <dl className={css.legend}>
              {parts.map(part => <div key={part.label}>
                <dt><span className={`${css.swatch} ${part.color}`} aria-hidden="true" />{part.label}</dt>
                <dd>{`~${number(part.tokens)}`}</dd>
              </div>)}
            </dl>
          </>}
        </section>
        <p className={css.note}>{t('diagnostics.note')}</p>
        <section aria-label={t('diagnostics.history')}>
          <div className={css.sectionHeader}>
            <h3>{t('diagnostics.history')}</h3>
            {hasMore && <span className={css.secondary}>{t('diagnostics.partial')}</span>}
          </div>
          {metrics.length === 0 ? <p className={css.secondary}>{t('diagnostics.noRequests')}</p> : (
            <div className={css.tableScroll} tabIndex={0} role="region" aria-label={t('diagnostics.history')}>
              <table className={css.table}>
                <thead><tr>
                  <th scope="col">{t('diagnostics.requestColumn')}</th>
                  <th scope="col">{t('column.model')}</th>
                  <th scope="col">{t('usage.input')}</th>
                  <th scope="col">{t('diagnostics.delta')}</th>
                  <th scope="col">{t('diagnostics.cache')}</th>
                  <th scope="col">{t('usage.output')}</th>
                </tr></thead>
                <tbody>{metrics.map(metric => (
                  <tr key={metric.request.startSeq} data-selected={metric === selected || undefined}>
                    <th scope="row"><button type="button" className={css.select}
                      aria-pressed={metric === selected} onClick={() => { setSelectedSeq(metric.request.startSeq) }}>
                      {requestLabel(metric.request.turn, metric.request.step)}
                    </button></th>
                    <td><span className={css.model}>{metric.model ?? '—'}</span></td>
                    <td><span className={css.mobileLabel} aria-hidden="true">{t('usage.input')}</span><span>{number(metric.input)}</span>
                      {metric.input !== undefined && <span className={css.inputBar} aria-hidden="true"
                        style={{ width: `${metric.input / largestInput * 100}%` }} />}
                    </td>
                    <td><span className={css.mobileLabel} aria-hidden="true">{t('diagnostics.delta')}</span>
                      <span>{metric.delta === undefined ? '—' : `${metric.delta > 0 ? '+' : ''}${number(metric.delta)}`}</span></td>
                    <td><span className={css.mobileLabel} aria-hidden="true">{t('diagnostics.cache')}</span>
                      <span>{metric.cacheRatio === undefined ? '—' : `${Math.round(metric.cacheRatio * 100)}%`}</span></td>
                    <td><span className={css.mobileLabel} aria-hidden="true">{t('usage.output')}</span><span>{number(metric.output)}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {hasMore && <Button variant="ghost" size="sm" disabled={loadState === 'loading'}
            aria-busy={loadState === 'loading'} onClick={() => { void loadEarlier() }}>
            {t('history.loadEarlier')}
          </Button>}
          {loadState === 'error' && <p className={css.error} role="alert">{t('diagnostics.loadFailed')}</p>}
        </section>
        {selected !== undefined && <section aria-label={t('diagnostics.tools')}>
          <h3>{t('diagnostics.catalog', { request: requestLabel(selected.request.turn, selected.request.step) })}</h3>
          {selected.request.prompt === undefined
            ? <p className={css.secondary}>{t('diagnostics.noCatalog')}</p>
            : tools.length === 0
              ? <p className={css.secondary}>{t('diagnostics.noTools')}</p>
              : <ol className={css.toolList}>
                {tools.map(({ tool, tokens }) => <li key={tool.name}>
                  <span className={css.toolName}>{tool.name}</span>
                  <span className={css.secondary}>{t('unit.tokens', { value: `~${number(tokens)}` })}</span>
                </li>)}
              </ol>}
        </section>}
      </div>
    </Modal>
  )
}
