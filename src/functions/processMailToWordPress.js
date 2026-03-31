const { app } = require('@azure/functions');

const openAiApiKey = process.env.OPENAI_API_KEY || '';
const openAiModel = process.env.OPENAI_MODEL || 'gpt-5';

const wordpressBaseUrl = removeTrailingSlash(process.env.WORDPRESS_BASE_URL || '');
const wordpressUsername = process.env.WORDPRESS_USERNAME || '';
const wordpressApplicationPassword = String(process.env.WORDPRESS_APPLICATION_PASSWORD || '').replace(/\s+/g, '');
const wordpressDefaultStatus = process.env.WORDPRESS_DEFAULT_STATUS || 'draft';
const wordpressDefaultCategoryIds = parseIntegerList(process.env.WORDPRESS_DEFAULT_CATEGORY_IDS || '');
const wordpressAcfLeadFieldName = process.env.WORDPRESS_ACF_LEAD_FIELD_NAME || 'lead';
const mailAllowedSenders = parseStringList(process.env.MAIL_ALLOWED_SENDERS || '');

const maximumTitleLength = 40;
const minimumExcerptLength = 186;
const maximumExcerptLength = 400;
const minimumContentTextLength = 500;
const maximumContentHtmlLength = 5000;

const minimumSourceTextLengthForStrictRules = 900;

app.http('processMailToWordPress', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'process-mail-to-wordpress',
    handler: async (request, context) => {
        const requestMethod = String(request.method || 'GET').toUpperCase();

        if (requestMethod === 'GET') {
            return {
                status: 200,
                jsonBody: {
                    success: true,
                    message: 'Die lokale Azure Function läuft.',
                    time: new Date().toISOString()
                }
            };
        }

        try {
            validateEnvironmentVariables();

            const requestBody = await request.json();
            validateRequestBody(requestBody);

            const senderEmailAddress = normalizeEmailAddress(requestBody.from);

            if (!isAllowedSender(senderEmailAddress)) {
                return {
                    status: 202,
                    jsonBody: {
                        success: true,
                        message: 'Absender ist nicht freigegeben.',
                        created_post: null,
                        skipped_reason: 'sender_not_allowed'
                    }
                };
            }

            const sourceText = buildSourceText(requestBody);

            const rewrittenPost = await rewriteMailWithOpenAi({
                subject: String(requestBody.subject || ''),
                from: senderEmailAddress,
                sourceText
            });

            const createdWordPressPost = await createWordPressDraft(rewrittenPost);

            return {
                status: 200,
                jsonBody: {
                    success: true,
                    message: 'WordPress-Entwurf wurde erstellt.',
                    created_post: {
                        wordpress_post_id: createdWordPressPost.id,
                        wordpress_status: createdWordPressPost.status,
                        wordpress_slug: createdWordPressPost.slug,
                        wordpress_link: createdWordPressPost.link || null,
                        wordpress_title: createdWordPressPost.title?.rendered || rewrittenPost.title,
                        lead_value: rewrittenPost.lead,
                        strict_rules_used: shouldUseStrictLengthRules(sourceText)
                    }
                }
            };
        } catch (error) {
            context.error('Fehler in processNewsletter:', error);

            return {
                status: 500,
                jsonBody: {
                    success: false,
                    message: error.message || 'Unbekannter Fehler.'
                }
            };
        }
    }
});

function validateEnvironmentVariables() {
    const missingEnvironmentVariables = [];

    if (!openAiApiKey) missingEnvironmentVariables.push('OPENAI_API_KEY');
    if (!wordpressBaseUrl) missingEnvironmentVariables.push('WORDPRESS_BASE_URL');
    if (!wordpressUsername) missingEnvironmentVariables.push('WORDPRESS_USERNAME');
    if (!wordpressApplicationPassword) missingEnvironmentVariables.push('WORDPRESS_APPLICATION_PASSWORD');

    if (missingEnvironmentVariables.length > 0) {
        throw new Error(`Fehlende Umgebungsvariablen: ${missingEnvironmentVariables.join(', ')}`);
    }
}

function validateRequestBody(requestBody) {
    if (!requestBody || typeof requestBody !== 'object') {
        throw new Error('Request Body fehlt oder ist ungültig.');
    }

    if (!requestBody.subject) {
        throw new Error('subject fehlt im Request Body.');
    }

    if (!requestBody.html_body && !requestBody.text_body) {
        throw new Error('Es muss html_body oder text_body vorhanden sein.');
    }
}

function isAllowedSender(senderEmailAddress) {
    if (mailAllowedSenders.length === 0) {
        return true;
    }

    return mailAllowedSenders.includes(String(senderEmailAddress || '').toLowerCase());
}

