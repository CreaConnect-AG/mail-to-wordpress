const {
    openAiApiKey,
    openAiModel,
    openAiOriginalModel,
    openAiImageModel,
    openAiImageSize,
    openAiImageQuality,
    openAiImageOutputFormat,
    enableOpenAiWebSearch,
    openAiWebSearchContextSize,
    openAiWebSearchBlockedDomains
} = require('../config/environment');

const {
    maximumTitleLength,
    minimumExcerptLength,
    maximumExcerptLength,
    minimumContentTextLength,
    maximumContentHtmlLength,
    minimumSourceTextLengthForStrictRules,
    minimumSelectedCategoryCount,
    minimumRequestedCategoryCountFromAi,
    maximumRequestedCategoryCountFromAi,
    minimumThematicKeywordCount,
    maximumRequestedKeywordCountFromAi,
    fixedKeywordNames
} = require('../config/contentRules');

const {
    htmlToPlainText,
    normalizeGeneratedHtml,
    truncateToLength,
    normalizeComparisonText,
    sanitizeSlug,
    normalizeWhitespace,
    escapeHtml
} = require('../utils/textUtils');

const {
    getAllowedCategoryKeysForSchemaEnum,
    getAllowedTopicCategoryKeysForSchemaEnum,
    getAllowedCategoryOptionsForAi,
    resolveSelectedCategories,
    resolveBestCategory,
    normalizeSelectedCategoryKeys,
    normalizeBestCategoryKey
} = require('./taxonomyService');

const {
    normalizeAiKeywordNames,
    resolveKeywordNames
} = require('./keywordService');

const midjourneyPromptEnding = '--ar 2:1 --q 2 --no logos, text, cartoon';

async function rewriteMailWithOpenAi({ subject, from, sourceText, additionalInstructions = '' }) {
    const useStrictLengthRules = shouldUseStrictLengthRules(sourceText);

    const firstAttempt = await requestOpenAiRewrite({
        subject,
        from,
        sourceText,
        additionalInstructions,
        forceStrongRewrite: false,
        useStrictLengthRules
    });

    const normalizedFirstAttempt = normalizeGeneratedPost(firstAttempt, useStrictLengthRules);
    const enrichedFirstAttempt = tryAttachResolvedKeywords(
        tryAttachResolvedCategories(normalizedFirstAttempt)
    );

    const firstValidationErrors = buildRewriteValidationErrors({
        originalSubject: subject,
        sourceText,
        rewrittenPost: enrichedFirstAttempt,
        useStrictLengthRules,
        includeEditorialFocusValidation: true
    });

    if (!needsSecondRewriteAttempt(firstValidationErrors)) {
        return enrichedFirstAttempt;
    }

    const secondAttempt = await requestOpenAiRewrite({
        subject,
        from,
        sourceText,
        additionalInstructions,
        forceStrongRewrite: true,
        useStrictLengthRules,
        rewriteFeedback: firstValidationErrors
    });

    const normalizedSecondAttempt = normalizeGeneratedPost(secondAttempt, useStrictLengthRules);
    const enrichedSecondAttempt = attachResolvedKeywords(
        attachResolvedCategories(normalizedSecondAttempt)
    );

    const secondValidationErrors = buildRewriteValidationErrors({
        originalSubject: subject,
        sourceText,
        rewrittenPost: enrichedSecondAttempt,
        useStrictLengthRules,
        includeEditorialFocusValidation: false
    });

    if (secondValidationErrors.length > 0) {
        throw new Error(secondValidationErrors[0]);
    }

    return enrichedSecondAttempt;
}

async function prepareOriginalMailWithOpenAi({ subject, from, sourceText }) {
    const preparedOriginalMail = await requestOpenAiOriginalMailPreparation({
        subject,
        from,
        sourceText
    });

    const normalizedOriginalPost = normalizeOriginalMailPost({
        parsedResponse: preparedOriginalMail,
        subject,
        sourceText
    });

    return attachResolvedKeywords(
        attachResolvedCategories(normalizedOriginalPost)
    );
}

function shouldUseStrictLengthRules(sourceText) {
    return normalizeWhitespace(sourceText).length >= minimumSourceTextLengthForStrictRules;
}

async function requestOpenAiRewrite({
    subject,
    from,
    sourceText,
    additionalInstructions = '',
    forceStrongRewrite,
    useStrictLengthRules,
    rewriteFeedback = []
}) {
    const developerInstruction = buildDeveloperInstruction({
        forceStrongRewrite,
        useStrictLengthRules,
        rewriteFeedback
    });

    const responseSchema = buildResponseSchema({
        useStrictLengthRules
    });

    const requestPayload = {
        model: openAiModel,
        input: [
            {
            role: 'developer',
            content: [
                {
                type: 'input_text',
                text: developerInstruction
                }
            ]
            },
            {
            role: 'user',
            content: [
                {
                type: 'input_text',
                text: JSON.stringify(
                    {
                        current_date: getCurrentSwissDateText(),
                        current_timezone: 'Europe/Zurich',
                        subject,
                        from,
                        source_text: sourceText,
                        additional_instructions: normalizeAdditionalInstructionsForPrompt(additionalInstructions),
                        allowed_category_options: getAllowedCategoryOptionsForAi()
                    },
                    null,
                    2
                )
                }
            ]
            }
        ],
        text: {
            format: {
            type: 'json_schema',
            name: 'wordpress_post',
            strict: true,
            schema: responseSchema
            }
        }
    };

    if (enableOpenAiWebSearch) {
        requestPayload.tools = [buildWebSearchTool()];
        requestPayload.tool_choice = 'required';
        requestPayload.include = ['web_search_call.action.sources'];
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openAiApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI Fehler ${response.status}: ${errorText}`);
    }

    const responseBody = await response.json();
    const outputText = extractOutputText(responseBody);

    if (!outputText) {
        throw new Error('OpenAI hat keinen auswertbaren Text zurückgegeben.');
    }

    try {
        return JSON.parse(outputText);
    } catch (error) {
        throw new Error(`OpenAI hat kein valides JSON geliefert. Rohtext: ${outputText}`);
    }
}

async function requestOpenAiOriginalMailPreparation({ subject, from, sourceText }) {
    const requestPayload = {
        model: openAiOriginalModel,
        input: [
            {
                role: 'developer',
                content: [
                    {
                        type: 'input_text',
                        text: buildOriginalMailDeveloperInstruction()
                    }
                ]
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: JSON.stringify(
                            {
                                subject,
                                from,
                                source_text: sourceText,
                                allowed_category_options: getAllowedCategoryOptionsForAi()
                            },
                            null,
                            2
                        )
                    }
                ]
            }
        ],
        text: {
            format: {
                type: 'json_schema',
                name: 'original_wordpress_post',
                strict: true,
                schema: buildOriginalMailResponseSchema()
            }
        }
    };

    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openAiApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI Fehler ${response.status}: ${errorText}`);
    }

    const responseBody = await response.json();
    const outputText = extractOutputText(responseBody);

    if (!outputText) {
        throw new Error('OpenAI hat keinen auswertbaren Text zurückgegeben.');
    }

    try {
        return JSON.parse(outputText);
    } catch (error) {
        throw new Error(`OpenAI hat kein valides JSON geliefert. Rohtext: ${outputText}`);
    }
}

function buildWebSearchTool() {
    const webSearchTool = {
        type: 'web_search',
        search_context_size: normalizeWebSearchContextSize(openAiWebSearchContextSize),
        external_web_access: true,
        user_location: {
            type: 'approximate',
            country: 'CH'
        }
    };

    const blockedDomains = normalizeDomainList(openAiWebSearchBlockedDomains);

    if (blockedDomains.length > 0) {
        webSearchTool.filters = {
            blocked_domains: blockedDomains
        };
    }

    return webSearchTool;
}

function normalizeWebSearchContextSize(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();

    if (['low', 'medium', 'high'].includes(normalizedValue)) {
        return normalizedValue;
    }

    return 'medium';
}

function normalizeDomainList(domainList) {
    if (!Array.isArray(domainList)) {
        return [];
    }

    return domainList
    .map((domain) => String(domain || '').trim().toLowerCase())
    .map((domain) => domain.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);
}

function getCurrentSwissDateText() {
    return new Intl.DateTimeFormat('de-CH', {
        timeZone: 'Europe/Zurich',
        year: 'numeric',
        month: 'long',
        day: '2-digit'
    }).format(new Date());
}

