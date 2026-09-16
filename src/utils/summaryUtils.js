const { normalizeWhitespace, escapeHtml } = require('./textUtils');

const summaryInstruction = [
    'Erstelle zusätzlich summary_points als sehr kurze Zusammenfassung des fertigen Artikels auf Schweizer Hochdeutsch.',
    'Verwende bevorzugt 2 bis 4 Aufzählungspunkte, mindestens 1 und höchstens 5.',
    'Ein Punkt genügt bei sehr kurzen Meldungen mit nur einer Kernaussage. Fünf Punkte sind nur bei längeren Artikeln mit entsprechend vielen wichtigen Fakten sinnvoll.',
    'Jeder Punkt enthält einen kurzen, sachlichen Satz, möglichst höchstens 25 Wörter und maximal 240 Zeichen.',
    'Nenne nur die wichtigsten konkreten Fakten für die Immobilienbranche, wichtigste Nachricht zuerst. Keine Wiederholungen, Werbung, Einleitung oder Schlussformel.',
    'Alle Aussagen, Namen und Zahlen müssen im fertigen Artikel einschliesslich Titel und Lead belegt sein. Erfinde nichts und erhalte Unsicherheiten wie geplant oder voraussichtlich.',
    'Jeder Array-Eintrag ist reiner Text ohne HTML, Markdown oder vorangestelltes Aufzählungszeichen.',
    'Die Zusammenfassung ist ein separates Zusatzfeld. Füge sie nicht in content_html, Titel oder Lead ein.'
].join(' ');

function buildSummarySchema() {
    return {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 240 },
        minItems: 1,
        maxItems: 5
    };
}

function normalizeSummaryPoints(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
        throw new Error('OpenAI-Zusammenfassung muss 1 bis 5 Aufzählungspunkte enthalten.');
    }

    const points = value.map((point) => {
        if (typeof point !== 'string') {
            throw new Error('OpenAI-Zusammenfassung enthält einen ungültigen Aufzählungspunkt.');
        }
        const normalized = normalizeWhitespace(point);
        if (!normalized || normalized.length > 240) {
            throw new Error('OpenAI-Zusammenfassung enthält einen leeren oder zu langen Aufzählungspunkt.');
        }
        return normalized;
    });

    if (new Set(points.map((point) => point.toLocaleLowerCase('de-CH'))).size !== points.length) {
        throw new Error('OpenAI-Zusammenfassung enthält doppelte Aufzählungspunkte.');
    }
    return points;
}

function buildSummaryHtml(points) {
    return `<ul>\n${normalizeSummaryPoints(points).map((point) => `<li>${escapeHtml(point)}</li>`).join('\n')}\n</ul>`;
}

module.exports = { summaryInstruction, buildSummarySchema, normalizeSummaryPoints, buildSummaryHtml };
