const {
    removeTrailingSlash,
    parseIntegerList,
    parseStringList
} = require('../utils/textUtils');

const openAiApiKey = process.env.OPENAI_API_KEY || '';
const openAiModel = process.env.OPENAI_MODEL || 'gpt-5';

const openAiImageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5';
const openAiImageSize = process.env.OPENAI_IMAGE_SIZE || '1536x1024';
const openAiImageQuality = process.env.OPENAI_IMAGE_QUALITY || 'high';
const openAiImageOutputFormat = process.env.OPENAI_IMAGE_OUTPUT_FORMAT || 'jpeg';
const enableFeaturedImageGeneration = String(process.env.ENABLE_FEATURED_IMAGE_GENERATION || 'false').toLowerCase() === 'true';

const enableOpenAiWebSearch = String(process.env.ENABLE_OPENAI_WEB_SEARCH || 'true').toLowerCase() !== 'false';
const openAiWebSearchContextSize = process.env.OPENAI_WEB_SEARCH_CONTEXT_SIZE || 'medium';
const openAiWebSearchBlockedDomains = parseStringList(
  process.env.OPENAI_WEB_SEARCH_BLOCKED_DOMAINS || 'wikipedia.org,reddit.com,quora.com'
);

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
    openAiImageModel,
    openAiImageSize,
    openAiImageQuality,
    openAiImageOutputFormat,
    enableOpenAiWebSearch,
    openAiWebSearchContextSize,
    openAiWebSearchBlockedDomains,
    enableFeaturedImageGeneration,
    wordpressBaseUrl,
    wordpressUsername,
    wordpressApplicationPassword,
    wordpressDefaultStatus,
    wordpressDefaultCategoryIds,
    wordpressAcfLeadFieldName,
    mailAllowedSenders
};