function buildDeveloperInstruction({
    forceStrongRewrite,
    useStrictLengthRules,
    rewriteFeedback = []
}) {
    const currentDateText = getCurrentSwissDateText();

    const instructionSections = [
        `# Rolle und Ziel
        Du bist Redaktor für immo!nvest, eine Schweizer Fachplattform für Immobilien, Bau, Standortentwicklung, Technologie, Nachhaltigkeit und Wirtschaft.
        Der fertige Beitrag muss wie ein kompakter redaktioneller Fachartikel wirken.
        Er soll eine klare These haben, konkrete Entwicklungen sichtbar machen und für die Immobilien-, Bau- oder Standortbranche relevant sein.
        Schreibe nicht wie ein Research-Kommentar, nicht wie eine Marktanalyse und nicht wie eine Medienmitteilung.`,

        `# Ausgangslage
        Die gelieferte E-Mail ist nur der Ausgangspunkt für Recherche, Einordnung und Beitragserstellung.
        Nutze die E-Mail, um relevante Themen, Firmen, Projekte, Orte, Personen, Daten, Zahlen, Entwicklungen und mögliche Nachrichtenwerte zu erkennen.
        Erstelle keinen blossen Rewrite und keine sprachlich umformulierte Version der E-Mail.`,

        `# Nachrichtenkern und Themenbindung
        Bestimme vor der Recherche den zentralen Nachrichtenkern des Inputs in einem Satz.
        Dieser Nachrichtenkern muss auch nach der Web-Recherche erkennbar erhalten bleiben.
        Die Web-Recherche darf den Beitrag ergänzen, aktualisieren, einordnen und zuspitzen, aber sie darf den Beitrag nicht auf ein anderes Hauptthema verschieben.
        Neue Rechercheaspekte dürfen nur zum Hauptfokus werden, wenn sie denselben Kern direkt betreffen, etwa dieselbe Firma, dasselbe Projekt, dieselbe Regulierung, denselben Standort, denselben Marktmechanismus oder dieselbe konkrete Immobilienwirkung.
        Allgemein passende Immobilien-, Finanzierungs-, Politik- oder Marktthemen reichen nicht aus, wenn sie den Nachrichtenkern des Inputs nicht direkt stützen.
        Wenn der Input mehrere Themen enthält, darf ein Schwerpunkt gewählt werden. Der Auslöser der Meldung darf dabei aber nicht umgedeutet werden.
        Ein politischer, regulatorischer oder marktbezogener Kontext darf eine Unternehmensmeldung einordnen, aber nicht fälschlich als Grund für eine Kapitalmassnahme, Entscheidung oder Entwicklung dargestellt werden, wenn dies aus Input und Recherche nicht hervorgeht.`,

        `# Web-Recherche und Aktualität
        Aktuelles Datum für Recherche und Einordnung: ${currentDateText}.
        Führe verpflichtend eine Web-Recherche durch, bevor du den Beitrag schreibst.
        Die Web-Recherche muss die aktuelle Informationslage zu diesem Datum berücksichtigen.
        Suche bevorzugt nach aktuellen, verlässlichen Quellen und prüfe, ob Informationen noch gültig sind.
        Achte bei Quellen auf Veröffentlichungsdatum, Aktualisierungsdatum und erkennbare Aktualität.
        Verwende keine alten Informationen als aktuelle Fakten, wenn neuere Quellen verfügbar sind.
        Ältere Quellen dürfen nur für Hintergrundinformationen, Historie oder unveränderte Fakten verwendet werden.
        Wenn sich ältere und neuere Quellen widersprechen, verwende die neuere und verlässlichere Quelle oder formuliere die Unsicherheit klar.
        Bevorzuge offizielle Quellen, Unternehmensseiten, Projektseiten, Behörden, Handelsregister, Medienmitteilungen, seriöse Medien, Branchenquellen und belastbare Marktdaten.
        Nutze keine Foren, Social-Media-Posts, Reddit, Quora oder Wikipedia als Hauptquelle.
        Prüfe Aussagen aus der E-Mail anhand der Web-Recherche, bevor du sie als Tatsache verwendest.
        Neue Fakten aus dem Web dürfen nur verwendet werden, wenn sie durch eine verlässliche Quelle gestützt sind.
        Wenn Angaben aus der E-Mail im Web nicht verifiziert werden können, formuliere sie vorsichtig oder lasse sie weg.
        Nutze Web-Recherche nicht, um den Beitrag möglichst breit zu machen, sondern um den stärksten redaktionellen Kern zu prüfen, zu konkretisieren und zu verdichten.
        Zusätzliche Rechercheaspekte dürfen den Beitrag nur dann prägen, wenn sie den Nachrichtenkern direkt schärfen, eine konkrete Folge erklären oder eine wichtige Zahl, Entscheidung, Projektentwicklung oder Regulierung belegen.
        Wenn keine aktuellen belastbaren Webinformationen gefunden werden, schreibe keinen scheinbar aktuellen Beitrag, sondern formuliere zurückhaltend.
        Wenn die Web-Recherche keine belastbaren Zusatzinformationen liefert, schreibe einen eigenständigen Beitrag auf Basis des Inputs, aber ohne ungesicherte Zusatzdetails.
        Der Beitrag soll den Stand der recherchierten Informationen zum aktuellen Datum widerspiegeln.`,

        `# Redaktionelle Eigenständigkeit
        Titel, Auszug und Inhalt müssen eigenständig neu formuliert werden.
        Der Text darf nicht 1:1 oder nahezu 1:1 aus dem Input übernommen werden.
        Baue den Beitrag redaktionell eigenständig auf und übernimm nicht einfach Struktur, Reihenfolge, Absatzlogik oder Argumentationsfolge der Vorlage.
        Beginne den Beitrag mit dem wichtigsten redaktionellen Ergebnis der Recherche, nicht zwingend mit dem ersten Punkt aus der E-Mail.
        Verwende nach Möglichkeit einen anderen Einstieg als die Vorlage.
        Übernimm nicht bloss einzelne Sätze in leicht veränderter Form, sondern strukturiere, verdichte, prüfe, ergänze und formuliere den Inhalt redaktionell neu.
        Vermeide auffällige Formulierungsmuster, Satzanfänge und Standardwendungen aus der Vorlage und ersetze sie durch eigenständige journalistische Formulierungen.
        Wenn der Input zu kurz ist, nutze die Web-Recherche für sinnvollen Kontext, aber fülle den Beitrag nicht künstlich mit irrelevanten Informationen auf.`,

        `# immo!nvest Redaktionsstil
        Schreibe kompakt, konkret und mit klarer redaktioneller Linie.
        Der Beitrag soll nicht wie eine vollständige Analyse aller verfügbaren Informationen wirken, sondern wie ein fokussierter Fachartikel.
        Beginne möglichst mit einem konkreten Anker: einem Ort, einer Zahl, einem Projekt, einem Entscheid, einem Konflikt, einer technischen Lösung oder einer sichtbaren Veränderung.
        Vermeide Einstiege, die nur allgemein erklären, warum ein Thema relevant ist.
        Zeige Relevanz durch konkrete Wirkung.
        Schreibe nicht abstrakt, dass etwas «für die Immobilienwirtschaft relevant» ist, sondern zeige, was sich für Areale, Projekte, Gebäude, Bauherrschaften, Eigentümer, Entwickler, Investoren, Behörden, Nutzer, Mieter, Verfahren, Finanzierung oder Regulierung verändert.
        Der Text darf pointiert sein, bleibt aber sachlich.
        Verwende klare Folgesätze, wenn sie aus den Fakten entstehen, etwa: Der Markt wird enger. Die Verfahren bleiben anspruchsvoll. Die Regulierung zieht an. Das Projekt macht Verdichtung sichtbar.
        Vermeide boulevardeske Zuspitzung, aber schreibe nicht unnötig vorsichtig, wenn die Fakten klar sind.`,

        `# Redaktioneller Fokus
        Entscheide vor dem Schreiben, welcher einzelne redaktionelle Kern den Beitrag trägt. Der Beitrag soll aus einer klaren Hauptaussage heraus entstehen, nicht aus einer vollständigen Abarbeitung aller Informationen im Input.
        Nutze weitere Informationen nur, wenn sie die Hauptaussage erklären, belegen, einordnen oder für die Zielgruppe relevant machen. Lasse Nebenaspekte weg, wenn sie zwar interessant sind, aber den Beitrag thematisch verbreitern, ohne den Kern zu stärken.
        Der Artikel soll nach dem Lesen in einem Satz zusammenfassbar sein. Titel, Auszug, Einstieg, Zwischentitel und Schluss müssen auf denselben redaktionellen Kern einzahlen.
        Wenn der Input mehrere mögliche Themen enthält, wähle den stärksten Nachrichtenwert. Bevorzuge den Aspekt, der aktuell, überprüfbar, konkret und für die Zielgruppe am relevantesten ist.
        Die Zielgruppe ist eine professionelle Schweizer Immobilien-Website. Stelle den Bezug zur Immobilienwirtschaft, zum Immobilienmarkt, zu Bau, Planung, Finanzierung, Nutzung, Bewirtschaftung, Unternehmen oder Standortentwicklung her, wenn dieser Bezug sachlich vorhanden ist. Erfinde keinen Immobilienbezug, wenn er aus Input und Recherche nicht belastbar hervorgeht.
        Vermeide eine Aneinanderreihung gleichwertiger Einzelthemen. Der Beitrag darf mehrere Aspekte enthalten, aber sie müssen klar hierarchisiert sein: ein Hauptfokus, wenige stützende Aspekte, keine lose Materialsammlung.
        Zentrale Fakten, Zahlen, Akteure, Orte und Aussagen aus dem Input, die den Nachrichtenwert tragen, müssen im Beitrag erhalten bleiben oder bewusst und sachlich begründet weggelassen werden.
        Warnungen, Prognosen, Investitionsvolumen, Verschuldungskennzahlen, regulatorische Fristen oder konkrete Unternehmensangaben dürfen nicht ausgelassen werden, wenn sie für den Nachrichtenkern entscheidend sind.
        Solche Angaben müssen aber sauber eingeordnet werden: Prognosen, Einschätzungen und Warnungen sind nicht als bereits eingetretene Tatsachen darzustellen.
        Der Beitrag soll nicht alle Informationen vollständig abarbeiten.
        Wähle die stärksten Fakten und ordne sie so an, dass sie eine klare Hauptaussage tragen.
        Lasse Nebeninformationen weg, wenn sie den Text nur vollständiger, aber nicht stärker machen.
        Vermeide wiederholte Einordnungen. Jede neue Passage muss eine neue Information, eine konkrete Folge oder eine klare Zuspitzung bringen.`,

        `# Beitragsspezifische Zusatzanweisungen
        Wenn im User-Input additional_instructions vorhanden ist, berücksichtige diese als beitragsspezifische redaktionelle Hinweise.
        Diese Zusatzanweisungen stehen inhaltlich auf derselben Arbeitsebene wie subject, from und source_text, sind aber den festen redaktionellen Regeln dieser Developer-Anweisung untergeordnet.
        Falls additional_instructions den festen Regeln, dem JSON-Schema, der Faktenlage, der Quellenlage oder den WordPress-Vorgaben widerspricht, ignoriere nur den widersprechenden Teil.
        Nutze additional_instructions nicht als Quelle für neue Fakten, ausser die Angaben werden durch source_text oder Web-Recherche gestützt.
        Übernimm keine Meta-Anweisungen sichtbar in den Artikel.`,

        `# Sprache und Stil
        Schreibe in Schweizer Hochdeutsch, sachlich, klar und redaktionell.
        Verwende normale deutsche Umlaute wie ä, ö und ü in Titel, Auszug, Lead, Alt-Text und content_html. Ersetze Umlaute nicht durch ae, oe oder ue. Schreibe also «Zürich», «Gebäude», «Müller», «Fläche» und «höhere».
        Verwende Schweizer Rechtschreibung und schreibe ss statt ß.
        Der Text soll wie ein kompakter immo!nvest-Fachartikel wirken, nicht wie eine E-Mail-Zusammenfassung, Medienmitteilung, Marktanalyse oder ein Research-Kommentar.
        Schreibe mit kurzen, klaren Absätzen.
        Setze konkrete Substantive und starke Verben ein.
        Vermeide abstrakte Füllsätze, doppelte Einordnungen und lange Vorsichtskonstruktionen.
        Beginne mit der stärksten konkreten Nachricht, nicht mit einer allgemeinen Relevanzbehauptung.
        Gute Einstiege zeigen sofort einen Ort, ein Projekt, eine Zahl, einen Entscheid, einen Konflikt, eine technische Lösung, eine Marktbewegung oder eine Konsequenz.
        Vermeide generische Formulierungen wie «rückt in den Fokus», «gewinnt an Bedeutung», «bleibt relevant», «für professionelle Marktteilnehmer», «für die Immobilienwirtschaft ist relevant», «im Spannungsfeld von», «in einem Umfeld von» oder «es bleibt abzuwarten».
        Nutze solche Formulierungen nur, wenn sie wirklich die präziseste Lösung sind.
        Formuliere Zwischentitel kurz, konkret und redaktionell.
        Gute Zwischentitel benennen eine Entwicklung, Wirkung oder Frage.
        Vermeide generische Zwischentitel wie «Relevanz für die Branche», «Weitere Entwicklung», «Ausblick», «Hintergrund» oder «Signal für den Markt».
        Vermeide werbliche Sprache, PR-Floskeln, unkritische Formulierungen, Spam-Phrasen, fremdsprachige Fragmente, Sonderzeichenketten und irrelevante Zusätze.
        Vermeide Gedankenstriche, Halbgeviertstriche und Bindestriche als stilistisches Satzzeichen im gesamten zurückgegebenen Text.
        Im content_html ist höchstens ein einzelner Gedankenstrich erlaubt, und nur wenn er sprachlich wirklich notwendig ist.
        Normale orthografische Bindestriche in zusammengesetzten Begriffen sind erlaubt und sollen korrekt verwendet werden, etwa Netto- und Bruttomieten, Gross- und Mittelstädte, 3-Zimmer-Wohnung, IW-Prognose, Loan-to-Value-Verhältnis oder Exit-Potenzial.
        Verwende bei grossen Zahlen eine einheitliche Schweizer oder deutschsprachige Schreibweise, etwa 1’040,4 Mrd. Franken oder 1.040,4 Mrd. Euro, aber keine gemischten Formate wie 1,040,4 Mrd.
        Achte auf korrekte Bindestriche bei gekoppelten Begriffen wie Energie- und Modernisierungskosten, Transaktions- und Finanzierungsfähigkeit oder Netto- und Bruttomieten.`,

        `# Satzbau und Informationsdichte
        Bevorzuge kurze und mittellange Sätze, ohne den Text in eine Folge abgehackter Einzelsätze zu verwandeln.
        Die Satzlänge darf natürlich variieren. Klarheit und Lesefluss sind wichtiger als eine feste Wortzahl.
        Prüfe bei längeren Sätzen, ob mehrere eigenständige Aussagen darin enthalten sind oder ob die Hauptaussage durch Nebensätze, Einschübe und Einschränkungen verdeckt wird. Teile den Satz in diesem Fall sinnvoll auf.
        Ein längerer Satz ist erlaubt, wenn der Zusammenhang dadurch verständlicher bleibt und keine künstliche Komplexität entsteht.
        Jeder Satz soll eine erkennbare Funktion erfüllen. Er soll eine Tatsache nennen, einen Zusammenhang erklären, eine Folge zeigen, eine Position wiedergeben, einen Gegensatz verdeutlichen oder den Beitrag sinnvoll weiterführen.
        Wiederhole eine Aussage nicht nur mit anderen Worten und füge keine Sätze ein, die lediglich Wichtigkeit, Relevanz oder Dynamik behaupten.
        Wenn Input und Recherche wenig Substanz liefern, schreibe kompakter. Verlängere den Beitrag nicht mit allgemeinen Einordnungen oder mehrfach formulierten Schlussfolgerungen.
        Verwende Gegenüberstellungen mit «nicht», «sondern», «statt» oder ähnlichen Konstruktionen nur, wenn tatsächlich zwei unterschiedliche Möglichkeiten, Positionen oder Wirkungen gegenübergestellt werden.
        Wenn der verneinte Teil ohne Informationsverlust entfernt werden kann, formuliere die eigentliche Aussage direkt.
        Schreibe beispielsweise «Die Überbauung entsteht in einer einzigen Etappe.» statt «Die Überbauung soll nicht in mehreren Abschnitten, sondern in einer einzigen Etappe realisiert werden.»
        Eine Formulierung wie «Der entscheidende Hebel liegt nicht in den Kriterien, sondern in der Zusatzklausel» ist erlaubt, wenn genau dieser Gegensatz für das Verständnis wichtig ist.
        Vermeide Formulierungen wie «Das ist mehr als ein Terminentscheid», «Damit setzt das Projekt ein wichtiges Zeichen» oder «Die Entwicklung ist für den Markt von Bedeutung», wenn danach keine konkrete und belegte Wirkung erklärt wird.`,

        `# Zeichensetzung
        Verwende im sichtbaren redaktionellen Beitrag keine Doppelpunkte.
        Diese Vorgabe gilt für title, excerpt, content_html, Fliesstext und Zwischentitel.
        Formuliere Erklärungen, Folgerungen und Aufzählungen stattdessen als vollständige Sätze oder verteile sie auf mehrere Sätze.
        Doppelpunkte in technischen URLs, href-Attributen, source_references und nicht sichtbaren technischen Feldern sind von dieser Regel ausgenommen.`,

        `# Redaktionelle Verdichtung
        Schreibe nur so lang, wie es die Substanz rechtfertigt.
        Ein einzelnes Ereignis, eine Personalie, ein politischer Entscheid oder eine Unternehmensmeldung soll kompakt bleiben.
        Ein Beitrag darf länger sein, wenn mehrere konkrete Projekte, Standorte, Zahlen, technische Schritte oder regulatorische Folgen erklärt werden müssen.
        Länge darf nur durch zusätzliche konkrete Substanz entstehen, nicht durch wiederholte Einordnung.
        Vermeide Absätze, die lediglich nochmals erklären, warum das Thema wichtig ist.
        Der Schluss soll keine allgemeine Zusammenfassung sein, sondern die wichtigste Konsequenz, offene Frage oder Wirkung festhalten.`,

        `# Titel
        Der Titel muss immer neu formuliert werden und darf niemals dem Originaltitel entsprechen oder ihm nur leicht umgestellt ähneln.
        Wähle für den Titel eine neue, redaktionelle und prägnante Formulierung mit maximal ${maximumTitleLength} Zeichen.
        Der Titel soll den konkreten Nachrichtenwert oder Markteffekt benennen. Gute Titel zeigen, was sich verändert, wo eine Entwicklung stattfindet, welche Wirkung entsteht oder welche Entscheidung getroffen wurde.
        Vermeide sehr allgemeine Titel, die auch zu vielen anderen Artikeln passen würden, etwa «Politik rückt ins Zentrum», «Markt im Fokus», «Preise unter Druck», «Neue Dynamik am Markt», «Wenn Preise zur Last werden» oder ähnliche austauschbare Formulierungen.
        Vermeide zu metaphorische, dramatische oder boulevardeske Titel. Der Titel soll sachlich, klar und immobilienwirtschaftlich wirken.
        Bevorzuge konkrete Titel mit Ort, Nutzung, Projektart, Entwicklung, Entscheid oder Wirkung.
        Der Titel darf keinen Doppelpunkt enthalten.
        Im Titel dürfen keine Gedankenstriche, Halbgeviertstriche oder Bindestrich-Konstruktionen als Stilmittel vorkommen.
        Normale orthografische Bindestriche sind im Titel nur erlaubt, wenn sie für ein korrektes zusammengesetztes Wort nötig sind. Vermeide sie, wenn eine gleich gute Formulierung ohne Bindestrich möglich ist.
        Im Titel dürfen niemals Firmennamen, Unternehmensnamen, Markennamen oder Produktnamen vorkommen.
        Diese Regel gilt ohne Ausnahme. Sie gilt auch dann, wenn das Unternehmen selbst Träger der Nachricht ist.
        Stelle stattdessen den Ort, das Projekt, die Nutzung, die Grössenordnung, den Entscheid, den Konflikt oder die konkrete Wirkung ins Zentrum.
        Namen von Städten, Gemeinden, Kantonen, Behörden und politischen Institutionen sind erlaubt, weil sie nicht als Firmennamen gelten.
        Projektnamen sind erlaubt, sofern sie nicht zugleich ein Firmen-, Marken- oder Produktname sind und für einen verständlichen Titel benötigt werden.
        Der Titel darf keine Kausalität, Zuspitzung oder direkte Folge behaupten, die aus Input und Recherche nicht klar hervorgeht.
        Vermeide Titel, die einen Kontextfaktor als Ursache darstellen, wenn er im Beitrag nur eine Einordnung oder ein Nebenaspekt ist.
        Der Titel soll wie eine kompakte redaktionelle Zeile wirken, nicht wie eine Kapitelüberschrift und nicht wie ein SEO-Satz.
        Bevorzuge konkrete Verben und klare Wirkungen.`,

        `# Firmen, Marken und Produktnamen im Inhalt
        Im Inhalt dürfen Firmennamen, Markennamen oder Produktnamen verwendet werden, wenn sie für die Nachricht, Einordnung oder Verständlichkeit relevant sind.
        Nenne solche Namen nur sparsam, neutral und ohne werbliche Wirkung.
        Vermeide unnötige Wiederholungen von Firmen-, Marken- und Produktnamen.`,

        `# Textauszug
        Der Textauszug soll den redaktionellen Spannungsbogen des Beitrags kurz und verständlich zeigen.
        Er soll nicht nur zusammenfassen, sondern erklären, welche Veränderung, welcher Konflikt, welche Folge oder welche Chance im Beitrag steckt.
        Der Textauszug soll konkret sein und möglichst eine Zahl, einen Ort, ein Projekt, eine Entscheidung, eine Entwicklung oder eine direkte Wirkung enthalten, wenn dies sachlich passt.
        Vermeide austauschbare Zusammenfassungen und allgemeine Relevanzsätze.`,

        `# Lead und erster Absatz
        Der Textauszug wird als Lead des Beitrags verwendet.
        Lead und erster Absatz behandeln denselben Nachrichtenkern, dürfen diesen aber nicht einfach zweimal zusammenfassen.
        Der Lead soll die stärkste Nachricht, den Gegenstand und die wichtigste erkennbare Wirkung kompakt vermitteln.
        Der erste Absatz von content_html soll den Beitrag danach weiterführen. Er kann beispielsweise die Vorgeschichte, den Auslöser, eine Verzögerung, einen politischen Ursprung, eine frühere Planung, eine verantwortliche Person, einen Konflikt, eine Reaktion oder einen nächsten Umsetzungsschritt erklären.
        Lead und erster Absatz dürfen denselben Ort, dasselbe Projekt und einzelne zentrale Eckdaten nennen, wenn dies für das Verständnis notwendig ist.
        Vermeide aber, dieselbe Kombination aus Ort, Termin, Anzahl, Investitionssumme und Hauptaussage direkt nacheinander zu wiederholen.
        Formuliere den ersten Absatz nicht bloss als sprachliche Variante des Leads.
        Wenn nur wenige Informationen vorhanden sind, erfinde keinen künstlich neuen Blickwinkel.
        Beginne den ersten Absatz stattdessen mit dem nächsten belegten Detail und halte ihn kompakt.
        Prüfe vor der Ausgabe, ob der erste Absatz gegenüber dem Lead einen erkennbaren zusätzlichen Informationswert bietet.`,

        `# WordPress-Inhalt
        content_html soll ein sauberer WordPress-Inhalt mit gültigem HTML sein.
        Verwende kein <html>, kein <body> und keinen äusseren <div class="content">.
        Gib keinen Markdown-Codeblock aus.

        content_html muss mit einem normalen Fliesstext-Absatz beginnen.
        Der erste Absatz muss das Format <p>Fliesstext</p> haben.
        Wenn genügend Substanz vorhanden ist, können vor dem ersten Zwischentitel zwei normale Fliesstext-Absätze stehen.
        Bei kompakten Beiträgen genügt ein starker Einstiegsabsatz vor dem ersten Zwischentitel.

        Verwende für Zwischentitel keine Heading-Tags wie <h1>, <h2>, <h3>, <h4>, <h5> oder <h6>.
        Zwischentitel müssen als Teil eines normalen Absatzes im Format <p><strong>Zwischentitel<br></strong>Fliesstext des Abschnitts.</p> ausgegeben werden.
        Der Zwischentitel steht innerhalb von <strong>, der anschliessende Abschnittstext steht im selben <p>-Element nach dem <br>.
        <strong> darf nur den Zwischentitel umfassen, nicht den ganzen Absatz.

        Der typische Aufbau von content_html ist:
        <p>Erster redaktioneller Einstiegsabsatz.</p>
        <p>Zweiter einordnender Fliesstextabsatz.</p>
        <p><strong>Kurzer Zwischentitel<br></strong>Fliesstext zum ersten Abschnitt.</p>
        <p>Weiterer normaler Fliesstextabsatz.</p>
        <p><strong>Kurzer Zwischentitel<br></strong>Fliesstext zum nächsten Abschnitt.</p>
        <p>Abschliessender einordnender Fliesstextabsatz.</p>

        Verwende keine leeren Absätze, keine mehrfachen <br>-Folgen und keine dekorativen HTML-Elemente.
        Verwende Tabellen, Bullet-Listen oder nummerierte Listen nur, wenn sie für das Verständnis notwendig sind.`,

        `# Quellen
        Wenn Webquellen verwendet werden, soll content_html am Ende einen kurzen Quellenabschnitt mit passenden HTML-Links enthalten.
        Der Quellenabschnitt soll nur Quellen enthalten, die tatsächlich für zusätzliche Informationen im Beitrag verwendet wurden.
        Der Quellenabschnitt darf keine Heading-Tags verwenden.
        Falls das JSON-Schema ein Feld source_references enthält, fülle es mit den wichtigsten tatsächlich verwendeten Webquellen.`,

        `# Quellenangaben im Fliesstext
        Der Quellenabschnitt am Ende von content_html bleibt erhalten. Im eigentlichen Fliesstext sollen Quellen aber nicht direkt als Beleg genannt werden.
        Vermeide Formulierungen wie «laut SRF», «laut Bundesrat», «gemäss Tages-Anzeiger», «nach Angaben von Wüest Partner», «Reuters berichtet», «Bloomberg schreibt», «die Studie von XY zeigt» oder ähnliche direkte Quellenzuschreibungen.
        Medien, Behörden, Studien, Unternehmen oder Research-Häuser dürfen im Fliesstext genannt werden, wenn sie selbst Gegenstand der Nachricht, handelnde Akteure oder für das Verständnis notwendig sind. Sie sollen aber nicht als reine Belegformel verwendet werden.
        Wenn eine vorsichtige Herkunftsformulierung nötig ist, nutze neutrale Formulierungen wie «gemäss verfügbaren Angaben», «nach verfügbaren Angaben», «verfügbare Daten zeigen», «öffentlich zugängliche Unterlagen deuten darauf hin» oder «in Medienberichten ist von ... die Rede».
        Fakten müssen weiterhin durch Web-Recherche geprüft und am Ende im Quellenabschnitt verlinkt werden. Die Quellen sollen aber nicht unnötig im Fliesstext genannt werden.`,

        `# Kategorien
        Wähle passende Kategorien aus der Liste allowed_category_options.
        selected_category_keys muss zwischen ${minimumRequestedCategoryCountFromAi} und ${maximumRequestedCategoryCountFromAi} Einträge enthalten.
        Verwende nur category keys aus allowed_category_options.
        Wähle immer die unterste passende Ebene.
        Wenn eine Unterkategorie passt, darf die Parent-Kategorie nicht zusätzlich gesetzt werden.
        Bei eindeutig globalen Themen verwende im Regionenbaum ausschliesslich international und nicht global.
        Erfinde keine category keys.
        best_category_key muss genau einen category key als String enthalten. best_category_key muss aus allowed_category_options stammen, muss type "topic" haben und muss eine der gewählten selected_category_keys sein. Wähle dafür die fachlich wichtigste und passendste Themen-Kategorie. best_category_key darf niemals eine Region sein.`,

        `# Stichwörter
        keyword_names muss mindestens ${minimumThematicKeywordCount} thematisch passende Stichwörter enthalten.
        keyword_names darf höchstens ${maximumRequestedKeywordCountFromAi} Einträge enthalten.
        Die fixen Stichwörter ${fixedKeywordNames.join(', ')} werden vom System ergänzt und dürfen nicht in keyword_names enthalten sein.
        Gib keine Duplikate in keyword_names aus.`,

        `# Bild
        featured_image_prompt_en muss in englischer Sprache formuliert sein.
        featured_image_prompt_en muss eine realistische redaktionelle Bildidee für einen WordPress-Featured-Image-Header beschreiben.
        featured_image_prompt_en soll fotografisch, glaubwürdig, modern und professionell wirken.
        featured_image_prompt_en darf keine Logos, keinen lesbaren Text, keine Wasserzeichen, keine UI-Elemente, keine Infografiken und keinen Cartoon-Stil verlangen.
        featured_image_prompt_en darf keine Schilder, Bautafeln, Strassenschilder, Plakate, Banner, Beschriftungen, Dokumente, Zeitungen, Bildschirme, Karten, Diagramme, Nummernschilder, Firmennamen, Markennamen, Produktnamen, Buchstaben oder Zahlen im Bild verlangen.
        featured_image_alt_text_de muss einen kurzen, sachlichen deutschen Alt-Text für das Bild liefern.`,

        `# Midjourney-Prompt
        midjourney_prompt_en muss in englischer Sprache formuliert sein.
        midjourney_prompt_en muss eine realistische, fotografische Bildidee beschreiben, die klar zum Beitrag passt.
        Der Stil ist realistisch, glaubwürdig, modern und professionell.
        Das Bildformat ist 2:1.
        Der Prompt darf keine Erklärungen, keinen Markdown-Codeblock und keine Anführungszeichen enthalten.
        Die Endung des Prompts muss immer exakt lauten:
        ${midjourneyPromptEnding}`
    ];

    if (forceStrongRewrite) {
        instructionSections.push(
            `# Zusätzliche Vorgaben für eine stärkere Neufassung
            Der neue Entwurf muss stärker fokussiert sein als ein normaler Rewrite. Prüfe vor dem Schreiben, ob der Beitrag zu viele gleichwertige Themenstränge enthält.
            Wenn mehrere Themen möglich sind, wähle den redaktionell stärksten Kern und ordne alle weiteren Informationen diesem Kern unter. Entferne Informationen, die den Beitrag nur verbreitern.
            Der Beitrag soll nicht wie eine Zusammenfassung der E-Mail wirken. Er soll wie ein eigenständiger Artikel wirken, der eine klare Auswahl trifft, gewichtet und einordnet.
            Formuliere Titel, Auszug und Einstieg so, dass sofort erkennbar ist, worum es im Kern geht. Verwende keine generischen Titel, die auch zu vielen anderen Artikeln passen würden.
            Nutze Web-Recherche nicht als Anlass, möglichst viele Zusatzinformationen einzubauen. Nutze sie zur Prüfung, Einordnung und Verdichtung.
            Wenn der erste Entwurf mehrere mögliche Kernaussagen hätte, ist der zweite Entwurf zu fokussieren, bis eine Hauptaussage dominiert.
            Der zweite Entwurf soll nicht länger, sondern klarer, konkreter und dichter werden.`
        );
    }

    if (
        Array.isArray(rewriteFeedback) &&
        rewriteFeedback.length > 0
    ) {
        instructionSections.push(
            `# Korrekturen am vorherigen Entwurf
            Der vorherige Entwurf wurde bei der internen Qualitätsprüfung beanstandet.

            ${rewriteFeedback
                .map((validationError) => {
                    return `- ${validationError}`;
                })
                .join('\n')}

            Behebe die genannten Punkte gezielt.
            Formuliere den Beitrag nur dort neu, wo es für die Korrektur notwendig ist.
            Verändere keine korrekten Fakten und erfinde keine zusätzlichen Angaben, um einen Fehler zu umgehen.
            Prüfe insbesondere Titel, Lead, ersten Absatz und sichtbare Zeichensetzung erneut.`
        );
    }

    if (useStrictLengthRules) {
        instructionSections.push(
            `# Längenregeln
            Der Textauszug muss mindestens ${minimumExcerptLength} und maximal ${maximumExcerptLength} Zeichen lang sein.
            content_html muss mindestens ${minimumContentTextLength} und maximal ${maximumContentHtmlLength} Zeichen lang sein.`
        );
    } else {
        instructionSections.push(
            `# Längenregeln
            Der Textauszug soll bevorzugt zwischen ${minimumExcerptLength} und ${maximumExcerptLength} Zeichen liegen, falls der Input und die Web-Recherche dafür genug Substanz liefern.
            content_html soll bevorzugt mindestens ${minimumContentTextLength} Zeichen lang sein, falls der Input und die Web-Recherche dafür genug Substanz liefern, aber maximal ${maximumContentHtmlLength} Zeichen.`
        );
    }

    instructionSections.push(
        `# Redaktionelle Qualitätsfelder
        Fülle editorial_focus mit der zentralen Hauptaussage des Beitrags in einem Satz.
        Fülle editorial_relevance mit der Begründung, warum dieser Beitrag für die Zielgruppe relevant ist. Wenn kein starker Immobilienbezug vorhanden ist, formuliere die Relevanz allgemeiner und sachlich.
        Fülle supporting_aspects mit höchstens drei Aspekten, die den redaktionellen Fokus direkt stützen.
        Fülle omitted_aspects mit wichtigen Input- oder Rechercheaspekten, die bewusst nicht oder nur sehr knapp verwendet wurden, weil sie den Beitrag sonst thematisch überladen würden.
        Diese Qualitätsfelder dienen der internen Prüfung. content_html darf sie nicht als sichtbare Liste oder Meta-Erklärung ausgeben.`
    );

    instructionSections.push(
        `# Schlusskontrolle
        Prüfe den fertigen Beitrag vor der JSON-Ausgabe nochmals vollständig.
        Im sichtbaren redaktionellen Text darf kein Doppelpunkt vorkommen.
        Der Titel darf keinen Firmen-, Unternehmens-, Marken- oder Produktnamen enthalten.
        Der Lead und der erste Absatz dürfen nicht dieselben Aussagen und Eckdaten lediglich unterschiedlich formulieren.
        Der erste Absatz soll den Lead sinnvoll weiterführen, ohne einen künstlich neuen Themenstrang zu eröffnen.
        Längere Sätze sind erlaubt, wenn sie klar und gut lesbar bleiben. Teile sie auf, wenn mehrere eigenständige Aussagen oder unnötige Einschübe darin stecken.
        Gegenüberstellungen mit «nicht», «sondern» oder «statt» sollen nur verwendet werden, wenn ein echter inhaltlicher Gegensatz besteht.
        Entferne Sätze und Absätze, die lediglich Wichtigkeit behaupten oder bereits Gesagtes nochmals einordnen.
        Schreibe nur so ausführlich, wie es die belegte Substanz rechtfertigt.
        Gib diese Schlusskontrolle nicht sichtbar im Beitrag aus.`
    );

    instructionSections.push(
        `# Ausgabe
        Gib ausschliesslich valides JSON gemäss dem vorgegebenen Schema zurück.`
    );

    return instructionSections.join('\n\n');
}

