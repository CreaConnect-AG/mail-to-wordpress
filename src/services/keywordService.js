const {
    minimumThematicKeywordCount,
    fixedKeywordNames
} = require('../config/contentRules');

const {
    normalizeWhitespace,
    sanitizeSlug
} = require('../utils/textUtils');

function normalizeAiKeywordNames(keywordNames) {
    if (!Array.isArray(keywordNames)) {
        return [];
    }

    const normalizedKeywordNames = [];

    for (const keywordName of keywordNames) {
        const cleanedKeywordName = normalizeWhitespace(String(keywordName || ''));
        if (!cleanedKeywordName) {
            continue;
        }

        const keywordFingerprint = buildKeywordFingerprint(cleanedKeywordName);
        if (!keywordFingerprint) {
            continue;
        }

        const alreadyExists = normalizedKeywordNames.some((existingKeywordName) => {
            return buildKeywordFingerprint(existingKeywordName) === keywordFingerprint;
        });

        if (!alreadyExists) {
            normalizedKeywordNames.push(cleanedKeywordName);
        }
    }

    return normalizedKeywordNames;
}

function resolveKeywordNames(keywordNames) {
    const normalizedKeywordNames = normalizeAiKeywordNames(keywordNames);

    const thematicKeywordNames = normalizedKeywordNames.filter((keywordName) => {
        return !isFixedKeywordName(keywordName);
    });

    if (thematicKeywordNames.length < minimumThematicKeywordCount) {
        throw new Error(`Es wurden weniger als ${minimumThematicKeywordCount} thematische Stichwörter geliefert.`);
    }

    const finalKeywordNames = mergeKeywordNames(
        thematicKeywordNames,
        fixedKeywordNames
    );

    return {
        thematicKeywordNames,
        finalKeywordNames
    };
}

function mergeKeywordNames(primaryKeywordNames, additionalKeywordNames) {
    const mergedKeywordNames = [];

    for (const keywordName of [...primaryKeywordNames, ...additionalKeywordNames]) {
        const cleanedKeywordName = normalizeWhitespace(String(keywordName || ''));
        if (!cleanedKeywordName) {
            continue;
        }

        const keywordFingerprint = buildKeywordFingerprint(cleanedKeywordName);
        if (!keywordFingerprint) {
            continue;
        }

        const alreadyExists = mergedKeywordNames.some((existingKeywordName) => {
            return buildKeywordFingerprint(existingKeywordName) === keywordFingerprint;
        });

        if (!alreadyExists) {
            mergedKeywordNames.push(cleanedKeywordName);
        }
    }

    return mergedKeywordNames;
}

function isFixedKeywordName(keywordName) {
    const keywordFingerprint = buildKeywordFingerprint(keywordName);

    return fixedKeywordNames.some((fixedKeywordName) => {
        return buildKeywordFingerprint(fixedKeywordName) === keywordFingerprint;
    });
}

function buildKeywordFingerprint(keywordName) {
    const keywordSlug = sanitizeSlug(keywordName);
    if (keywordSlug) {
        return keywordSlug;
    }

    return normalizeWhitespace(String(keywordName || '')).toLowerCase();
}

module.exports = {
    normalizeAiKeywordNames,
    resolveKeywordNames
};