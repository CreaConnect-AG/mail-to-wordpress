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
    rewriteMailWithOpenAi,
    shouldUseStrictLengthRules,
    generateFeaturedImageWithOpenAi
} = require('../services/openAiService');

const {
    createWordPressDraft
} = require('../services/wordpressService');

app.http('processMailToWordPress', {
    methods: ['GET', 'POST'],
    authLevel: 'function',
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

            if (enableFeaturedImageGeneration) {
                rewrittenPost.generated_featured_image = await generateFeaturedImageWithOpenAi(rewrittenPost);
            }

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
                        strict_rules_used: shouldUseStrictLengthRules(sourceText),
                        assigned_category_ids: rewrittenPost.category_ids || [],
                        assigned_category_titles: rewrittenPost.selected_category_titles || [],
                        assigned_tag_ids: createdWordPressPost.assigned_tag_ids || [],
                        assigned_tag_names: rewrittenPost.tag_names || [],
                        assigned_thematic_keyword_names: rewrittenPost.thematic_keyword_names || [],
                        featured_image_media_id: createdWordPressPost.featured_image_media_id || null,
                        featured_image_url: createdWordPressPost.featured_image_url || null,
                        featured_image_prompt_en: rewrittenPost.featured_image_prompt_en || null
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