function buildResponseSchema({ useStrictLengthRules }) {
  const excerptSchema = {
    type: 'string',
    maxLength: maximumExcerptLength
  };

  const contentHtmlSchema = {
    type: 'string',
    maxLength: maximumContentHtmlLength
  };

  if (useStrictLengthRules) {
    excerptSchema.minLength = minimumExcerptLength;
    contentHtmlSchema.minLength = minimumContentTextLength;
  }

  return {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        maxLength: maximumTitleLength
      },
      excerpt: excerptSchema,
      slug: {
        type: 'string',
        maxLength: 80
      },
      content_html: contentHtmlSchema,
      selected_category_keys: {
        type: 'array',
        items: {
          type: 'string',
          enum: getAllowedCategoryKeysForSchemaEnum()
        },
        minItems: minimumRequestedCategoryCountFromAi,
        maxItems: maximumRequestedCategoryCountFromAi
      },
      best_category_key: {
        type: 'string',
        enum: getAllowedTopicCategoryKeysForSchemaEnum()
      },
      keyword_names: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 2,
          maxLength: 40
        },
        minItems: minimumThematicKeywordCount,
        maxItems: maximumRequestedKeywordCountFromAi
      },
      featured_image_prompt_en: {
        type: 'string',
        minLength: 30,
        maxLength: 1200
      },
      featured_image_alt_text_de: {
        type: 'string',
        minLength: 10,
        maxLength: 180
      },
      source_references: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              minLength: 2,
              maxLength: 180
            },
            url: {
              type: 'string',
              minLength: 10,
              maxLength: 500
            },
            used_for: {
              type: 'string',
              minLength: 10,
              maxLength: 300
            }
          },
          required: ['title', 'url', 'used_for'],
          additionalProperties: false
        },
        minItems: enableOpenAiWebSearch ? 1 : 0,
        maxItems: 8
      },
      editorial_focus: {
        type: 'string',
        minLength: 20,
        maxLength: 220
      },
      editorial_relevance: {
        type: 'string',
        minLength: 20,
        maxLength: 300
      },
      supporting_aspects: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 5,
          maxLength: 160
        },
        minItems: 1,
        maxItems: 3
      },
      omitted_aspects: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 5,
          maxLength: 160
        },
        minItems: 0,
        maxItems: 5
      },
      midjourney_prompt_en: {
        type: 'string',
        minLength: 60,
        maxLength: 1400
      }
    },
    required: [
      'title',
      'excerpt',
      'slug',
      'content_html',
      'selected_category_keys',
      'best_category_key',
      'midjourney_prompt_en',
      'keyword_names',
      'featured_image_prompt_en',
      'featured_image_alt_text_de',
      'source_references',
      'editorial_focus',
      'editorial_relevance',
      'supporting_aspects',
      'omitted_aspects'
    ],
    additionalProperties: false
  };
}

