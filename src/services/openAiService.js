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
    getAllowedCategoryOptionsForAi,
    resolveSelectedCategories,
    normalizeSelectedCategoryKeys
} = require('./taxonomyService');

const {
    normalizeAiKeywordNames,
    resolveKeywordNames
} = require('./keywordService');

async function rewriteMailWithOpenAi({ subject, from, sourceText }) {
    const useStrictLengthRules = shouldUseStrictLengthRules(sourceText);

    const firstAttempt = await requestOpenAiRewrite({
        subject,
        from,
        sourceText,
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
        useStrictLengthRules
    });

    if (!needsSecondRewriteAttempt(firstValidationErrors)) {
        return enrichedFirstAttempt;
    }

    const secondAttempt = await requestOpenAiRewrite({
        subject,
        from,
        sourceText,
        forceStrongRewrite: true,
        useStrictLengthRules
    });

    const normalizedSecondAttempt = normalizeGeneratedPost(secondAttempt, useStrictLengthRules);
    const enrichedSecondAttempt = attachResolvedKeywords(
        attachResolvedCategories(normalizedSecondAttempt)
    );

    const secondValidationErrors = buildRewriteValidationErrors({
        originalSubject: subject,
        sourceText,
        rewrittenPost: enrichedSecondAttempt,
        useStrictLengthRules
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

async function requestOpenAiRewrite({ subject, from, sourceText, forceStrongRewrite, useStrictLengthRules }) {
    const developerInstruction = buildDeveloperInstruction({
        forceStrongRewrite,
        useStrictLengthRules
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
        external_web_access: true
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

function buildDeveloperInstruction({ forceStrongRewrite, useStrictLengthRules }) {
    const currentDateText = getCurrentSwissDateText();

    const instructionParts = [
        'Du bist Redaktor für eine professionelle Schweizer Immobilien-Website.',
        `Aktuelles Datum für Recherche und Einordnung: ${currentDateText}.`,
        'Die Web-Recherche muss die aktuelle Informationslage zu diesem Datum berücksichtigen.',
        'Suche bevorzugt nach aktuellen Quellen und prüfe, ob Informationen noch gültig sind.',
        'Verwende keine alten Informationen als aktuelle Fakten, wenn neuere Quellen verfügbar sind.',
        'Achte bei Quellen auf Veröffentlichungsdatum, Aktualisierungsdatum und erkennbare Aktualität.',
        'Wenn eine Quelle älter ist, darf sie nur für Hintergrundinformationen, Historie oder unveränderte Fakten verwendet werden.',
        'Wenn sich ältere und neuere Quellen widersprechen, verwende die neuere und verlässlichere Quelle oder formuliere die Unsicherheit klar.',
        'Wenn keine aktuellen belastbaren Webinformationen gefunden werden, schreibe keinen scheinbar aktuellen Beitrag, sondern formuliere zurückhaltend.',
        'Der Beitrag soll den Stand der recherchierten Informationen zum aktuellen Datum widerspiegeln.',
        'Die gelieferte E-Mail ist nur der Ausgangspunkt für die Recherche und nicht das Endergebnis.',
        'Nutze die E-Mail, um relevante Themen, Firmen, Projekte, Orte, Personen, Daten, Zahlen, Entwicklungen und mögliche Nachrichtenwerte zu erkennen.',
        'Erstelle keinen blossen Rewrite und keine sprachlich umformulierte Version der E-Mail.',
        'Führe verpflichtend eine Web-Recherche durch, bevor du den Beitrag schreibst.',
        'Recherchiere zusätzliche, verlässliche Informationen aus dem Web, die den Inhalt einordnen, ergänzen oder aus einer neuen Perspektive beleuchten.',
        'Bevorzuge offizielle Quellen, Unternehmensseiten, Projektseiten, Behörden, Handelsregister, Medienmitteilungen, seriöse Medien, Branchenquellen und belastbare Marktdaten.',
        'Nutze keine Foren, Social-Media-Posts, Reddit, Quora oder Wikipedia als Hauptquelle.',
        'Übernimm keine ungeprüften Behauptungen aus der E-Mail.',
        'Prüfe Aussagen aus der E-Mail anhand der Web-Recherche, bevor du sie als Tatsache verwendest.',
        'Neue Fakten aus dem Web dürfen nur verwendet werden, wenn sie durch eine verlässliche Quelle gestützt sind.',
        'Wenn Angaben aus der E-Mail im Web nicht verifiziert werden können, formuliere sie vorsichtig oder lasse sie weg.',
        'Wenn die Web-Recherche zusätzliche relevante Informationen liefert, erweitere den Beitrag damit und wähle bei Bedarf einen neuen redaktionellen Blickwinkel.',
        'Wenn die Web-Recherche zeigt, dass ein anderer Aspekt wichtiger, aktueller oder interessanter ist als der E-Mail-Text selbst, darf der Beitrag aus diesem neuen Blickwinkel aufgebaut werden.',
        'Wenn die Web-Recherche keine belastbaren Zusatzinformationen liefert, schreibe einen eigenständigen Beitrag auf Basis des Inputs, aber ohne ungesicherte Zusatzdetails.',
        'Der fertige Beitrag muss wie ein eigenständiger redaktioneller Artikel wirken und deutlich mehr sein als eine Umformulierung der E-Mail.',
        'Der Beitrag soll informieren, einordnen und für Leserinnen und Leser einer Schweizer Immobilien-Website relevant sein.',
        'Schreibe neutral, professionell, journalistisch und zugleich interessant.',
        'Schreibe sachlich, klar und gut lesbar.',
        'Vermeide werbliche Sprache, PR-Floskeln und unkritische Formulierungen.',
        'Titel, Auszug und Inhalt müssen eigenständig neu formuliert werden.',
        'Der Text darf nicht 1:1 oder nahezu 1:1 aus dem Input übernommen werden.',
        'Der Titel muss immer neu formuliert werden und darf niemals dem Originaltitel entsprechen oder ihm nur leicht umgestellt ähneln.',
        'Wähle für den Titel eine neue, redaktionelle und prägnante Formulierung mit maximal 40 Zeichen.',
        'Der Titel darf keinen Doppelpunkt enthalten.',
        'Im Titel dürfen keine Gedankenstriche, Halbgeviertstriche oder Bindestrich-Konstruktionen als Stilmittel vorkommen.',
        'Verwende im Titel keine Firmennamen, Markennamen oder Produktnamen.',
        'Verwende im Inhalt grundsätzlich keine Firmennamen, Markennamen oder Produktnamen.',
        'Falls ein Firmenname, Markenname oder Produktname aus inhaltlichen Gründen zwingend notwendig ist, nenne ihn nur sparsam, neutral und ohne werbliche Wirkung.',
        'Der Textauszug soll den Beitrag kurz, verständlich und sauber zusammenfassen.',
        'Der Textauszug soll nicht nur die E-Mail zusammenfassen, sondern den redaktionellen Kern des neu recherchierten Beitrags wiedergeben.',
        'content_html soll ein sauberer WordPress-Inhalt sein.',
        'Verwende gültiges HTML, aber ohne <html> oder <body>.',
        'Gib keinen Markdown-Codeblock aus.',
        'Gib keinen Werbetext, keine Spam-Phrasen, keine fremdsprachigen Fragmente, keine Sonderzeichenketten und keine irrelevanten Zusätze aus.',
        'Verwende im gesamten zurückgegebenen Text keine Gedankenstriche als Stilmittel.',
        'Im Inhalt ist höchstens ein einzelner Gedankenstrich erlaubt, und nur wenn er sprachlich wirklich notwendig ist.',
        'Baue den Beitrag redaktionell eigenständig auf und übernimm nicht einfach die Struktur der Vorlage.',
        'Verwende nach Möglichkeit einen anderen Einstieg als die Vorlage.',
        'Beginne den Beitrag mit dem wichtigsten redaktionellen Ergebnis der Recherche, nicht zwingend mit dem ersten Punkt aus der E-Mail.',
        'Übernimm nicht die gleiche Reihenfolge der Aussagen, Absätze oder Argumente wie im Input.',
        'Übernimm nicht bloss einzelne Sätze in leicht veränderter Form, sondern strukturiere, verdichte, prüfe, ergänze und formuliere den Inhalt redaktionell neu.',
        'Vermeide auffällige Formulierungsmuster, Satzanfänge und Standardwendungen aus der Vorlage und ersetze sie durch eigenständige journalistische Formulierungen.',
        'Wenn der Input zu kurz ist, nutze die Web-Recherche für sinnvollen Kontext, aber fülle den Beitrag nicht künstlich mit irrelevanten Informationen auf.',
        'Wenn Webquellen verwendet werden, soll content_html am Ende einen kurzen Quellenabschnitt mit passenden HTML-Links enthalten.',
        'Der Quellenabschnitt soll nur Quellen enthalten, die tatsächlich für zusätzliche Informationen im Beitrag verwendet wurden.',
        'Falls das JSON-Schema ein Feld source_references enthält, fülle es mit den wichtigsten tatsächlich verwendeten Webquellen.',
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
        'Gib ausschliesslich valides JSON gemäss dem vorgegebenen Schema zurück.'
    ];

    if (forceStrongRewrite) {
        instructionParts.push('Achte besonders darauf, dass Formulierungen, Satzbau, Einstieg und Aufbau klar vom Original abweichen.');
        instructionParts.push('Wenn ein Titel, ein Auszug, ein Absatz oder eine Passage dem Input zu ähnlich ist, formuliere sie vollständig neu.');
        instructionParts.push('Wenn der Beitrag in Aufbau oder Reihenfolge noch zu nahe an der Vorlage ist, ordne den Inhalt neu.');
        instructionParts.push('Wenn der Beitrag zu stark nach einer E-Mail-Zusammenfassung klingt, schreibe ihn stärker als eigenständigen redaktionellen Artikel.');
        instructionParts.push('Wenn die Web-Recherche einen besseren redaktionellen Fokus liefert als der ursprüngliche E-Mail-Aufbau, richte den Beitrag auf diesen Fokus aus.');
        instructionParts.push('Wenn Kategorien zu allgemein sind, wähle passendere und spezifischere Kategorien aus der Liste.');
        instructionParts.push('Wenn Stichwörter zu allgemein sind, wähle passendere und thematischere Stichwörter.');
        instructionParts.push('Wenn der Titel einen Firmennamen, Markennamen, Produktnamen, Doppelpunkt oder Gedankenstrich enthält, formuliere ihn vollständig neu.');
    }

    if (useStrictLengthRules) {
        instructionParts.push(`Der Textauszug muss mindestens ${minimumExcerptLength} und maximal ${maximumExcerptLength} Zeichen lang sein.`);
        instructionParts.push(`content_html muss mindestens ${minimumContentTextLength} und maximal ${maximumContentHtmlLength} Zeichen lang sein.`);
    } else {
        instructionParts.push(`Der Textauszug soll bevorzugt zwischen ${minimumExcerptLength} und ${maximumExcerptLength} Zeichen liegen, falls der Input und die Web-Recherche dafür genug Substanz liefern.`);
        instructionParts.push(`content_html soll bevorzugt mindestens ${minimumContentTextLength} Zeichen lang sein, falls der Input und die Web-Recherche dafür genug Substanz liefern, aber maximal ${maximumContentHtmlLength} Zeichen.`);
    }

    return instructionParts.join(' ');
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
            }
        },
        required: [
            'title',
            'excerpt',
            'slug',
            'content_html',
            'selected_category_keys',
            'keyword_names',
            'featured_image_prompt_en',
            'featured_image_alt_text_de',
            'source_references'
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
        'Gib ausschliesslich valides JSON gemäss dem vorgegebenen Schema zurück.'
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
            }
        },
        required: [
            'title',
            'lead',
            'selected_category_keys',
            'keyword_names',
            'featured_image_prompt_en',
            'featured_image_alt_text_de'
        ],
        additionalProperties: false
    };
}

function normalizeGeneratedPost(parsedResponse, useStrictLengthRules) {
    const title = truncateToLength(
        normalizeWhitespace(parsedResponse.title || ''),
        maximumTitleLength
    );

    let contentHtml = normalizeGeneratedHtml(parsedResponse.content_html || '');
    if (!contentHtml) {
        throw new Error('OpenAI-Antwort enthält keinen gültigen Inhalt.');
    }

    if (contentHtml.length > maximumContentHtmlLength) {
        const shortenedPlainText = truncateToLength(
            htmlToPlainText(contentHtml),
            maximumContentHtmlLength
        );

        contentHtml = `<p>${escapeHtml(shortenedPlainText)}</p>`;
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
        keyword_names: normalizeAiKeywordNames(parsedResponse.keyword_names),
        featured_image_prompt_en: featuredImagePrompt,
        featured_image_alt_text_de: featuredImageAltText,
        source_references: sourceReferences
    };
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
            category_resolution_error: error.message
        };
    }
}

