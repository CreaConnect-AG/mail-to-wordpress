const {
    openAiApiKey,
    openAiModel,
    openAiImageModel,
    openAiImageSize,
    openAiImageQuality,
    openAiImageOutputFormat
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
        'Schreibe neutral, professionell, journalistisch und zugleich interessant.',
        'Schreibe sachlich, klar und gut lesbar.',
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
        'content_html soll ein sauberer WordPress-Inhalt sein.',
        'Verwende gültiges HTML, aber ohne <html> oder <body>.',
        'Gib keinen Markdown-Codeblock aus.',
        'Gib keinen Werbetext, keine Spam-Phrasen, keine fremdsprachigen Fragmente, keine Sonderzeichenketten und keine irrelevanten Zusätze aus.',
        'Verwende im gesamten zurückgegebenen Text keine Gedankenstriche als Stilmittel.',
        'Im Inhalt ist höchstens ein einzelner Gedankenstrich erlaubt, und nur wenn er sprachlich wirklich notwendig ist.',
        'Baue den Beitrag redaktionell eigenständig auf und übernimm nicht einfach die Struktur der Vorlage.',
        'Verwende nach Möglichkeit einen anderen Einstieg als die Vorlage.',
        'Übernimm nicht die gleiche Reihenfolge der Aussagen, Absätze oder Argumente wie im Input.',
        'Übernimm nicht bloss einzelne Sätze in leicht veränderter Form, sondern strukturiere, verdichte und formuliere den Inhalt redaktionell neu.',
        'Vermeide auffällige Formulierungsmuster, Satzanfänge und Standardwendungen aus der Vorlage und ersetze sie durch eigenständige journalistische Formulierungen.',
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
        instructionParts.push('Achte besonders darauf, dass Formulierungen, Satzbau, Einstieg und Aufbau klar vom Original abweichen.');
        instructionParts.push('Wenn ein Titel, ein Auszug, ein Absatz oder eine Passage dem Input zu ähnlich ist, formuliere sie vollständig neu.');
        instructionParts.push('Wenn der Beitrag in Aufbau oder Reihenfolge noch zu nahe an der Vorlage ist, ordne den Inhalt neu.');
        instructionParts.push('Wenn Kategorien zu allgemein sind, wähle passendere und spezifischere Kategorien aus der Liste.');
        instructionParts.push('Wenn Stichwörter zu allgemein sind, wähle passendere und thematischere Stichwörter.');
        instructionParts.push('Wenn der Titel einen Firmennamen, Markennamen, Produktnamen, Doppelpunkt oder Gedankenstrich enthält, formuliere ihn vollständig neu.');

        instructionParts.push('featured_image_prompt_en muss in englischer Sprache formuliert sein.');
        instructionParts.push('featured_image_prompt_en muss eine realistische redaktionelle Bildidee für einen WordPress-Featured-Image-Header beschreiben.');
        instructionParts.push('featured_image_prompt_en soll fotografisch, glaubwürdig, modern und professionell wirken.');
        instructionParts.push('featured_image_prompt_en darf keine Logos, keinen lesbaren Text, keine Wasserzeichen, keine UI-Elemente, keine Infografiken und keinen Cartoon-Stil verlangen.');
        instructionParts.push('featured_image_alt_text_de muss einen kurzen, sachlichen deutschen Alt-Text für das Bild liefern.');
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
            'excerpt',
            'slug',
            'content_html',
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
        featured_image_alt_text_de: featuredImageAltText
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

module.exports = {
    rewriteMailWithOpenAi,
    shouldUseStrictLengthRules,
    generateFeaturedImageWithOpenAi
};