function buildOriginalMailDeveloperInstruction() {
    const instructionParts = [
        'Du bist Redaktor für eine professionelle Schweizer Immobilien-Website.',
        'Deine Aufgabe ist nicht, den Beitrag umzuschreiben.',
        'Erkenne nur den Originaltitel, den Originallead, passende Kategorien, passende Stichwörter und einen Bildprompt.',
        'Gib keinen vollständigen Beitragstext zurück.',
        'Der eigentliche Beitragstext wird vom System direkt aus der Original-Mail übernommen.',
        'title muss exakt dem erkannten Titel aus subject oder source_text entsprechen.',
        'lead muss exakt einem passenden Lead oder Kurzbeschrieb aus source_text entsprechen.',
        'Ändere beim Titel und Lead keine Wörter, keine Zahlen, keine Satzzeichen und keine Reihenfolge.',
        'Korrigiere keine Rechtschreibung und formuliere nichts schöner.',
        'Erfinde keine Informationen und ergänze keinen neuen Inhalt.',
        'Falls die E-Mail keinen klaren separaten Lead enthält, verwende den ersten sinnvollen Absatz nach dem Titel als lead.',
        'Wähle zusätzlich passende Kategorien aus der Liste allowed_category_options.',
        `selected_category_keys muss zwischen ${minimumRequestedCategoryCountFromAi} und ${maximumRequestedCategoryCountFromAi} Einträge enthalten.`,
        'Verwende nur category keys aus allowed_category_options.',
        'Wähle immer die unterste passende Ebene.',
        'Wenn eine Unterkategorie passt, darf die Parent-Kategorie nicht zusätzlich gesetzt werden.',
        'Bei eindeutig globalen Themen verwende im Regionenbaum ausschliesslich international.',
        'Verwende bei globalen Themen nicht global, sondern international.',
        'Erfinde keine category keys.',
        `keyword_names muss mindestens ${minimumThematicKeywordCount} thematisch passende Stichwörter enthalten.`,
        `keyword_names darf höchstens ${maximumRequestedKeywordCountFromAi} Einträge enthalten.`,
        `Die fixen Stichwörter ${fixedKeywordNames.join(', ')} werden vom System ergänzt und dürfen nicht in keyword_names enthalten sein.`,
        'Gib keine Duplikate in keyword_names aus.',
        'featured_image_prompt_en muss in englischer Sprache formuliert sein.',
        'featured_image_prompt_en muss eine realistische redaktionelle Bildidee für einen WordPress-Featured-Image-Header beschreiben.',
        'featured_image_prompt_en soll fotografisch, glaubwürdig, modern und professionell wirken.',
        'featured_image_prompt_en darf keine Logos, keinen lesbaren Text, keine Wasserzeichen, keine UI-Elemente, keine Infografiken und keinen Cartoon-Stil verlangen.',
        'featured_image_alt_text_de muss einen kurzen, sachlichen deutschen Alt-Text für das Bild liefern.',
        'best_category_key muss genau einen category key als String enthalten.',
        'best_category_key muss aus allowed_category_options stammen, muss type "topic" haben und muss eine der gewählten selected_category_keys sein.',
        'Wähle dafür die fachlich wichtigste und passendste Themen-Kategorie.',
        'best_category_key darf niemals eine Region sein.',
        'midjourney_prompt_en muss in englischer Sprache formuliert sein.',
        'midjourney_prompt_en muss eine realistische, fotografische Bildidee beschreiben, die klar zum Beitrag passt.',
        'Der Stil ist realistisch.',
        'Das Bildformat ist 2:1.',
        'Logos, Text oder Cartoons sind nicht erlaubt.',
        `Die Endung des Prompts muss immer exakt lauten: ${midjourneyPromptEnding}`,
        'Gib ausschliesslich valides JSON gemäss dem vorgegebenen Schema zurück.',
    ];

    return instructionParts.join(' ');
}

