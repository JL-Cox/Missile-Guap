import { CHANGES } from '../lib/changelog';
import { shortDate } from '../lib/time';
import { APP_VERSION, BUILD_ID, RECENT_COMMITS, versionLabel } from '../lib/version';
import { cutTitle } from '../lib/sections';
import { Section } from '../components/ui';

/**
 * Which version this is, and what changed.
 *
 * Opened from Settings. Everything on it was written into the app when it was
 * built, so there is nothing to load and nothing to check online - it looks the
 * same in airplane mode.
 */
export default function About({ onBack }: { onBack: () => void }) {
  // The newest few entries up to this build: enough to explain this week's
  // changes without turning the page into a history lesson, and never one for
  // a version this copy of the app does not have yet.
  const changes = CHANGES.filter((c) => APP_VERSION === null || c.version <= APP_VERSION).slice(0, 3);

  return (
    <>
      <div className="btn-row">
        <button type="button" className="btn btn-sm" onClick={onBack}>
          Back to Settings
        </button>
      </div>

      <Section title="Steady">
        <div className="card stack-sm">
          <div className="figure">
            <span className="item-title">{versionLabel()}</span>
            {APP_VERSION !== null && BUILD_ID !== 'dev' && <span className="figure-value faint">Build {BUILD_ID}</span>}
          </div>
          <p className="faint">
            {APP_VERSION === null
              ? 'This copy was built without its history, so it has no number.'
              : 'The number goes up by one with every change to the app, counting from the very first.'}
          </p>
        </div>
      </Section>

      <Section title="What's new">
        {changes.map((entry) => (
          <div key={entry.version} className="card stack-sm">
            <h3>
              Version {entry.version}
              {entry.version === APP_VERSION && <span className="faint"> (this one)</span>}
            </h3>
            <ul className="plain-list stack-sm">
              {entry.items.map((item) => (
                <li key={item} className="small">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      {/* Reference, folded away on every visit so the page opens on what's new. */}
      <Section
        title="Last 10 updates"
        collapsible="about.updates"
        summary={
          RECENT_COMMITS.length === 0
            ? 'Not included in this copy'
            : `Newest: ${cutTitle(RECENT_COMMITS[0].subject)}`
        }
      >
        {RECENT_COMMITS.length === 0 ? (
          <p className="faint">This copy was built without its history, so there is no list to show.</p>
        ) : (
          <ol className="card stack-sm update-list" aria-label="Last 10 updates, newest first">
            {RECENT_COMMITS.map((commit, i) => (
              <li key={`${commit.date}-${i}`}>
                <span className="small">{commit.subject}</span>
                <span className="faint">{shortDate(commit.date)}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="faint">
          The notes written with each change to the app's code, newest first. They were written into the app when
          it was built; opening this page does not go online.
        </p>
      </Section>
    </>
  );
}