function attachResolvedCategories(normalizedGeneratedPost) {
    const resolvedCategories = resolveSelectedCategories(normalizedGeneratedPost.selected_category_keys);

    return {
        ...normalizedGeneratedPost,
        selected_category_keys: resolvedCategories.selectedKeys,
        selected_category_titles: resolvedCategories.selectedTitles,
        category_ids: resolvedCategories.wordpressCategoryIds
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

function buildRewriteValidationErrors({ originalSubject, sourceText, rewrittenPost, useStrictLengthRules }) {
    const validationErrors = [];

    if (useStrictLengthRules && rewrittenPost.content_text.length < minimumContentTextLength) {
        validationErrors.push(`OpenAI-Inhalt ist zu kurz. Aktuell: ${rewrittenPost.content_text.length} Zeichen.`);
    }

    if (rewrittenPost.title.includes(':')) {
        validationErrors.push('OpenAI-Titel enthält einen Doppelpunkt.');
    }

    if (containsDashLikeCharacterInTitle(rewrittenPost.title)) {
        validationErrors.push('OpenAI-Titel enthält einen Gedankenstrich oder Bindestrich.');
    }

    if (isTitleTooCloseToSubject(originalSubject, rewrittenPost.title)) {
        validationErrors.push('OpenAI-Titel ist dem Originaltitel zu ähnlich.');
    }

    const dashStyleCountInContent = countDashStyleOccurrences(rewrittenPost.content_text);
    if (dashStyleCountInContent > 1) {
        validationErrors.push(`OpenAI-Inhalt enthält zu viele Gedankenstriche. Aktuell: ${dashStyleCountInContent}.`);
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

    return validationErrors;
}

function finalizeExcerptText(excerpt) {
    return String(excerpt || '')
        .trim()
        .replace(/[\s,;:-]+$/g, '')
        .trim();
}

function containsDashLikeCharacterInTitle(title) {
    return /[-–—]/.test(String(title || ''));
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

async function generateFeaturedImageWithOpenAi(rewrittenPost) {
    const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openAiApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: openAiImageModel,
            prompt: rewrittenPost.featured_image_prompt_en,
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

module.exports = {
    rewriteMailWithOpenAi,
    prepareOriginalMailWithOpenAi,
    shouldUseStrictLengthRules,
    generateFeaturedImageWithOpenAi
};