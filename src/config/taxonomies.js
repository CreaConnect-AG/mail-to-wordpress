const taxonomyEntries = [
    {
        key: 'energie',
        title: 'Energie',
        wordpressId: 49,
        parentKey: null,
        type: 'topic',
        selectable: true
    },

    {
        key: 'finanzen',
        title: 'Finanzen',
        wordpressId: 4,
        parentKey: null,
        type: 'topic',
        selectable: true
    },
    {
        key: 'bewertungen_marktanalysen',
        title: 'Bewertungen & Marktanalysen',
        wordpressId: 54,
        parentKey: 'finanzen',
        type: 'topic',
        selectable: true
    },
    {
        key: 'finanzierungsstrategien',
        title: 'Finanzierungsstrategien',
        wordpressId: 55,
        parentKey: 'finanzen',
        type: 'topic',
        selectable: true
    },
    {
        key: 'immobilienfonds_reits_pks',
        title: 'Immobilienfonds / REITs / PKs',
        wordpressId: 56,
        parentKey: 'finanzen',
        type: 'topic',
        selectable: true
    },
    {
        key: 'transaktionen_deals',
        title: 'Transaktionen / Deals',
        wordpressId: 57,
        parentKey: 'finanzen',
        type: 'topic',
        selectable: true
    },
    {
        key: 'zinsen_kapitalmaerkte',
        title: 'Zinsen, Kapitalmaerkte',
        wordpressId: 58,
        parentKey: 'finanzen',
        type: 'topic',
        selectable: true
    },

    {
        key: 'institutionen_bildung',
        title: 'Institutionen & Bildung',
        wordpressId: 77,
        parentKey: null,
        type: 'topic',
        selectable: true
    },
    {
        key: 'standortfoerderung',
        title: 'Standortfoerderung',
        wordpressId: 78,
        parentKey: 'institutionen_bildung',
        type: 'topic',
        selectable: true
    },
    {
        key: 'verbaende',
        title: 'Verbände',
        wordpressId: 79,
        parentKey: 'institutionen_bildung',
        type: 'topic',
        selectable: true
    },

    {
        key: 'menschen',
        title: 'Menschen',
        wordpressId: 59,
        parentKey: null,
        type: 'topic',
        selectable: true
    },
    {
        key: 'interviews',
        title: 'Interviews',
        wordpressId: 60,
        parentKey: 'menschen',
        type: 'topic',
        selectable: true
    },
    {
        key: 'personen',
        title: 'Personen',
        wordpressId: 5,
        parentKey: 'menschen',
        type: 'topic',
        selectable: true
    },

    {
        key: 'projekte',
        title: 'Projekte',
        wordpressId: 11,
        parentKey: null,
        type: 'topic',
        selectable: true
    },
    {
        key: 'areale_quartiere',
        title: 'Areale / Quartiere',
        wordpressId: 61,
        parentKey: 'projekte',
        type: 'topic',
        selectable: true
    },
    {
        key: 'buero_gewerbe',
        title: 'Büro / Gewerbe',
        wordpressId: 62,
        parentKey: 'projekte',
        type: 'topic',
        selectable: true
    },
    {
        key: 'hotel_tourismus',
        title: 'Hotel / Tourismus',
        wordpressId: 63,
        parentKey: 'projekte',
        type: 'topic',
        selectable: true
    },
    {
        key: 'neubau',
        title: 'Neubau',
        wordpressId: 51,
        parentKey: 'projekte',
        type: 'topic',
        selectable: true
    },
    {
        key: 'retail',
        title: 'Retail',
        wordpressId: 64,
        parentKey: 'projekte',
        type: 'topic',
        selectable: true
    },
    {
        key: 'sanierung',
        title: 'Sanierung',
        wordpressId: 52,
        parentKey: 'projekte',
        type: 'topic',
        selectable: true
    },
    {
        key: 'wohnen',
        title: 'Wohnen',
        wordpressId: 65,
        parentKey: 'projekte',
        type: 'topic',
        selectable: true
    },

    {
        key: 'trends',
        title: 'Trends',
        wordpressId: 10,
        parentKey: null,
        type: 'topic',
        selectable: true
    },
    {
        key: 'bauwirtschaft',
        title: 'Bauwirtschaft',
        wordpressId: 44,
        parentKey: 'trends',
        type: 'topic',
        selectable: true
    },
    {
        key: 'bewirtschaftung',
        title: 'Bewirtschaftung',
        wordpressId: 73,
        parentKey: 'trends',
        type: 'topic',
        selectable: true
    },
    {
        key: 'facility_management',
        title: 'Facility Management',
        wordpressId: 74,
        parentKey: 'trends',
        type: 'topic',
        selectable: true
    },
    {
        key: 'mobilitaet',
        title: 'Mobilität',
        wordpressId: 48,
        parentKey: 'trends',
        type: 'topic',
        selectable: true
    },
    {
        key: 'nachhaltigkeit',
        title: 'Nachhaltigkeit',
        wordpressId: 45,
        parentKey: 'trends',
        type: 'topic',
        selectable: true
    },
    {
        key: 'planung_entwicklung',
        title: 'Planung / Entwicklung',
        wordpressId: 75,
        parentKey: 'trends',
        type: 'topic',
        selectable: true
    },
    {
        key: 'proptech',
        title: 'propTech',
        wordpressId: 46,
        parentKey: 'trends',
        type: 'topic',
        selectable: true
    },
    {
        key: 'unternehmen',
        title: 'Unternehmen',
        wordpressId: 47,
        parentKey: 'trends',
        type: 'topic',
        selectable: true
    },
    {
        key: 'verkauf_makler',
        title: 'Verkauf / Makler',
        wordpressId: 76,
        parentKey: 'trends',
        type: 'topic',
        selectable: true
    },

    {
        key: 'regionen',
        title: 'Regionen',
        wordpressId: 9,
        parentKey: null,
        type: 'region',
        selectable: false
    },
    {
        key: 'international',
        title: 'International',
        wordpressId: 66,
        parentKey: 'regionen',
        type: 'region',
        selectable: true
    },
    {
        key: 'global',
        title: 'Global',
        wordpressId: 21,
        parentKey: 'international',
        type: 'region',
        selectable: false
    },

    {
        key: 'schweiz',
        title: 'Schweiz',
        wordpressId: 29,
        parentKey: 'regionen',
        type: 'region',
        selectable: true
    },
    {
        key: 'espace_mittelland',
        title: 'Espace Mittelland',
        wordpressId: 67,
        parentKey: 'schweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'bern',
        title: 'Bern',
        wordpressId: 17,
        parentKey: 'espace_mittelland',
        type: 'region',
        selectable: true
    },
    {
        key: 'freiburg',
        title: 'Freiburg',
        wordpressId: 18,
        parentKey: 'espace_mittelland',
        type: 'region',
        selectable: true
    },
    {
        key: 'jura',
        title: 'Jura',
        wordpressId: 23,
        parentKey: 'espace_mittelland',
        type: 'region',
        selectable: true
    },
    {
        key: 'neuenburg',
        title: 'Neuenburg',
        wordpressId: 25,
        parentKey: 'espace_mittelland',
        type: 'region',
        selectable: true
    },
    {
        key: 'solothurn',
        title: 'Solothurn',
        wordpressId: 31,
        parentKey: 'espace_mittelland',
        type: 'region',
        selectable: true
    },
    {
        key: 'thun',
        title: 'Thun',
        wordpressId: 35,
        parentKey: 'espace_mittelland',
        type: 'region',
        selectable: true
    },

    {
        key: 'genferseeregion',
        title: 'Genferseeregion',
        wordpressId: 68,
        parentKey: 'schweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'genf',
        title: 'Genf',
        wordpressId: 19,
        parentKey: 'genferseeregion',
        type: 'region',
        selectable: true
    },
    {
        key: 'waadt',
        title: 'Waadt',
        wordpressId: 38,
        parentKey: 'genferseeregion',
        type: 'region',
        selectable: true
    },
    {
        key: 'wallis',
        title: 'Wallis',
        wordpressId: 39,
        parentKey: 'genferseeregion',
        type: 'region',
        selectable: true
    },

    {
        key: 'nordwestschweiz',
        title: 'Nordwestschweiz',
        wordpressId: 69,
        parentKey: 'schweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'aargau',
        title: 'Aargau',
        wordpressId: 12,
        parentKey: 'nordwestschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'baden',
        title: 'Baden',
        wordpressId: 15,
        parentKey: 'aargau',
        type: 'region',
        selectable: true
    },
    {
        key: 'basel',
        title: 'Basel',
        wordpressId: 16,
        parentKey: 'nordwestschweiz',
        type: 'region',
        selectable: true
    },

    {
        key: 'ostschweiz',
        title: 'Ostschweiz',
        wordpressId: 70,
        parentKey: 'schweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'appenzell_ausserrhoden',
        title: 'Appenzell Ausserrhoden',
        wordpressId: 13,
        parentKey: 'ostschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'appenzell_innerrhoden',
        title: 'Appenzell Innerrhoden',
        wordpressId: 14,
        parentKey: 'ostschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'glarus',
        title: 'Glarus',
        wordpressId: 20,
        parentKey: 'ostschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'graubuenden',
        title: 'Graubuenden',
        wordpressId: 22,
        parentKey: 'ostschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'schaffhausen',
        title: 'Schaffhausen',
        wordpressId: 28,
        parentKey: 'ostschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'st_gallen',
        title: 'St. Gallen',
        wordpressId: 32,
        parentKey: 'ostschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'thurgau',
        title: 'Thurgau',
        wordpressId: 36,
        parentKey: 'ostschweiz',
        type: 'region',
        selectable: true
    },

    {
        key: 'tessin',
        title: 'Tessin',
        wordpressId: 34,
        parentKey: 'schweiz',
        type: 'region',
        selectable: true
    },

    {
        key: 'zentralschweiz',
        title: 'Zentralschweiz',
        wordpressId: 41,
        parentKey: 'schweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'luzern',
        title: 'Luzern',
        wordpressId: 24,
        parentKey: 'zentralschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'nidwalden',
        title: 'Nidwalden',
        wordpressId: 26,
        parentKey: 'zentralschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'obwalden',
        title: 'Obwalden',
        wordpressId: 27,
        parentKey: 'zentralschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'schwyz',
        title: 'Schwyz',
        wordpressId: 30,
        parentKey: 'zentralschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'uri',
        title: 'Uri',
        wordpressId: 37,
        parentKey: 'zentralschweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'zug',
        title: 'Zug',
        wordpressId: 42,
        parentKey: 'zentralschweiz',
        type: 'region',
        selectable: true
    },

    {
        key: 'zuerich',
        title: 'Zürich',
        wordpressId: 43,
        parentKey: 'schweiz',
        type: 'region',
        selectable: true
    },
    {
        key: 'winterthur',
        title: 'Winterthur',
        wordpressId: 40,
        parentKey: 'zuerich',
        type: 'region',
        selectable: true
    }
];

const taxonomyEntryMap = Object.fromEntries(
    taxonomyEntries.map((entry) => [entry.key, entry])
);

const selectableTaxonomyEntries = taxonomyEntries.filter((entry) => entry.selectable);

module.exports = {
    taxonomyEntries,
    taxonomyEntryMap,
    selectableTaxonomyEntries
};