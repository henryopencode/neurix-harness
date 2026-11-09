/** Archived Session deletion menu entry and its global confirmation dialog. */
import { useState } from 'react'
import { Button, IconTrashOutlineRegular, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected, SessionDeleteDialogProps, SessionDeleteTarget, SessionMenuItemProps,
} from '../contract/slots.ts'
import css from '../rows/WorkspaceBrowser.module.css'

/**
 * Offer permanent deletion only for an archived Session the caller may delete.
 * @param props - row identity, membership, access, menu, locale, and confirmation callback.
 * @returns the destructive menu row, or nothing for an ineligible Session.
 */
export function DeleteSessionMenuItem({
  sessionId, displayTitle, useArchived, useSessionAccess, useMenuOpenState, requestSessionDelete, t,
}: SessionMenuItemProps<DeleteSessionInjected>) {
  const archived = useArchived(ids => ids.has(sessionId))
  const allowed = useSessionAccess(sessionId, 'workspace/deleteSession')
  const [, setMenuOpen] = useMenuOpenState()
  if (!archived || !allowed) return null
  return (
    <MenuItemButton danger separatorBefore icon={<IconTrashOutlineRegular size={14} />} onSelect={() => {
      setMenuOpen(false)
      requestSessionDelete(sessionId, displayTitle)
    }}>
      {t('menu.deleteSession')}
    </MenuItemButton>
  )
}

/**
 * Confirm irreversible deletion while keeping pending state outside the row menu.
 * @param props - pending request, settlement, deletion callback, and locale seat.
 * @returns a confirmation dialog, or nothing without a pending request.
 */
export function SessionDeleteDialog({ useDeleteRequest, settleSessionDelete, deleteSession, t }: SessionDeleteDialogProps) {
  const request = useDeleteRequest(value => value)
  if (request === null) return null
  return <DeleteForm
    key={request.sessionId} request={request} settleSessionDelete={settleSessionDelete} deleteSession={deleteSession} t={t}
  />
}

/** One request owns its pending state until it is cancelled or deletion settles. */
function DeleteForm({ request, settleSessionDelete, deleteSession, t }: {
  request: SessionDeleteTarget
  settleSessionDelete: SessionDeleteDialogProps['settleSessionDelete']
  deleteSession: SessionDeleteDialogProps['deleteSession']
  t: SessionDeleteDialogProps['t']
}) {
  const [pending, setPending] = useState(false)
  const close = () => { if (!pending) settleSessionDelete() }
  const confirm = () => {
    if (pending) return
    setPending(true)
    deleteSession(request.sessionId).then(() => {
      setPending(false)
      settleSessionDelete()
    }).catch((_error: unknown) => {
      // The injected callback reports failures through the global Toast; keep this request retryable.
      setPending(false)
    })
  }
  return (
    <Modal open onClose={close} closeLabel={t('close')} title={t('delete.session.title')}
      description={t('delete.session.desc', { title: request.displayTitle })}
      footer={<>
        <Button variant="outline" disabled={pending} onClick={close}>{t('cancel')}</Button>
        <Button variant="outline" className={css.deleteAction} disabled={pending} aria-busy={pending} onClick={confirm}>
          {t('delete.session.action')}
        </Button>
      </>}
    />
  )
}