function buildOriginalMailResponseSchema() {
    return {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                minLength: 2,
                maxLength: 180
            },
            lead: {
                type: 'string',
                minLength: 2,
                maxLength: 1000
            },
            selected_category_keys: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: getAllowedCategoryKeysForSchemaEnum()
                },
                minItems: minimumRequestedCategoryCountFromAi,
                maxItems: maximumRequestedCategoryCountFromAi
            },
            best_category_key: {
                type: 'string',
                enum: getAllowedTopicCategoryKeysForSchemaEnum()
            },
            keyword_names: {
                type: 'array',
                items: {
                    type: 'string',
                    minLength: 2,
                    maxLength: 40
                },
                minItems: minimumThematicKeywordCount,
                maxItems: maximumRequestedKeywordCountFromAi
            },
            featured_image_prompt_en: {
                type: 'string',
                minLength: 30,
                maxLength: 1200
            },
            featured_image_alt_text_de: {
                type: 'string',
                minLength: 10,
                maxLength: 180
            },
            midjourney_prompt_en: {
                type: 'string',
                minLength: 60,
                maxLength: 1400
            },
        },
        required: [
            'title',
            'lead',
            'selected_category_keys',
            'best_category_key',
            'keyword_names',
            'midjourney_prompt_en',
            'featured_image_prompt_en',
            'featured_image_alt_text_de'
        ],
        additionalProperties: false
    };
}

