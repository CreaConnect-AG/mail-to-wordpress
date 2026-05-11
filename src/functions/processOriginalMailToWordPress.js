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

app.http('processOriginalMailToWordPress', {
    methods: ['GET', 'POST'],
    authLevel: 'function',
    route: 'process-original-mail-to-wordpress',
    handler: async (request, context) => {
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

            const sourceText = buildOriginalSourceText(requestBody);

            const originalPost = await prepareOriginalMailWithOpenAi({
                subject: String(requestBody.subject || ''),
                from: senderEmailAddress,
                sourceText
            });

            if (enableFeaturedImageGeneration) {
                originalPost.generated_featured_image = await generateFeaturedImageWithOpenAi(originalPost);
            }

            const createdWordPressPost = await createWordPressDraft(originalPost);

            return {
                status: 200,
                jsonBody: {
                    success: true,
                    message: 'WordPress-Entwurf aus Original-Mail wurde erstellt.',
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
            context.error('Fehler in processOriginalMailToWordPress:', error);

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

function buildOriginalSourceText(requestBody) {
    const textBody = normalizeLineEndings(String(requestBody.text_body || '')).trim();

    if (textBody) {
        return textBody;
    }

    const plainTextFromHtml = htmlToPlainText(String(requestBody.html_body || ''));

    if (plainTextFromHtml) {
        return normalizeWhitespace(plainTextFromHtml);
    }

    throw new Error('Es konnte kein verwertbarer Text aus der E-Mail gelesen werden.');
}

function normalizeLineEndings(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}