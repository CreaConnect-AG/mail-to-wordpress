const { app } = require('@azure/functions');

const {
    openAiApiKey,
    wordpressBaseUrl,
    wordpressUsername,
    wordpressApplicationPassword,
    mailAllowedSenders,
    enableFeaturedImageGeneration
} = require('../config/environment');

const {
    normalizeEmailAddress,
    normalizeWhitespace,
    htmlToPlainText
} = require('../utils/textUtils');

const {
    prepareOriginalMailWithOpenAi,
    generateFeaturedImageWithOpenAi
} = require('../services/openAiService');

const {
    createWordPressDraft
} = require('../services/wordpressService');

const {
    createExecutionLogger,
    runLoggedStep,
    getSafeMailDetails
} = require('../utils/logger');

app.http('processOriginalMailToWordPress', {
    methods: ['GET', 'POST'],
    authLevel: 'function',
    route: 'process-original-mail-to-wordpress',
    handler: async (request, context) => {
        const logger = createExecutionLogger({
            context,
            functionName: 'processOriginalMailToWordPress',
            request
        });

        const requestMethod = String(request.method || 'GET').toUpperCase();

        if (requestMethod === 'GET') {
            return {
            status: 200,
            jsonBody: {
                success: true,
                message: 'Die Original-Mail Azure Function läuft.',
                time: new Date().toISOString()
            }
            };
        }

        try {
            await runLoggedStep(
            'validate_environment',
            logger,
            () => validateEnvironmentVariables()
            );

            const requestBody = await runLoggedStep(
            'read_request_body',
            logger,
            () => request.json()
            );

            await runLoggedStep(
            'validate_request_body',
            logger,
            () => validateRequestBody(requestBody),
            {
                has_text_body: Boolean(requestBody?.text_body),
                has_html_body: Boolean(requestBody?.html_body),
                subject_length: String(requestBody?.subject || '').length
            }
            );

            const senderEmailAddress = normalizeEmailAddress(requestBody.from);

            if (!isAllowedSender(senderEmailAddress)) {
            logger.warn('sender_not_allowed', {
                step: 'check_allowed_sender',
                sender_domain: String(senderEmailAddress || '').split('@')[1] || ''
            });

            return {
                status: 202,
                jsonBody: {
                success: true,
                message: 'Absender ist nicht freigegeben.',
                created_post: null,
                skipped_reason: 'sender_not_allowed',
                correlation_id: logger.correlationId
                }
            };
            }

            const sourceText = await runLoggedStep(
            'build_original_source_text',
            logger,
            () => buildOriginalSourceText(requestBody),
            getSafeMailDetails(requestBody, senderEmailAddress)
            );

            const originalPost = await runLoggedStep(
            'openai_prepare_original_mail',
            logger,
            () => prepareOriginalMailWithOpenAi({
                subject: String(requestBody.subject || ''),
                from: senderEmailAddress,
                sourceText
            }),
            getSafeMailDetails(requestBody, senderEmailAddress, sourceText)
            );

            if (enableFeaturedImageGeneration) {
            originalPost.generated_featured_image = await runLoggedStep(
                'openai_generate_featured_image',
                logger,
                () => generateFeaturedImageWithOpenAi(originalPost),
                {
                post_title_length: String(originalPost.title || '').length
                }
            );
            }

            const createdWordPressPost = await runLoggedStep(
            'wordpress_create_draft',
            logger,
            () => createWordPressDraft(originalPost),
            {
                post_title_length: String(originalPost.title || '').length,
                category_count: Array.isArray(originalPost.category_ids) ? originalPost.category_ids.length : 0,
                tag_count: Array.isArray(originalPost.tag_names) ? originalPost.tag_names.length : 0,
                has_featured_image: Boolean(originalPost.generated_featured_image)
            }
            );

            return {
            status: 200,
            jsonBody: {
                success: true,
                message: 'WordPress-Entwurf aus Original-Mail wurde erstellt.',
                correlation_id: logger.correlationId,
                created_post: {
                wordpress_post_id: createdWordPressPost.id,
                wordpress_status: createdWordPressPost.status,
                wordpress_slug: createdWordPressPost.slug,
                wordpress_link: createdWordPressPost.link || null,
                wordpress_title: createdWordPressPost.title?.rendered || originalPost.title,
                lead_value: originalPost.lead,
                original_content_used: true,
                assigned_category_ids: originalPost.category_ids || [],
                assigned_category_titles: originalPost.selected_category_titles || [],
                assigned_tag_ids: createdWordPressPost.assigned_tag_ids || [],
                assigned_tag_names: originalPost.tag_names || [],
                assigned_thematic_keyword_names: originalPost.thematic_keyword_names || [],
                featured_image_media_id: createdWordPressPost.featured_image_media_id || null,
                featured_image_url: createdWordPressPost.featured_image_url || null,
                featured_image_prompt_en: originalPost.featured_image_prompt_en || null
                }
            }
            };
        } catch (error) {
            if (!error.alreadyLogged) {
            logger.error('request_failed', error, {
                step: error.failedStepName || 'unknown'
            });
            }

            return {
            status: 500,
            jsonBody: {
                success: false,
                message: error.message || 'Unbekannter Fehler.',
                failed_step: error.failedStepName || 'unknown',
                correlation_id: logger.correlationId
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

function buildOriginalSourceText(requestBody) {
    const textBody = normalizeLineEndings(String(requestBody.text_body || '')).trim();
    const htmlBody = String(requestBody.html_body || '').trim();

    if (textBody && !looksLikeHtml(textBody)) {
        return textBody;
    }

    if (htmlBody) {
        const plainTextFromHtml = htmlToPlainTextForOriginalMail(htmlBody);

        if (plainTextFromHtml) {
            return plainTextFromHtml;
        }
    }

    if (textBody && looksLikeHtml(textBody)) {
        const plainTextFromTextBodyHtml = htmlToPlainTextForOriginalMail(textBody);

        if (plainTextFromTextBodyHtml) {
            return plainTextFromTextBodyHtml;
        }
    }

    throw new Error('Es konnte kein verwertbarer Text aus der E-Mail gelesen werden.');
}

function normalizeLineEndings(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}

function looksLikeHtml(value) {
    return /<\/?[a-z][\s\S]*>/i.test(String(value || ''));
}

function htmlToPlainTextForOriginalMail(htmlBody) {
    return String(htmlBody || '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n\n')
        .replace(/<\/h1>/gi, '\n\n')
        .replace(/<\/h2>/gi, '\n\n')
        .replace(/<\/h3>/gi, '\n\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#160;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}