function normalizeGeneratedPost(parsedResponse, useStrictLengthRules) {
    const title = normalizeWhitespace(parsedResponse.title || '');

    let contentHtml = normalizeGeneratedHtml(parsedResponse.content_html || '');
    if (!contentHtml) {
        throw new Error('OpenAI-Antwort enthält keinen gültigen Inhalt.');
    }

    const contentText = htmlToPlainText(contentHtml);

    let excerpt = normalizeWhitespace(parsedResponse.excerpt || '');
    if (!excerpt || (useStrictLengthRules && excerpt.length < minimumExcerptLength)) {
        excerpt = buildExcerptFromText(contentText);
    }

    excerpt = finalizeExcerptText(
        truncateToLength(excerpt, maximumExcerptLength)
    );

    if (useStrictLengthRules && excerpt.length < minimumExcerptLength) {
        throw new Error(`Textauszug ist zu kurz. Aktuell: ${excerpt.length} Zeichen.`);
    }

    if (useStrictLengthRules && contentText.length < minimumContentTextLength) {
        throw new Error(`OpenAI-Inhalt ist zu kurz. Aktuell: ${contentText.length} Zeichen.`);
    }

    if (!title) {
        throw new Error('OpenAI-Antwort enthält keinen gültigen Titel.');
    }

    if (!excerpt) {
        throw new Error('OpenAI-Antwort enthält keinen gültigen Textauszug.');
    }

    const featuredImagePrompt = normalizeWhitespace(parsedResponse.featured_image_prompt_en || '');
    const featuredImageAltText = normalizeWhitespace(parsedResponse.featured_image_alt_text_de || '');

    const midjourneyPrompt = normalizeMidjourneyPrompt(
        parsedResponse.midjourney_prompt_en,
        featuredImagePrompt
    );

    if (!featuredImagePrompt) {
        throw new Error('OpenAI-Antwort enthält keinen gültigen Bildprompt.');
    }

    if (!featuredImageAltText) {
        throw new Error('OpenAI-Antwort enthält keinen gültigen Bild-Alt-Text.');
    }

    const sourceReferences = normalizeSourceReferences(parsedResponse.source_references);

    if (enableOpenAiWebSearch && sourceReferences.length === 0) {
        throw new Error('OpenAI hat keine verwertbaren Webquellen zurückgegeben.');
    }

    return {
        title,
        excerpt,
        lead: excerpt,
        slug: sanitizeSlug(parsedResponse.slug || title),
        content_html: contentHtml,
        content_text: contentText,
        selected_category_keys: normalizeSelectedCategoryKeys(parsedResponse.selected_category_keys),
        best_category_key: normalizeBestCategoryKey(parsedResponse.best_category_key),
        midjourney_prompt_en: midjourneyPrompt,
        keyword_names: normalizeAiKeywordNames(parsedResponse.keyword_names),
        featured_image_prompt_en: featuredImagePrompt,
        featured_image_alt_text_de: featuredImageAltText,
        source_references: sourceReferences,
        editorial_focus: normalizeWhitespace(parsedResponse.editorial_focus || ''),
        editorial_relevance: normalizeWhitespace(parsedResponse.editorial_relevance || ''),
        supporting_aspects: normalizeEditorialAspectList(parsedResponse.supporting_aspects),
        omitted_aspects: normalizeEditorialAspectList(parsedResponse.omitted_aspects)
    };
}

function normalizeEditorialAspectList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeOriginalMailPost({ parsedResponse, subject, sourceText }) {
    const title = String(parsedResponse.title || '').trim();
    const lead = String(parsedResponse.lead || '').trim();

    if (!title) {
        throw new Error('OpenAI-Antwort enthält keinen gültigen Originaltitel.');
    }

    if (!lead) {
        throw new Error('OpenAI-Antwort enthält keinen gültigen Originallead.');
    }

    if (!isOriginalTextFromInput(title, sourceText, subject)) {
        throw new Error('Der erkannte Titel wurde nicht exakt aus subject oder source_text übernommen.');
    }

    if (!isOriginalTextFromInput(lead, sourceText, subject)) {
        throw new Error('Der erkannte Lead wurde nicht exakt aus source_text übernommen.');
    }

    const contentText = buildOriginalArticleTextFromSource({
        sourceText,
        title,
        lead
    });

    if (!contentText) {
        throw new Error('Aus der Original-Mail konnte kein Beitragstext extrahiert werden.');
    }

    const featuredImagePrompt = normalizeWhitespace(parsedResponse.featured_image_prompt_en || '');
    const featuredImageAltText = normalizeWhitespace(parsedResponse.featured_image_alt_text_de || '');

    const midjourneyPrompt = normalizeMidjourneyPrompt(
        parsedResponse.midjourney_prompt_en,
        featuredImagePrompt
    );

    if (!featuredImagePrompt) {
        throw new Error('OpenAI-Antwort enthält keinen gültigen Bildprompt.');
    }

    if (!featuredImageAltText) {
        throw new Error('OpenAI-Antwort enthält keinen gültigen Bild-Alt-Text.');
    }

    return {
        title,
        excerpt: lead,
        lead,
        slug: sanitizeSlug(title),
        content_html: buildOriginalContentHtml(contentText),
        content_text: contentText,
        selected_category_keys: normalizeSelectedCategoryKeys(parsedResponse.selected_category_keys),
        best_category_key: normalizeBestCategoryKey(parsedResponse.best_category_key),
        midjourney_prompt_en: midjourneyPrompt,
        keyword_names: normalizeAiKeywordNames(parsedResponse.keyword_names),
        featured_image_prompt_en: featuredImagePrompt,
        featured_image_alt_text_de: featuredImageAltText,
        source_references: []
    };
}

function buildOriginalArticleTextFromSource({ sourceText, title, lead }) {
    const sourceParagraphs = splitOriginalParagraphs(sourceText);

    if (sourceParagraphs.length === 0) {
        return '';
    }

    const titleIndex = findMatchingParagraphIndex(sourceParagraphs, title, 0);
    const searchLeadFromIndex = titleIndex >= 0 ? titleIndex + 1 : 0;
    const leadIndex = findMatchingParagraphIndex(sourceParagraphs, lead, searchLeadFromIndex);

    let contentStartIndex = 0;

    if (leadIndex >= 0) {
        contentStartIndex = leadIndex + 1;
    } else if (titleIndex >= 0) {
        contentStartIndex = titleIndex + 1;
    }

    const contentParagraphs = sourceParagraphs
        .slice(contentStartIndex)
        .filter((paragraph) => !isTechnicalOriginalParagraph(paragraph));

    if (contentParagraphs.length > 0) {
        return contentParagraphs.join('\n\n').trim();
    }

    return sourceParagraphs
        .filter((paragraph, index) => index !== titleIndex)
        .filter((paragraph) => !isSameOriginalText(paragraph, lead))
        .filter((paragraph) => !isTechnicalOriginalParagraph(paragraph))
        .join('\n\n')
        .trim();
}

function splitOriginalParagraphs(text) {
    return normalizeLineEndingsForOriginalText(text)
        .split(/\n\s*\n+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
}

function findMatchingParagraphIndex(paragraphs, searchText, startIndex) {
    const normalizedSearchText = normalizeWhitespace(searchText);

    if (!normalizedSearchText) {
        return -1;
    }

    for (let index = Math.max(0, startIndex || 0); index < paragraphs.length; index += 1) {
        const normalizedParagraph = normalizeWhitespace(paragraphs[index]);

        if (
            normalizedParagraph === normalizedSearchText ||
            normalizedParagraph.includes(normalizedSearchText)
        ) {
            return index;
        }
    }

    return -1;
}

function isSameOriginalText(textA, textB) {
    return normalizeWhitespace(textA) === normalizeWhitespace(textB);
}

function isTechnicalOriginalParagraph(paragraph) {
    const normalizedParagraph = normalizeWhitespace(paragraph).toLowerCase();

    if (!normalizedParagraph) {
        return true;
    }

    if (/^https?:\/\/\S+$/i.test(normalizedParagraph)) {
        return true;
    }

    const ignoredParagraphs = [
        'newsfeed unsubscribe',
        'unsubscribe',
        'abmelden'
    ];

    if (ignoredParagraphs.includes(normalizedParagraph)) {
        return true;
    }

    if (normalizedParagraph.startsWith('autor:')) {
        return true;
    }

    if (normalizedParagraph.startsWith('quelle:')) {
        return true;
    }

    if (normalizedParagraph.includes('the articles supplied are to be used exclusively')) {
        return true;
    }

    return false;
}

function isOriginalTextFromInput(selectedText, sourceText, subject) {
    const normalizedSelectedText = normalizeWhitespace(selectedText);
    const normalizedSourceText = normalizeWhitespace(sourceText);
    const normalizedSubject = normalizeWhitespace(subject);

    if (!normalizedSelectedText) {
        return false;
    }

    if (
        normalizedSourceText.includes(normalizedSelectedText) ||
        normalizedSubject === normalizedSelectedText
    ) {
        return true;
    }

    const selectedLines = buildComparableOriginalLines(selectedText);
    const sourceLines = buildComparableOriginalLines(sourceText);
    const sourceLineSet = new Set(sourceLines);

    if (selectedLines.length === 0) {
        return false;
    }

    return selectedLines.every((line) => sourceLineSet.has(line));
}

function buildComparableOriginalLines(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean);
}

