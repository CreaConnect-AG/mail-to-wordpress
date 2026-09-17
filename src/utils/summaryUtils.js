const { normalizeWhitespace, escapeHtml } = require('./textUtils');

const maximumSummaryPoints = 4;
const maximumSummaryPointLength = 100;

const summaryInstruction = [
    'Erstelle zusätzlich summary_points als sehr kurze Zusammenfassung des fertigen Artikels auf Schweizer Hochdeutsch.',
    `Verwende bevorzugt 2 bis 3 Aufzählungspunkte, mindestens 1 und höchstens ${maximumSummaryPoints}.`,
    'Ein Punkt genügt bei sehr kurzen Meldungen mit nur einer Kernaussage. Vier Punkte sind nur bei entsprechend vielen wichtigen Fakten sinnvoll. Fülle die Liste nicht künstlich auf.',
    `Jeder Punkt enthält genau einen kurzen, sachlichen Satz mit einer Kernaussage. Ziele auf ungefähr 8 bis 12 Wörter, bei maximal ${maximumSummaryPointLength} Zeichen inklusive Leerzeichen und Satzzeichen. Kürzere Sätze sind willkommen.`,
    'Schreibe direkt und möglichst aktiv. Vermeide Nebensatzketten, Klammerzusätze, Semikolons und mehrere aneinandergereihte Aussagen. Lass Hintergrunddetails weg.',
    'Kürze durch präzises Neuformulieren, niemals durch Abschneiden eines Satzes oder Weglassen sachlich notwendiger Einschränkungen. Vollständige Namen und wichtige Zahlen müssen korrekt bleiben; verzichte bei Platzmangel auf einen weniger wichtigen Aspekt.',
    'Stilbeispiele, keine Fakten für den aktuellen Artikel: «In Baden sind 40 neue Wohnungen geplant.» «Der Baustart ist für Herbst 2027 vorgesehen.»',
    'Nenne nur die wichtigsten konkreten Fakten für die Immobilienbranche, wichtigste Nachricht zuerst. Keine Wiederholungen, Werbung, Einleitung oder Schlussformel.',
    'Alle Aussagen, Namen und Zahlen müssen im fertigen Artikel einschliesslich Titel und Lead belegt sein. Erfinde nichts und erhalte Unsicherheiten wie geplant oder voraussichtlich.',
    'Jeder Array-Eintrag ist reiner Text ohne HTML, Markdown oder vorangestelltes Aufzählungszeichen.',
    'Die Zusammenfassung ist ein separates Zusatzfeld. Füge sie nicht in content_html, Titel oder Lead ein.'
].join(' ');

function buildSummarySchema() {
    return {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: maximumSummaryPointLength },
        minItems: 1,
        maxItems: maximumSummaryPoints
    };
}

function normalizeSummaryPoints(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > maximumSummaryPoints) {
        throw new Error(`OpenAI-Zusammenfassung muss 1 bis ${maximumSummaryPoints} Aufzählungspunkte enthalten.`);
    }

    const points = value.map((point) => {
        if (typeof point !== 'string') {
            throw new Error('OpenAI-Zusammenfassung enthält einen ungültigen Aufzählungspunkt.');
        }
        const normalized = normalizeWhitespace(point);
        if (!normalized || Array.from(normalized).length > maximumSummaryPointLength) {
            throw new Error(`OpenAI-Zusammenfassung enthält einen leeren oder zu langen Aufzählungspunkt (maximal ${maximumSummaryPointLength} Zeichen).`);
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
