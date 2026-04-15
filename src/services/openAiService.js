const {
    openAiApiKey,
    openAiModel
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

    if (!needsSecondRewriteAttempt(sourceText, enrichedFirstAttempt, useStrictLengthRules)) {
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

    if (isTooCloseToSource(sourceText, enrichedSecondAttempt.content_text)) {
        throw new Error('OpenAI-Text ist noch zu nah am Originaltext.');
    }

    if (useStrictLengthRules && enrichedSecondAttempt.content_text.length < minimumContentTextLength) {
        throw new Error(`OpenAI-Inhalt ist zu kurz. Aktuell: ${enrichedSecondAttempt.content_text.length} Zeichen.`);
    }

    if (!Array.isArray(enrichedSecondAttempt.category_ids) || enrichedSecondAttempt.category_ids.length < minimumSelectedCategoryCount) {
        throw new Error(`Es wurden weniger als ${minimumSelectedCategoryCount} finale Kategorien ermittelt.`);
    }

    if (!Array.isArray(enrichedSecondAttempt.thematic_keyword_names) || enrichedSecondAttempt.thematic_keyword_names.length < minimumThematicKeywordCount) {
        throw new Error(`Es wurden weniger als ${minimumThematicKeywordCount} thematische Stichwörter ermittelt.`);
    }

    return enrichedSecondAttempt;
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

function buildDeveloperInstruction({ forceStrongRewrite, useStrictLengthRules }) {
    const instructionParts = [
        'Du bist Redaktor für eine professionelle Schweizer Immobilien-Website.',
        'Erstelle aus der gelieferten E-Mail einen eigenständigen redaktionellen WordPress-Entwurf.',
        'Übernimm keine erfundenen Fakten und bleibe inhaltlich beim gelieferten Input.',
        'Schreibe sachlich, klar und professionell.',
        'Der Text darf nicht 1:1 oder nahezu 1:1 aus dem Input übernommen werden.',
        'Formuliere Titel, Auszug und Inhalt eigenständig neu.',
        'Der Titel muss immer neu formuliert werden.',
        'Übernimm den Originaltitel niemals unverändert und auch nicht nur mit kleinen Umstellungen.',
        'Wähle für den Titel eine neue, redaktionelle, prägnante Formulierung mit maximal 40 Zeichen.',
        'Der Textauszug soll den Beitrag kurz und verständlich zusammenfassen.',
        'content_html soll ein sauberer WordPress-Inhalt sein.',
        'Verwende gültiges HTML, aber ohne <html> oder <body>.',
        'Gib keinen Markdown-Codeblock aus.',
        'Gib keinen Werbetext, keine Spam-Phrasen, keine fremdsprachigen Fragmente, keine Sonderzeichenketten und keine irrelevanten Zusätze aus.',
        'Wenn der Input zu kurz ist, liefere einen sinnvollen kürzeren Beitrag statt künstlich Länge aufzufüllen.',
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
        'Gib ausschliesslich valides JSON gemäss dem vorgegebenen Schema zurück.'
    ];

    if (forceStrongRewrite) {
        instructionParts.push('Achte besonders darauf, dass Formulierungen und Satzbau klar vom Original abweichen.');
        instructionParts.push('Wenn ein Titel oder eine Passage dem Input zu ähnlich ist, formuliere sie erneut um.');
        instructionParts.push('Wenn die Kategorien zu allgemein sind, wähle passendere und spezifischere Kategorien aus der Liste.');
        instructionParts.push('Wenn die Stichwörter zu allgemein sind, wähle passendere und thematischere Stichwörter.');
    }

    if (useStrictLengthRules) {
        instructionParts.push(`Der Textauszug muss mindestens ${minimumExcerptLength} und maximal ${maximumExcerptLength} Zeichen lang sein.`);
        instructionParts.push(`content_html muss mindestens ${minimumContentTextLength} und maximal ${maximumContentHtmlLength} Zeichen lang sein.`);
    } else {
        instructionParts.push(`Der Textauszug soll bevorzugt zwischen ${minimumExcerptLength} und ${maximumExcerptLength} Zeichen liegen, falls der Input dafür lang genug ist.`);
        instructionParts.push(`content_html soll bevorzugt mindestens ${minimumContentTextLength} Zeichen lang sein, falls der Input dafür lang genug ist, aber maximal ${maximumContentHtmlLength} Zeichen.`);
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
            }
        },
        required: ['title', 'excerpt', 'slug', 'content_html', 'selected_category_keys', 'keyword_names'],
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

    excerpt = truncateToLength(excerpt, maximumExcerptLength);

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

    return {
        title,
        excerpt,
        lead: excerpt,
        slug: sanitizeSlug(parsedResponse.slug || title),
        content_html: contentHtml,
        content_text: contentText,
        selected_category_keys: normalizeSelectedCategoryKeys(parsedResponse.selected_category_keys),
        keyword_names: normalizeAiKeywordNames(parsedResponse.keyword_names)
    };
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

function needsSecondRewriteAttempt(sourceText, rewrittenPost, useStrictLengthRules) {
    if (useStrictLengthRules && rewrittenPost.content_text.length < minimumContentTextLength) {
        return true;
    }

    if (isTooCloseToSource(sourceText, rewrittenPost.content_text)) {
        return true;
    }

    if (rewrittenPost.category_resolution_error) {
        return true;
    }

    if (rewrittenPost.keyword_resolution_error) {
        return true;
    }

    if (!Array.isArray(rewrittenPost.category_ids) || rewrittenPost.category_ids.length < minimumSelectedCategoryCount) {
        return true;
    }

    if (!Array.isArray(rewrittenPost.thematic_keyword_names) || rewrittenPost.thematic_keyword_names.length < minimumThematicKeywordCount) {
        return true;
    }

    return false;
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

    const sourceShingles = buildWordShingles(normalizedSource, 5);
    const generatedShingles = buildWordShingles(normalizedGenerated, 5);

    if (sourceShingles.size === 0 || generatedShingles.size === 0) {
        return false;
    }

    let overlapCount = 0;
    for (const shingle of sourceShingles) {
        if (generatedShingles.has(shingle)) {
            overlapCount += 1;
        }
    }

    const overlapRatio = overlapCount / Math.min(sourceShingles.size, generatedShingles.size);
    return overlapRatio >= 0.6;
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

module.exports = {
    rewriteMailWithOpenAi,
    shouldUseStrictLengthRules
};