function buildOriginalContentHtml(contentText) {
    const normalizedText = normalizeLineEndingsForOriginalText(contentText).trim();

    return normalizedText
        .split(/\n\s*\n+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
}

function normalizeLineEndingsForOriginalText(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}

function tryAttachResolvedCategories(normalizedGeneratedPost) {
  try {
    return attachResolvedCategories(normalizedGeneratedPost);
  } catch (error) {
    return {
      ...normalizedGeneratedPost,
      selected_category_titles: [],
      category_ids: [],
      best_category_key: '',
      best_category_title: '',
      best_category_wordpress_id: null,
      category_resolution_error: error.message
    };
  }
}

function attachResolvedCategories(normalizedGeneratedPost) {
  const resolvedCategories = resolveSelectedCategories(normalizedGeneratedPost.selected_category_keys);

  const resolvedBestCategory = resolveBestCategory(
    normalizedGeneratedPost.best_category_key,
    resolvedCategories.selectedKeys
  );

  return {
    ...normalizedGeneratedPost,
    selected_category_keys: resolvedCategories.selectedKeys,
    selected_category_titles: resolvedCategories.selectedTitles,
    category_ids: resolvedCategories.wordpressCategoryIds,
    best_category_key: resolvedBestCategory.key,
    best_category_title: resolvedBestCategory.title,
    best_category_wordpress_id: resolvedBestCategory.wordpressId
  };
}

function tryAttachResolvedKeywords(normalizedGeneratedPost) {
    try {
        return attachResolvedKeywords(normalizedGeneratedPost);
    } catch (error) {
        return {
            ...normalizedGeneratedPost,
            thematic_keyword_names: [],
            tag_names: [],
            keyword_resolution_error: error.message
        };
    }
}

function attachResolvedKeywords(normalizedGeneratedPost) {
    const resolvedKeywords = resolveKeywordNames(normalizedGeneratedPost.keyword_names);

    return {
        ...normalizedGeneratedPost,
        thematic_keyword_names: resolvedKeywords.thematicKeywordNames,
        tag_names: resolvedKeywords.finalKeywordNames
    };
}

function needsSecondRewriteAttempt(validationErrors) {
    return Array.isArray(validationErrors) && validationErrors.length > 0;
}

function isTooCloseToSource(sourceText, generatedText) {
    const normalizedSource = normalizeComparisonText(sourceText);
    const normalizedGenerated = normalizeComparisonText(generatedText);

    if (!normalizedSource || !normalizedGenerated) {
        return false;
    }

    if (normalizedSource === normalizedGenerated) {
        return true;
    }

    if (normalizedGenerated.includes(normalizedSource) || normalizedSource.includes(normalizedGenerated)) {
        return true;
    }

    const fourWordOverlapRatio = calculateShingleOverlapRatio(normalizedSource, normalizedGenerated, 4);
    if (fourWordOverlapRatio >= 0.35) {
        return true;
    }

    const fiveWordOverlapRatio = calculateShingleOverlapRatio(normalizedSource, normalizedGenerated, 5);
    if (fiveWordOverlapRatio >= 0.22) {
        return true;
    }

    const sentencePrefixOverlapRatio = calculateSentencePrefixOverlapRatio(sourceText, generatedText, 6);
    if (sentencePrefixOverlapRatio >= 0.4) {
        return true;
    }

    return false;
}

function buildRewriteValidationErrors({
  originalSubject,
  sourceText,
  rewrittenPost,
  useStrictLengthRules,
  includeEditorialFocusValidation = false
}) {
  const validationErrors = [];

  if (useStrictLengthRules && rewrittenPost.content_text.length < minimumContentTextLength) {
    validationErrors.push(`OpenAI-Inhalt ist zu kurz.
Aktuell: ${rewrittenPost.content_text.length} Zeichen.`);
  }

  if (containsColonInVisibleArticle(rewrittenPost)) {
    validationErrors.push(
      'OpenAI-Beitrag enthält einen Doppelpunkt im sichtbaren redaktionellen Text.'
    );
  }

  const firstContentParagraph = extractFirstContentParagraphText(
    rewrittenPost.content_html
  );

  if (
    isLeadTooSimilarToFirstParagraph(
      rewrittenPost.excerpt,
      firstContentParagraph
    )
  ) {
    validationErrors.push(
      'Lead und erster Absatz wiederholen weitgehend dieselben Aussagen und Eckdaten.'
    );
  }

  if (rewrittenPost.title.length > maximumTitleLength) {
    validationErrors.push(`OpenAI-Titel ist zu lang. Aktuell: ${rewrittenPost.title.length} Zeichen.`);
  }

  if (rewrittenPost.content_html.length > maximumContentHtmlLength) {
    validationErrors.push(`OpenAI-HTML ist zu lang. Aktuell: ${rewrittenPost.content_html.length} Zeichen.`);
  }

  if (containsDashLikeCharacterInTitle(rewrittenPost.title)) {
    validationErrors.push('OpenAI-Titel enthält einen Gedankenstrich oder stilistischen Bindestrich.');
  }

  if (isTitleTooCloseToSubject(originalSubject, rewrittenPost.title)) {
    validationErrors.push('OpenAI-Titel ist dem Originaltitel zu ähnlich.');
  }

  const dashStyleCountInContent = countDashStyleOccurrences(rewrittenPost.content_text);

  if (dashStyleCountInContent > 1) {
    validationErrors.push(`OpenAI-Inhalt enthält zu viele Gedankenstriche.
Aktuell: ${dashStyleCountInContent}.`);
  }

  if (isTooCloseToSource(sourceText, rewrittenPost.content_text)) {
    validationErrors.push('OpenAI-Text ist noch zu nah am Originaltext.');
  }

  if (rewrittenPost.category_resolution_error) {
    validationErrors.push(rewrittenPost.category_resolution_error);
  }

  if (rewrittenPost.keyword_resolution_error) {
    validationErrors.push(rewrittenPost.keyword_resolution_error);
  }

  if (!Array.isArray(rewrittenPost.category_ids) || rewrittenPost.category_ids.length < minimumSelectedCategoryCount) {
    validationErrors.push(`Es wurden weniger als ${minimumSelectedCategoryCount} finale Kategorien ermittelt.`);
  }

  if (!Array.isArray(rewrittenPost.thematic_keyword_names) || rewrittenPost.thematic_keyword_names.length < minimumThematicKeywordCount) {
    validationErrors.push(`Es wurden weniger als ${minimumThematicKeywordCount} thematische Stichwörter ermittelt.`);
  }

  if (includeEditorialFocusValidation) {
    validationErrors.push(...buildEditorialFocusValidationErrors(rewrittenPost));
  }

  return validationErrors;
}

function containsColonInVisibleArticle(rewrittenPost) {
    const contentHtmlWithoutLinkText = String(
        rewrittenPost.content_html || ''
    ).replace(
        /<a\b[^>]*>[\s\S]*?<\/a>/gi,
        ''
    );

    const visibleContentText = htmlToPlainText(
        contentHtmlWithoutLinkText
    );

    const visibleArticleParts = [
        rewrittenPost.title,
        rewrittenPost.excerpt,
        visibleContentText
    ];

    return visibleArticleParts.some((articlePart) => {
        return String(articlePart || '').includes(':');
    });
}

function extractFirstContentParagraphText(contentHtml) {
    const firstParagraphMatch = String(contentHtml || '').match(
        /<p\b[^>]*>[\s\S]*?<\/p>/i
    );

    if (!firstParagraphMatch) {
        return '';
    }

    return normalizeWhitespace(
        htmlToPlainText(firstParagraphMatch[0])
    );
}

function isLeadTooSimilarToFirstParagraph(
    lead,
    firstParagraph
) {
    const normalizedLead = normalizeComparisonText(lead);
    const normalizedFirstParagraph =
        normalizeComparisonText(firstParagraph);

    if (!normalizedLead || !normalizedFirstParagraph) {
        return false;
    }

    if (normalizedLead === normalizedFirstParagraph) {
        return true;
    }

    const shorterTextLength = Math.min(
        normalizedLead.length,
        normalizedFirstParagraph.length
    );

    if (
        shorterTextLength >= 80 &&
        (
            normalizedLead.includes(normalizedFirstParagraph) ||
            normalizedFirstParagraph.includes(normalizedLead)
        )
    ) {
        return true;
    }

    const leadWords = extractMeaningfulComparisonWords(
        normalizedLead
    );

    const firstParagraphWords =
        extractMeaningfulComparisonWords(
            normalizedFirstParagraph
        );

    if (
        Math.min(
            leadWords.length,
            firstParagraphWords.length
        ) < 6
    ) {
        return false;
    }

    const wordOverlapRatio = calculateWordOverlapRatio(
        leadWords,
        firstParagraphWords
    );

    const fiveWordOverlapRatio =
        calculateShingleOverlapRatio(
            normalizedLead,
            normalizedFirstParagraph,
            5
        );

    const sharedNumericValueCount =
        countSharedNumericValues(
            lead,
            firstParagraph
        );

    if (
        wordOverlapRatio >= 0.85 &&
        fiveWordOverlapRatio >= 0.25
    ) {
        return true;
    }

    if (
        sharedNumericValueCount >= 2 &&
        wordOverlapRatio >= 0.65
    ) {
        return true;
    }

    return fiveWordOverlapRatio >= 0.55;
}

function countSharedNumericValues(firstText, secondText) {
    const firstNumericValues = new Set(
        extractNumericValues(firstText)
    );

    const secondNumericValues = new Set(
        extractNumericValues(secondText)
    );

    let sharedNumericValueCount = 0;

    for (const numericValue of firstNumericValues) {
        if (secondNumericValues.has(numericValue)) {
            sharedNumericValueCount += 1;
        }
    }

    return sharedNumericValueCount;
}

function extractNumericValues(text) {
    const numericMatches = String(text || '').match(
        /\b\d[\d’'.]*\b/g
    );

    if (!numericMatches) {
        return [];
    }

    return numericMatches.map((numericValue) => {
        return numericValue.replace(/[’'.]/g, '');
    });
}

function buildEditorialFocusValidationErrors(rewrittenPost) {
  const validationErrors = [];

  const editorialFocus = normalizeWhitespace(rewrittenPost.editorial_focus || '');
  const editorialRelevance = normalizeWhitespace(rewrittenPost.editorial_relevance || '');
  const supportingAspects = Array.isArray(rewrittenPost.supporting_aspects)
    ? rewrittenPost.supporting_aspects
    : [];

  if (editorialFocus.length < 20) {
    validationErrors.push('OpenAI hat keinen klaren redaktionellen Fokus geliefert.');
  }

  if (editorialRelevance.length < 20) {
    validationErrors.push('OpenAI hat keine klare redaktionelle Relevanz geliefert.');
  }

  if (supportingAspects.length > 3) {
    validationErrors.push('OpenAI verwendet zu viele stützende Aspekte.');
  }

  if (hasGenericEditorialTitle(rewrittenPost.title)) {
    validationErrors.push('OpenAI-Titel ist zu allgemein und gibt keinen klaren Hauptwinkel vor.');
  }

  if (!doesTextReflectEditorialFocus(rewrittenPost)) {
    validationErrors.push('OpenAI-Inhalt folgt dem angegebenen redaktionellen Fokus nicht klar genug.');
  }

  return validationErrors.slice(0, 1);
}

function hasGenericEditorialTitle(title) {
  const genericPatterns = [
    /\bim fokus\b/i,
    /\brückt ins zentrum\b/i,
    /\bmit folgen\b/i,
    /\bvor veränderungen\b/i,
    /\bim wandel\b/i,
    /\bneue dynamik\b/i,
    /\bbranche reagiert\b/i
  ];

  return genericPatterns.some((pattern) => pattern.test(title));
}

function doesTextReflectEditorialFocus(rewrittenPost) {
  const editorialFocusWords = extractMeaningfulComparisonWords(
    normalizeComparisonText(rewrittenPost.editorial_focus || '')
  );

  const visibleText = normalizeComparisonText(
    [
      rewrittenPost.title,
      rewrittenPost.excerpt,
      rewrittenPost.content_text
    ].join(' ')
  );

  if (editorialFocusWords.length < 3 || !visibleText) {
    return true;
  }

  const visibleWords = new Set(visibleText.split(' ').filter(Boolean));
  const matchingWords = editorialFocusWords.filter((word) => visibleWords.has(word));

  return matchingWords.length / editorialFocusWords.length >= 0.35;
}

function finalizeExcerptText(excerpt) {
    return String(excerpt || '')
        .trim()
        .replace(/[\s,;:-]+$/g, '')
        .trim();
}

function containsDashLikeCharacterInTitle(title) {
    const normalizedTitle = String(title || '');

    return /[–—]/.test(normalizedTitle) || /\s-\s/.test(normalizedTitle);
}

function countDashStyleOccurrences(text) {
    const dashMatches = String(text || '').match(/(?:^|\s)[-–—](?=\s|$)|[–—]/g);
    return dashMatches ? dashMatches.length : 0;
}

function isTitleTooCloseToSubject(originalSubject, generatedTitle) {
    const normalizedOriginalSubject = normalizeComparisonText(originalSubject);
    const normalizedGeneratedTitle = normalizeComparisonText(generatedTitle);

    if (!normalizedOriginalSubject || !normalizedGeneratedTitle) {
        return false;
    }

    if (normalizedOriginalSubject === normalizedGeneratedTitle) {
        return true;
    }

    if (
        normalizedGeneratedTitle.length >= 12 &&
        (
            normalizedOriginalSubject.includes(normalizedGeneratedTitle) ||
            normalizedGeneratedTitle.includes(normalizedOriginalSubject)
        )
    ) {
        return true;
    }

    const originalWords = extractMeaningfulComparisonWords(normalizedOriginalSubject);
    const generatedWords = extractMeaningfulComparisonWords(normalizedGeneratedTitle);

    if (originalWords.length === 0 || generatedWords.length === 0) {
        return false;
    }

    const wordOverlapRatio = calculateWordOverlapRatio(originalWords, generatedWords);
    if (wordOverlapRatio >= 0.8 && Math.min(originalWords.length, generatedWords.length) >= 2) {
        return true;
    }

    const originalTwoWordShingles = buildArrayShingles(originalWords, 2);
    const generatedTwoWordShingles = buildArrayShingles(generatedWords, 2);
    const twoWordOverlapRatio = calculateSetOverlapRatio(originalTwoWordShingles, generatedTwoWordShingles);

    if (twoWordOverlapRatio >= 0.5 && Math.min(originalWords.length, generatedWords.length) >= 3) {
        return true;
    }

    return false;
}

function extractMeaningfulComparisonWords(normalizedText) {
    const ignoredWords = new Set([
        'der', 'die', 'das', 'den', 'dem', 'des',
        'ein', 'eine', 'einer', 'eines', 'einem', 'einen',
        'und', 'oder', 'aber', 'doch', 'noch',
        'im', 'in', 'am', 'an', 'auf', 'zu', 'zum', 'zur', 'von', 'mit', 'fuer',
        'sich', 'ist', 'sind', 'war', 'waren', 'wird', 'werden',
        'weiter', 'erneut', 'leicht', 'mehr', 'weniger', 'etwas'
    ]);

    return String(normalizedText || '')
        .split(' ')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry) => entry.length > 2)
        .filter((entry) => !ignoredWords.has(entry));
}

function calculateWordOverlapRatio(wordsA, wordsB) {
    const setA = new Set(wordsA);
    const setB = new Set(wordsB);

    let overlapCount = 0;
    for (const entry of setA) {
        if (setB.has(entry)) {
            overlapCount += 1;
        }
    }

    return overlapCount / Math.min(setA.size, setB.size);
}

function calculateShingleOverlapRatio(textA, textB, shingleSize) {
    const shinglesA = buildWordShingles(textA, shingleSize);
    const shinglesB = buildWordShingles(textB, shingleSize);

    return calculateSetOverlapRatio(shinglesA, shinglesB);
}

function calculateSentencePrefixOverlapRatio(sourceText, generatedText, prefixWordCount) {
    const sourceSentencePrefixes = buildSentencePrefixes(sourceText, prefixWordCount);
    const generatedSentencePrefixes = buildSentencePrefixes(generatedText, prefixWordCount);

    return calculateSetOverlapRatio(sourceSentencePrefixes, generatedSentencePrefixes);
}

function buildSentencePrefixes(text, prefixWordCount) {
    const comparableSentences = splitIntoComparableSentences(text);
    const prefixSet = new Set();

    for (const sentence of comparableSentences) {
        const words = normalizeComparisonText(sentence)
            .split(' ')
            .filter(Boolean);

        if (words.length < prefixWordCount) {
            continue;
        }

        prefixSet.add(words.slice(0, prefixWordCount).join(' '));
    }

    return prefixSet;
}

function splitIntoComparableSentences(text) {
    return String(text || '')
        .split(/[\.\!\?\n]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length >= 25);
}

function buildArrayShingles(words, shingleSize) {
    const shingleSet = new Set();

    if (words.length < shingleSize) {
        if (words.length > 0) {
            shingleSet.add(words.join(' '));
        }

        return shingleSet;
    }

    for (let index = 0; index <= words.length - shingleSize; index += 1) {
        shingleSet.add(words.slice(index, index + shingleSize).join(' '));
    }

    return shingleSet;
}

function calculateSetOverlapRatio(setA, setB) {
    if (setA.size === 0 || setB.size === 0) {
        return 0;
    }

    let overlapCount = 0;
    for (const entry of setA) {
        if (setB.has(entry)) {
            overlapCount += 1;
        }
    }

    return overlapCount / Math.min(setA.size, setB.size);
}

function buildWordShingles(text, size) {
    const words = text.split(' ').filter(Boolean);
    const shingleSet = new Set();

    if (words.length < size) {
        shingleSet.add(words.join(' '));
        return shingleSet;
    }

    for (let index = 0; index <= words.length - size; index += 1) {
        shingleSet.add(words.slice(index, index + size).join(' '));
    }

    return shingleSet;
}

function buildExcerptFromText(contentText) {
    const normalizedText = normalizeWhitespace(contentText);

    if (!normalizedText) {
        return '';
    }

    const preferredLength = 280;
    const excerptLength = Math.min(
        maximumExcerptLength,
        Math.max(minimumExcerptLength, preferredLength)
    );

    return truncateToLength(normalizedText, excerptLength);
}

function extractOutputText(responseBody) {
    if (typeof responseBody?.output_text === 'string' && responseBody.output_text.trim()) {
        return responseBody.output_text.trim();
    }

    const outputEntries = Array.isArray(responseBody?.output) ? responseBody.output : [];
    for (const outputEntry of outputEntries) {
        const contentEntries = Array.isArray(outputEntry?.content) ? outputEntry.content : [];
        for (const contentEntry of contentEntries) {
            if (typeof contentEntry?.text === 'string' && contentEntry.text.trim()) {
                return contentEntry.text.trim();
            }
        }
    }

    return '';
}

function buildFeaturedImageGenerationPrompt(featuredImagePrompt) {
    const normalizedFeaturedImagePrompt = normalizeWhitespace(featuredImagePrompt);

    return [
        'Create a realistic editorial photo for a Swiss real estate news website.',
        'The image must look like a professional photographic header image, not an illustration.',
        'Do not include any readable text anywhere in the image.',
        'Do not include signs, street signs, construction signs, billboards, posters, plaques, banners, labels, documents, newspapers, screens, UI elements, maps, charts, infographics, license plates, logos, brand names, company names, watermarks, captions, typography, letters or numbers.',
        'If the scene would naturally contain signage, use camera angle, distance, cropping or composition so that no text, symbols, logos, letters or numbers are visible or readable.',
        'Prefer clean architecture, building facades without signage, construction sites without boards, city streets without readable shopfronts, interiors without screens, or abstract real estate context.',
        'No cartoon style. No illustration. No 3D render. No artificial graphic design.',
        '',
        `Image idea: ${normalizedFeaturedImagePrompt}`
    ].join('\n');
}

async function generateFeaturedImageWithOpenAi(rewrittenPost) {
    const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openAiApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: openAiImageModel,
            prompt: buildFeaturedImageGenerationPrompt(rewrittenPost.featured_image_prompt_en),
            size: openAiImageSize,
            quality: openAiImageQuality,
            output_format: openAiImageOutputFormat,
            background: 'opaque',
            moderation: 'auto'
        })
    });

    if (!imageResponse.ok) {
        const errorText = await imageResponse.text();
        throw new Error(`OpenAI Bildfehler ${imageResponse.status}: ${errorText}`);
    }

    const imageResponseBody = await imageResponse.json();
    const imageBase64 = imageResponseBody?.data?.[0]?.b64_json;

    if (!imageBase64) {
        throw new Error('OpenAI hat kein Bild zurückgegeben.');
    }

    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const safeSlug = sanitizeSlug(rewrittenPost.slug || rewrittenPost.title || 'featured-image') || 'featured-image';
    const fileExtension = openAiImageOutputFormat === 'png' ? 'png' : openAiImageOutputFormat === 'webp' ? 'webp' : 'jpg';
    const mimeType = openAiImageOutputFormat === 'png'
        ? 'image/png'
        : openAiImageOutputFormat === 'webp'
            ? 'image/webp'
            : 'image/jpeg';

    return {
        buffer: imageBuffer,
        mimeType,
        filename: `${safeSlug}.${fileExtension}`,
        title: rewrittenPost.title,
        altText: rewrittenPost.featured_image_alt_text_de
    };
}

