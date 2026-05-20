const {
    wordpressBaseUrl,
    wordpressUsername,
    wordpressApplicationPassword,
    wordpressDefaultStatus,
    wordpressDefaultCategoryIds,
    wordpressAcfLeadFieldName,
    wordpressAcfBestCategoryFieldName
} = require('../config/environment');

const {
    normalizeWhitespace,
    sanitizeSlug
} = require('../utils/textUtils');

async function createWordPressDraft(rewrittenPost) {
    const authorizationHeader = Buffer
        .from(`${wordpressUsername}:${wordpressApplicationPassword}`)
        .toString('base64');

    const assignedTagIds = await ensureWordPressTagIds(
        rewrittenPost.tag_names || [],
        authorizationHeader
    );

    const wordpressPayload = {
        status: wordpressDefaultStatus,
        title: rewrittenPost.title,
        excerpt: rewrittenPost.excerpt,
        content: rewrittenPost.content_html
    };

    if (rewrittenPost.slug) {
        wordpressPayload.slug = rewrittenPost.slug;
    }

    if (Array.isArray(rewrittenPost.category_ids) && rewrittenPost.category_ids.length > 0) {
        wordpressPayload.categories = rewrittenPost.category_ids;
    } else if (wordpressDefaultCategoryIds.length > 0) {
        wordpressPayload.categories = wordpressDefaultCategoryIds;
    }

    if (assignedTagIds.length > 0) {
        wordpressPayload.tags = assignedTagIds;
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

    if (wordpressAcfBestCategoryFieldName) {
        const bestCategoryFieldValue = rewrittenPost.best_category_title || '';

        if (!bestCategoryFieldValue) {
            throw new Error('Der WordPress-Beitrag wurde erstellt, aber es wurde keine beste Kategorie ermittelt.');
        }

        const acfBestCategoryUpdateSucceeded = await updateWordPressAcfField({
            postId: createdPost.id,
            fieldName: wordpressAcfBestCategoryFieldName,
            fieldValue: bestCategoryFieldValue,
            authorizationHeader
        });

        if (!acfBestCategoryUpdateSucceeded) {
            throw new Error(`Der WordPress-Beitrag wurde erstellt, aber das ACF-Feld "${wordpressAcfBestCategoryFieldName}" konnte nicht gesetzt werden.`);
        }
    }

    let featuredImageResult = null;

    if (rewrittenPost.generated_featured_image) {
        featuredImageResult = await uploadAndAssignFeaturedImage({
            postId: createdPost.id,
            generatedFeaturedImage: rewrittenPost.generated_featured_image,
            authorizationHeader
        });
    }

    return {
        ...createdPost,
        assigned_tag_ids: assignedTagIds,
        featured_image_media_id: featuredImageResult?.mediaId || null,
        featured_image_url: featuredImageResult?.sourceUrl || null
    };
}

async function ensureWordPressTagIds(tagNames, authorizationHeader) {
    const tagIds = [];

    for (const tagName of tagNames) {
        const tagId = await ensureWordPressTagId(tagName, authorizationHeader);
        tagIds.push(tagId);
    }

    return tagIds;
}

async function ensureWordPressTagId(tagName, authorizationHeader) {
    const normalizedTagName = normalizeWhitespace(String(tagName || ''));
    if (!normalizedTagName) {
        throw new Error('Ungültiger Tag-Name.');
    }

    const tagSlug = sanitizeSlug(normalizedTagName);
    if (!tagSlug) {
        throw new Error(`Ungültiger Tag-Slug für Stichwort "${normalizedTagName}".`);
    }

    const existingTag = await findWordPressTagBySlug({
        tagSlug,
        authorizationHeader
    });

    if (existingTag) {
        return existingTag.id;
    }

    const createResponse = await fetch(`${wordpressBaseUrl}/wp-json/wp/v2/tags`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authorizationHeader}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: normalizedTagName,
            slug: tagSlug
        })
    });

    if (createResponse.ok) {
        const createdTag = await createResponse.json();
        return createdTag.id;
    }

    await createResponse.text();

    const existingTagAfterCreateAttempt = await findWordPressTagBySlug({
        tagSlug,
        authorizationHeader
    });

    if (existingTagAfterCreateAttempt) {
        return existingTagAfterCreateAttempt.id;
    }

    throw new Error(`WordPress-Stichwort "${normalizedTagName}" konnte nicht erstellt oder gefunden werden.`);
}

async function findWordPressTagBySlug({ tagSlug, authorizationHeader }) {
    const response = await fetch(`${wordpressBaseUrl}/wp-json/wp/v2/tags?slug=${encodeURIComponent(tagSlug)}&per_page=100`, {
        method: 'GET',
        headers: {
            'Authorization': `Basic ${authorizationHeader}`
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`WordPress Fehler beim Lesen von Stichwörtern ${response.status}: ${errorText}`);
    }

    const tagResults = await response.json();

    if (!Array.isArray(tagResults) || tagResults.length === 0) {
        return null;
    }

    return tagResults[0];
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

async function uploadAndAssignFeaturedImage({ postId, generatedFeaturedImage, authorizationHeader }) {
    const uploadResponse = await fetch(`${wordpressBaseUrl}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authorizationHeader}`,
            'Content-Type': generatedFeaturedImage.mimeType,
            'Content-Disposition': `attachment; filename="${generatedFeaturedImage.filename}"`
        },
        body: generatedFeaturedImage.buffer
    });

    if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`WordPress Medien-Upload Fehler ${uploadResponse.status}: ${errorText}`);
    }

    const uploadedMedia = await uploadResponse.json();

    const updateMediaResponse = await fetch(`${wordpressBaseUrl}/wp-json/wp/v2/media/${uploadedMedia.id}`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authorizationHeader}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            title: generatedFeaturedImage.title,
            alt_text: generatedFeaturedImage.altText,
            post: postId
        })
    });

    if (!updateMediaResponse.ok) {
        const errorText = await updateMediaResponse.text();
        throw new Error(`WordPress Medien-Metadaten Fehler ${updateMediaResponse.status}: ${errorText}`);
    }

    const updatedMedia = await updateMediaResponse.json();

    const assignResponse = await fetch(`${wordpressBaseUrl}/wp-json/wp/v2/posts/${postId}`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authorizationHeader}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            featured_media: uploadedMedia.id
        })
    });

    if (!assignResponse.ok) {
        const errorText = await assignResponse.text();
        throw new Error(`WordPress Featured-Image Fehler ${assignResponse.status}: ${errorText}`);
    }

    return {
        mediaId: uploadedMedia.id,
        sourceUrl: updatedMedia.source_url || uploadedMedia.source_url || null
    };
}

module.exports = {
    createWordPressDraft
};