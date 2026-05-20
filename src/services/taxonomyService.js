const {
    taxonomyEntryMap,
    selectableTaxonomyEntries
} = require('../config/taxonomies');

const {
    minimumSelectedCategoryCount
} = require('../config/contentRules');

function getAllowedCategoryKeysForSchemaEnum() {
    return selectableTaxonomyEntries.map((entry) => entry.key);
}

function getAllowedTopicCategoryKeysForSchemaEnum() {
    return selectableTaxonomyEntries
        .filter((entry) => entry.type === 'topic')
        .map((entry) => entry.key);
}

function getAllowedCategoryOptionsForAi() {
    return selectableTaxonomyEntries.map((entry) => {
        return {
            key: entry.key,
            title: entry.title,
            type: entry.type,
            path: buildTaxonomyPath(entry.key)
        };
    });
}

function resolveSelectedCategories(selectedCategoryKeys) {
    const normalizedSelectedKeys = normalizeSelectedCategoryKeys(selectedCategoryKeys);

    if (normalizedSelectedKeys.length === 0) {
        throw new Error('OpenAI hat keine Kategorien geliefert.');
    }

    const invalidSelectedKeys = normalizedSelectedKeys.filter((key) => {
        return !taxonomyEntryMap[key] || !taxonomyEntryMap[key].selectable;
    });

    if (invalidSelectedKeys.length > 0) {
        throw new Error(`Ungültige Kategorie-Schlüssel von OpenAI: ${invalidSelectedKeys.join(', ')}`);
    }

    const deepestSelectedKeys = removeParentSelectionsWhenChildExists(normalizedSelectedKeys);
    const adjustedSelectedKeys = applyInternationalOnlyRule(deepestSelectedKeys);

    if (adjustedSelectedKeys.length < minimumSelectedCategoryCount) {
        throw new Error(`Nach der Kategorien-Bereinigung bleiben nur ${adjustedSelectedKeys.length} Kategorien übrig.`);
    }

    const wordpressCategoryIds = adjustedSelectedKeys
        .map((key) => taxonomyEntryMap[key]?.wordpressId)
        .filter(Number.isInteger);

    if (wordpressCategoryIds.length !== adjustedSelectedKeys.length) {
        throw new Error('Nicht alle Kategorien konnten in WordPress-IDs umgewandelt werden.');
    }

    const selectedTitles = adjustedSelectedKeys.map((key) => taxonomyEntryMap[key].title);

    return {
        selectedKeys: adjustedSelectedKeys,
        selectedTitles,
        wordpressCategoryIds
    };
}

function normalizeSelectedCategoryKeys(selectedCategoryKeys) {
    if (!Array.isArray(selectedCategoryKeys)) {
        return [];
    }

    return selectedCategoryKeys
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean)
        .filter((entry, index, allEntries) => allEntries.indexOf(entry) === index);
}

function removeParentSelectionsWhenChildExists(selectedKeys) {
    return selectedKeys.filter((currentKey) => {
        return !selectedKeys.some((otherKey) => {
            if (otherKey === currentKey) {
                return false;
            }

            return getAncestorKeys(otherKey).includes(currentKey);
        });
    });
}

function getAncestorKeys(key) {
    const ancestorKeys = [];
    let currentEntry = taxonomyEntryMap[key];

    while (currentEntry?.parentKey) {
        ancestorKeys.push(currentEntry.parentKey);
        currentEntry = taxonomyEntryMap[currentEntry.parentKey];
    }

    return ancestorKeys;
}

function applyInternationalOnlyRule(selectedKeys) {
    if (!selectedKeys.includes('international')) {
        return selectedKeys;
    }

    return selectedKeys.filter((key) => {
        const taxonomyEntry = taxonomyEntryMap[key];
        return taxonomyEntry.type !== 'region' || key === 'international';
    });
}

function buildTaxonomyPath(key) {
    const titleParts = [];
    let currentEntry = taxonomyEntryMap[key];

    while (currentEntry) {
        if (currentEntry.key !== 'regionen') {
            titleParts.unshift(currentEntry.title);
        }

        currentEntry = currentEntry.parentKey
            ? taxonomyEntryMap[currentEntry.parentKey]
            : null;
    }

    return titleParts.join(' > ');
}

function normalizeBestCategoryKey(bestCategoryKey) {
  return String(bestCategoryKey || '').trim().toLowerCase();
}

function resolveBestCategory(bestCategoryKey, finalSelectedCategoryKeys) {
    const normalizedBestCategoryKey = normalizeBestCategoryKey(bestCategoryKey);

    if (!normalizedBestCategoryKey) {
        throw new Error('OpenAI hat keine beste Kategorie geliefert.');
    }

    const taxonomyEntry = taxonomyEntryMap[normalizedBestCategoryKey];

    if (!taxonomyEntry || !taxonomyEntry.selectable) {
        throw new Error(`Ungültige beste Kategorie von OpenAI: ${normalizedBestCategoryKey}`);
    }

    if (taxonomyEntry.type !== 'topic') {
        throw new Error(`Beste Kategorie "${normalizedBestCategoryKey}" ist keine Topic-Kategorie.`);
    }

    if (
        Array.isArray(finalSelectedCategoryKeys) &&
        finalSelectedCategoryKeys.length > 0 &&
        !finalSelectedCategoryKeys.includes(normalizedBestCategoryKey)
    ) {
        throw new Error(`Beste Kategorie "${normalizedBestCategoryKey}" ist nicht in den finalen Kategorien enthalten.`);
    }

    return {
        key: normalizedBestCategoryKey,
        title: taxonomyEntry.title,
        wordpressId: taxonomyEntry.wordpressId
    };
}

module.exports = {
    getAllowedCategoryKeysForSchemaEnum,
    getAllowedTopicCategoryKeysForSchemaEnum,
    getAllowedCategoryOptionsForAi,
    resolveSelectedCategories,
    resolveBestCategory,
    normalizeSelectedCategoryKeys,
    normalizeBestCategoryKey
};