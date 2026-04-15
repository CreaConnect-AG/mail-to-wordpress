const {
    wordpressBaseUrl,
    wordpressUsername,
    wordpressApplicationPassword,
    wordpressDefaultStatus,
    wordpressDefaultCategoryIds,
    wordpressAcfLeadFieldName
} = require('../config/environment');

async function createWordPressDraft(rewrittenPost) {
    const authorizationHeader = Buffer
        .from(`${wordpressUsername}:${wordpressApplicationPassword}`)
        .toString('base64');

    const wordpressPayload = {
        status: wordpressDefaultStatus,
        title: rewrittenPost.title,
        excerpt: rewrittenPost.excerpt,
        content: rewrittenPost.content_html
    };

    if (rewrittenPost.slug) {
        wordpressPayload.slug = rewrittenPost.slug;
    }

    if (wordpressDefaultCategoryIds.length > 0) {
        wordpressPayload.categories = wordpressDefaultCategoryIds;
    }

    const createResponse = await fetch(`${wordpressBaseUrl}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authorizationHeader}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(wordpressPayload)
    });

    if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`WordPress Fehler ${createResponse.status}: ${errorText}`);
    }

    const createdPost = await createResponse.json();

    if (wordpressAcfLeadFieldName) {
        const acfUpdateSucceeded = await updateWordPressAcfField({
            postId: createdPost.id,
            fieldName: wordpressAcfLeadFieldName,
            fieldValue: rewrittenPost.lead,
            authorizationHeader
        });

        if (!acfUpdateSucceeded) {
            throw new Error(`Der WordPress-Beitrag wurde erstellt, aber das ACF-Feld "${wordpressAcfLeadFieldName}" konnte nicht gesetzt werden.`);
        }
    }

    return createdPost;
}

async function updateWordPressAcfField({ postId, fieldName, fieldValue, authorizationHeader }) {
    const updateResponse = await fetch(`${wordpressBaseUrl}/wp-json/wp/v2/posts/${postId}`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authorizationHeader}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            acf: {
                [fieldName]: fieldValue
            }
        })
    });

    return updateResponse.ok;
}

module.exports = {
    createWordPressDraft
};