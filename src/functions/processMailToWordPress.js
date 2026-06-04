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

const {
  createExecutionLogger,
  runLoggedStep,
  getSafeMailDetails
} = require('../utils/logger');

app.http('processMailToWordPress', {
    methods: ['GET', 'POST'],
    authLevel: 'function',
    route: 'process-mail-to-wordpress',
    handler: async (request, context) => {
        const logger = createExecutionLogger({
            context,
            functionName: 'processMailToWordPress',
            request
        });

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
            'build_source_text',
            logger,
            () => buildSourceText(requestBody),
            getSafeMailDetails(requestBody, senderEmailAddress)
            );

            const rewrittenPost = await runLoggedStep(
            'openai_rewrite_mail',
            logger,
            () => rewriteMailWithOpenAi({
                subject: String(requestBody.subject || ''),
                from: senderEmailAddress,
                sourceText,
                additionalInstructions
            }),
            getSafeMailDetails(requestBody, senderEmailAddress, sourceText)
            );

            if (enableFeaturedImageGeneration) {
            rewrittenPost.generated_featured_image = await runLoggedStep(
                'openai_generate_featured_image',
                logger,
                () => generateFeaturedImageWithOpenAi(rewrittenPost),
                {
                post_title_length: String(rewrittenPost.title || '').length
                }
            );
            }

            const createdWordPressPost = await runLoggedStep(
            'wordpress_create_draft',
            logger,
            () => createWordPressDraft(rewrittenPost),
            {
                post_title_length: String(rewrittenPost.title || '').length,
                category_count: Array.isArray(rewrittenPost.category_ids) ? rewrittenPost.category_ids.length : 0,
                tag_count: Array.isArray(rewrittenPost.tag_names) ? rewrittenPost.tag_names.length : 0,
                has_featured_image: Boolean(rewrittenPost.generated_featured_image)
            }
            );

            return {
            status: 200,
            jsonBody: {
                success: true,
                message: 'WordPress-Entwurf wurde erstellt.',
                correlation_id: logger.correlationId,
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
                featured_image_prompt_en: rewrittenPost.featured_image_prompt_en || null,
                source_references: rewrittenPost.source_references || [],
                editorial_quality: {
                    focus: rewrittenPost.editorial_focus || '',
                    relevance: rewrittenPost.editorial_relevance || '',
                    supporting_aspects: rewrittenPost.supporting_aspects || [],
                    omitted_aspects: rewrittenPost.omitted_aspects || []
                }
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

function buildSourceText(requestBody) {
    const plainTextFromRequest = normalizeSourceText(requestBody.text_body);

    if (plainTextFromRequest) {
        return plainTextFromRequest;
    }

    const plainTextFromHtml = htmlToPlainText(String(requestBody.html_body || ''));

    if (plainTextFromHtml) {
        return plainTextFromHtml;
    }

    throw new Error('Es konnte kein verwertbarer Text aus der E-Mail gelesen werden.');
}

function normalizeSourceText(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => normalizeWhitespace(line))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function buildAdditionalInstructions(requestBody) {
  const maximumAdditionalInstructionsLength = 3000;

  const additionalInstructions = String(requestBody.additional_instructions || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!additionalInstructions) {
    return '';
  }

  return additionalInstructions.slice(0, maximumAdditionalInstructionsLength);
}