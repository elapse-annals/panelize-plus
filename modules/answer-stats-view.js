// Answer stats dialog: formatting and the per-provider table. Text and
// provider names come from the caller so this module has no page globals.

export function createCell(tagName, text, className = '') {
  const cell = document.createElement(tagName);
  cell.textContent = text;
  if (className) {
    cell.className = className;
  }
  return cell;
}

export function formatAnswerDuration(ms) {
  if (!Number.isFinite(ms)) {
    return '—';
  }
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatEngagedDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '—';
  }
  if (ms < 1000) {
    return '<1 s';
  }
  return ms < 60000 ? `${Math.round(ms / 1000)} s` : `${(ms / 60000).toFixed(1)} min`;
}

export function formatAnswerTiming(medianMs, averageMs) {
  if (!Number.isFinite(medianMs)) {
    return '—';
  }
  return `${formatAnswerDuration(medianMs)} (${formatAnswerDuration(averageMs)})`;
}

export function formatAnswerScore(score) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

/**
 * Replaces the rows of `tbody` with one row per aggregated provider entry.
 *
 * @param {HTMLTableSectionElement} tbody
 * @param {Array<object>} stats Entries from aggregateAnswerStats.
 * @param {{ getText: (key: string, fallback: string, substitutions?: string[]) => string, getProviderName: (providerId: string) => string }} options
 */
export function renderAnswerStatsTable(tbody, stats, { getText, getProviderName }) {
  const notMeasured = getText('answerStatsNotMeasured', 'Not measured');
  const rows = stats.map(entry => {
    const row = document.createElement('tr');
    const firstOutput = createCell('td', entry.timed
      ? formatAnswerTiming(entry.medianFirstOutputMs, entry.avgFirstOutputMs)
      : '—', 'numeric');
    const complete = createCell('td', entry.timed
      ? formatAnswerTiming(entry.medianCompleteMs, entry.avgCompleteMs)
      : '—', 'numeric');
    if (!entry.timed) {
      firstOutput.title = notMeasured;
      complete.title = notMeasured;
    }

    row.append(
      createCell('td', getProviderName(entry.providerId), 'answer-stats-provider'),
      createCell('td', String(entry.rounds), 'numeric'),
      firstOutput,
      complete,
      createCell('td', entry.timed ? String(entry.timeoutCount) : '—', 'numeric'),
      createCell('td', String(entry.adoptedCount), 'numeric'),
      createCell('td', entry.adoptionRate === null
        ? '—'
        : `${Math.round(entry.adoptionRate * 100)}%`, 'numeric'),
      createCell('td', formatEngagedDuration(entry.activeMs), 'numeric'),
      createCell('td', formatAnswerScore(entry.recentScore), 'numeric'),
      createCell('td', formatAnswerScore(entry.olderScore), 'numeric'),
      createCell('td', formatAnswerScore(entry.score), 'numeric answer-stats-score')
    );
    return row;
  });
  tbody.replaceChildren(...rows);
}
