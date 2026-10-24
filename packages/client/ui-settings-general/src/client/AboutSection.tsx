/** Product identity, release metadata, and project links in Settings. */
import { FishLogo, LinkIconRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FeedbackIcon } from './FeedbackIcon.tsx'
import css from './AboutSection.module.css'

/** Settings supplies the section lifecycle and localized product copy. */
export type AboutSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings'>

const REPOSITORY = 'https://github.com/henryopencode/neurix-harness'
const LICENSE = 'MIT'

/**
 * Display client build metadata and project links.
 * @param props - Settings section and locale props.
 * @returns product information with links to its source, feedback, and license.
 */
export function AboutSection({ t }: AboutSectionProps) {
  const version = process.env.DSH_CLIENT_VERSION ?? t('about.unavailable')
  const commit = process.env.DSH_CLIENT_COMMIT_HASH ?? t('about.unavailable')
  const build = process.env.DSH_CLIENT_BUILD_PROFILE === 'official' ? t('about.release') : t('about.development')
  const modified = process.env.DSH_CLIENT_GIT_DIRTY === 'true'
  const buildLabel = modified ? `${build} · ${t('about.modified')}` : build
  return (
    <section className={css.section} data-about-page aria-label={t('about.nav')}>
      <header className={css.header}>
        <FishLogo size={36} />
        <div>
          <h2 className={css.title}>{t('about.product')}</h2>
          <p className={css.description}>{t('about.description')}</p>
        </div>
      </header>
      <dl className={css.details}>
        <div className={css.row}><dt>{t('about.version')}</dt><dd>{version}</dd></div>
        <div className={css.row}><dt>{t('about.commit')}</dt><dd>{commit}</dd></div>
        <div className={css.row}><dt>{t('about.build')}</dt><dd>{buildLabel}</dd></div>
        <div className={css.row}>
          <dt>{t('about.license')}</dt>
          <dd><a href={`${REPOSITORY}/blob/master/LICENSE`} target="_blank" rel="noopener noreferrer">{LICENSE}</a></dd>
        </div>
      </dl>
      <nav className={css.links} aria-label={t('about.links')}>
        <Tooltip label={t('about.repository')} side="top" portal>
          <a className={css.iconLink} href={REPOSITORY} target="_blank" rel="noopener noreferrer" aria-label={t('about.repository')}>
            <LinkIconRegular kind="url" href={REPOSITORY} size={20} />
          </a>
        </Tooltip>
        <Tooltip label={t('about.feedback')} side="top" portal>
          <a className={css.iconLink} href={`${REPOSITORY}/issues`} target="_blank" rel="noopener noreferrer" aria-label={t('about.feedback')}>
            <FeedbackIcon />
          </a>
        </Tooltip>
      </nav>
    </section>
  )
}
