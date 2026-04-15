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

module.exports = {
    htmlToPlainText,
    normalizeEmailAddress,
    normalizeGeneratedHtml,
    truncateToLength,
    normalizeComparisonText,
    sanitizeSlug,
    normalizeWhitespace,
    removeTrailingSlash,
    parseIntegerList,
    parseStringList,
    escapeHtml
};