function normalizeMidjourneyPrompt(promptValue, fallbackPromptValue = '') {
  const rawPrompt = normalizeWhitespace(promptValue || fallbackPromptValue);

  if (!rawPrompt) {
    throw new Error('OpenAI-Antwort enthält keinen gültigen Midjourney-Prompt.');
  }

  const promptWithoutMidjourneyParameters = rawPrompt
    .replace(/\s+--ar\s+\S+/gi, '')
    .replace(/\s+--q\s+\S+/gi, '')
    .replace(/\s+--no\s+.*$/i, '')
    .replace(/[.,;:\s]+$/g, '')
    .trim();

  if (!promptWithoutMidjourneyParameters) {
    throw new Error('OpenAI-Antwort enthält keinen verwertbaren Midjourney-Prompt.');
  }

  return `${promptWithoutMidjourneyParameters} ${midjourneyPromptEnding}`;
}

function normalizeSourceReferences(sourceReferences) {
  if (!Array.isArray(sourceReferences)) {
    return [];
  }

  const normalizedReferences = [];
  const seenUrls = new Set();

  for (const sourceReference of sourceReferences) {
    const title = normalizeWhitespace(sourceReference?.title || '');
    const url = normalizeWhitespace(sourceReference?.url || '');
    const usedFor = normalizeWhitespace(sourceReference?.used_for || '');

    if (!title || !url || !usedFor) {
      continue;
    }

    if (!/^https?:\/\//i.test(url)) {
      continue;
    }

    const normalizedUrlKey = url.toLowerCase();

    if (seenUrls.has(normalizedUrlKey)) {
      continue;
    }

    seenUrls.add(normalizedUrlKey);

    normalizedReferences.push({
      title: truncateToLength(title, 180),
      url: truncateToLength(url, 500),
      used_for: truncateToLength(usedFor, 300)
    });
  }

  return normalizedReferences.slice(0, 8);
}

function normalizeAdditionalInstructionsForPrompt(additionalInstructions) {
  const normalizedAdditionalInstructions = String(additionalInstructions || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalizedAdditionalInstructions) {
    return '';
  }

  return normalizedAdditionalInstructions.slice(0, 3000);
}

module.exports = {
    rewriteMailWithOpenAi,
    prepareOriginalMailWithOpenAi,
    shouldUseStrictLengthRules,
    generateFeaturedImageWithOpenAi
};