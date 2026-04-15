const {
    removeTrailingSlash,
    parseIntegerList,
    parseStringList
} = require('../utils/textUtils');

const openAiApiKey = process.env.OPENAI_API_KEY || '';
const openAiModel = process.env.OPENAI_MODEL || 'gpt-5';

const wordpressBaseUrl = removeTrailingSlash(process.env.WORDPRESS_BASE_URL || '');
const wordpressUsername = process.env.WORDPRESS_USERNAME || '';
const wordpressApplicationPassword = String(process.env.WORDPRESS_APPLICATION_PASSWORD || '').replace(/\s+/g, '');
const wordpressDefaultStatus = process.env.WORDPRESS_DEFAULT_STATUS || 'draft';
const wordpressDefaultCategoryIds = parseIntegerList(process.env.WORDPRESS_DEFAULT_CATEGORY_IDS || '');
const wordpressAcfLeadFieldName = process.env.WORDPRESS_ACF_LEAD_FIELD_NAME || 'lead';
const mailAllowedSenders = parseStringList(process.env.MAIL_ALLOWED_SENDERS || '');

module.exports = {
    openAiApiKey,
    openAiModel,
    wordpressBaseUrl,
    wordpressUsername,
    wordpressApplicationPassword,
    wordpressDefaultStatus,
    wordpressDefaultCategoryIds,
    wordpressAcfLeadFieldName,
    mailAllowedSenders
};