function buildSourceText(requestBody) {
    const plainTextFromRequest = normalizeWhitespace(String(requestBody.text_body || ''));
    if (plainTextFromRequest) {
        return plainTextFromRequest.slice(0, 6000);
    }

    const plainTextFromHtml = htmlToPlainText(String(requestBody.html_body || ''));
    if (plainTextFromHtml) {
        return plainTextFromHtml.slice(0, 6000);
    }

    throw new Error('Es konnte kein verwertbarer Text aus der E-Mail gelesen werden.');
}

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
    if (!needsSecondRewriteAttempt(sourceText, normalizedFirstAttempt, useStrictLengthRules)) {
        return normalizedFirstAttempt;
    }

    const secondAttempt = await requestOpenAiRewrite({
        subject,
        from,
        sourceText,
        forceStrongRewrite: true,
        useStrictLengthRules
    });

    const normalizedSecondAttempt = normalizeGeneratedPost(secondAttempt, useStrictLengthRules);

    if (isTooCloseToSource(sourceText, normalizedSecondAttempt.content_text)) {
        throw new Error('OpenAI-Text ist noch zu nah am Originaltext.');
    }

    if (useStrictLengthRules && normalizedSecondAttempt.content_text.length < minimumContentTextLength) {
        throw new Error(`OpenAI-Inhalt ist zu kurz. Aktuell: ${normalizedSecondAttempt.content_text.length} Zeichen.`);
    }

    return normalizedSecondAttempt;
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
                                source_text: sourceText
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
        'Gib ausschliesslich valides JSON gemäss dem vorgegebenen Schema zurück.'
    ];

    if (forceStrongRewrite) {
        instructionParts.push('Achte besonders darauf, dass Formulierungen und Satzbau klar vom Original abweichen.');
        instructionParts.push('Wenn ein Titel oder eine Passage dem Input zu ähnlich ist, formuliere sie erneut um.');
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
            content_html: contentHtmlSchema
        },
        required: ['title', 'excerpt', 'slug', 'content_html'],
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
        content_text: contentText
    };
}

function needsSecondRewriteAttempt(sourceText, rewrittenPost, useStrictLengthRules) {
    if (useStrictLengthRules && rewrittenPost.content_text.length < minimumContentTextLength) {
        return true;
    }

    if (isTooCloseToSource(sourceText, rewrittenPost.content_text)) {
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

async function createWordPressDraft(rewrittenPost) {
    const authorizationHeader = Buffer
        .from(`${wordpressUsername}:${wordpressApplicationPassword}`)
        .toString('base64');

    const wordpressPayload = {
        status: wordpressDefaultStatus,
        title: rewrittenPost.title,
        excerpt: rewrittenPost.excerpt,
        content: rewrittenPost.content_html
    };

    if (rewrittenPost.slug) {
        wordpressPayload.slug = rewrittenPost.slug;
    }

    if (wordpressDefaultCategoryIds.length > 0) {
        wordpressPayload.categories = wordpressDefaultCategoryIds;
    }

    const createResponse = await fetch(`${wordpressBaseUrl}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authorizationHeader}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(wordpressPayload)
    });

    if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`WordPress Fehler ${createResponse.status}: ${errorText}`);
    }

    const createdPost = await createResponse.json();

    if (wordpressAcfLeadFieldName) {
        const acfUpdateSucceeded = await updateWordPressAcfField({
            postId: createdPost.id,
            fieldName: wordpressAcfLeadFieldName,
            fieldValue: rewrittenPost.lead,
            authorizationHeader
        });

        if (!acfUpdateSucceeded) {
            throw new Error(`Der WordPress-Beitrag wurde erstellt, aber das ACF-Feld "${wordpressAcfLeadFieldName}" konnte nicht gesetzt werden.`);
        }
    }

    return createdPost;
}

async function updateWordPressAcfField({ postId, fieldName, fieldValue, authorizationHeader }) {
    const updateResponse = await fetch(`${wordpressBaseUrl}/wp-json/wp/v2/posts/${postId}`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authorizationHeader}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            acf: {
                [fieldName]: fieldValue
            }
        })
    });

    return updateResponse.ok;
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

function htmlToPlainText(htmlBody) {
    const normalizedHtml = String(htmlBody || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h1>/gi, '\n')
        .replace(/<\/h2>/gi, '\n')
        .replace(/<\/h3>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');

    return normalizeWhitespace(normalizedHtml);
}

function normalizeEmailAddress(value) {
    if (!value) {
        return '';
    }

    if (typeof value === 'object') {
        return String(
            value.email ||
            value.address ||
            value.emailAddress?.address ||
            ''
        ).trim().toLowerCase();
    }

    const valueAsString = String(value).trim();
    const emailMatch = valueAsString.match(/<([^>]+)>/);
    return String(emailMatch ? emailMatch[1] : valueAsString).trim().toLowerCase();
}

function normalizeGeneratedHtml(contentHtml) {
    let normalizedHtml = String(contentHtml || '').trim();

    normalizedHtml = normalizedHtml
        .replace(/^```html/i, '')
        .replace(/^```/i, '')
        .replace(/```$/i, '')
        .trim();

    normalizedHtml = normalizedHtml
        .replace(/<\/?html[^>]*>/gi, '')
        .replace(/<\/?body[^>]*>/gi, '')
        .trim();

    if (!normalizedHtml) {
        return '';
    }

    if (!normalizedHtml.startsWith('<')) {
        normalizedHtml = `<p>${escapeHtml(normalizedHtml)}</p>`;
    }

    return normalizedHtml;
}

function truncateToLength(value, maximumLength) {
    const normalizedValue = normalizeWhitespace(value);

    if (normalizedValue.length <= maximumLength) {
        return normalizedValue;
    }

    const truncatedValue = normalizedValue.slice(0, maximumLength + 1);
    const lastSpaceIndex = truncatedValue.lastIndexOf(' ');

    if (lastSpaceIndex > Math.floor(maximumLength * 0.6)) {
        return truncatedValue.slice(0, lastSpaceIndex).trim();
    }

    return normalizedValue.slice(0, maximumLength).trim();
}

function normalizeComparisonText(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9äöüss\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizeSlug(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function normalizeWhitespace(value) {
    return String(value || '')
        .replace(/\r/g, ' ')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function removeTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function parseIntegerList(value) {
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => Number.parseInt(entry, 10))
        .filter(Number.isInteger);
}

function parseStringList(value) {
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}