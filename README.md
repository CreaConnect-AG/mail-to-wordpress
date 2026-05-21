# mail-to-wordpress

Azure Function project that receives email content and creates WordPress drafts.

The project supports two processing flows:

  * processMailToWordPress: researches additional context with OpenAI web search, rewrites the email into a new editorial WordPress draft, assigns categories and tags, stores an ACF lead text, adds sources, and can optionally generate a featured image.
  * processOriginalMailToWordPress: keeps the original title, lead, and article text from the email, assigns categories and tags, stores an ACF lead text, and can optionally generate a featured image.

## Local start

  1. Start Azurite in the first terminal

    azurite

  2. Start the Azure Function in the second terminal

    func start

  3. Send a local test request to the rewrite flow

    curl -X POST "http://localhost:7071/api/process-mail-to-wordpress" -H "Content-Type: application/json" -d "{\"from\":\"newsletter@anbieter.ch\",\"subject\":\"Test Mail\",\"text_body\":\"This is a test mail content.\"}"

  4. Or test the rewrite flow with a local JSON file

    curl -X POST "http://localhost:7071/api/process-mail-to-wordpress" -H "Content-Type: application/json" --data-binary "@test-data\real-mail-01.json"

  5. Test the original-mail flow with a local JSON file

    curl -X POST "http://localhost:7071/api/process-original-mail-to-wordpress" -H "Content-Type: application/json" --data-binary "@test-data\original-mail-01.json"

Keep the Azurite terminal and the Function terminal running while testing.

## Routes

### processMailToWordPress

Route:

    /api/process-mail-to-wordpress

This flow uses the email as a starting point, can perform OpenAI web search, creates a new editorial article, assigns categories and tags, stores the lead in ACF, and can generate a featured image.

Local URL:

    http://localhost:7071/api/process-mail-to-wordpress

Azure URL:

    https://mail-to-wordpress.azurewebsites.net/api/process-mail-to-wordpress?code=YOUR_FUNCTION_KEY

### processOriginalMailToWordPress

Route:

    /api/process-original-mail-to-wordpress

This flow keeps the original title, lead, and article text from the email. OpenAI is only used to detect the original title, lead, and article text, and to generate categories, tags, and the featured image prompt.

Local URL:

    http://localhost:7071/api/process-original-mail-to-wordpress

Azure URL:

    https://mail-to-wordpress.azurewebsites.net/api/process-original-mail-to-wordpress?code=YOUR_FUNCTION_KEY

## Azure deploy (Terminal)

  1. Login to Azure

    az login

  2. Publish the project from the project folder

    func azure functionapp publish mail-to-wordpress

  3. In Azure Portal, open the Function App and add the required Environment variables under:

Settings -> Environment variables -> App settings

Custom settings used by this project:

  * OPENAI_API_KEY
  * OPENAI_MODEL
  * OPENAI_ORIGINAL_MODEL
  * ENABLE_OPENAI_WEB_SEARCH
  * OPENAI_WEB_SEARCH_CONTEXT_SIZE
  * OPENAI_WEB_SEARCH_BLOCKED_DOMAINS
  * OPENAI_IMAGE_MODEL
  * OPENAI_IMAGE_SIZE
  * OPENAI_IMAGE_QUALITY
  * OPENAI_IMAGE_OUTPUT_FORMAT
  * ENABLE_FEATURED_IMAGE_GENERATION
  * MAIL_ALLOWED_SENDERS
  * WORDPRESS_BASE_URL
  * WORDPRESS_USERNAME
  * WORDPRESS_APPLICATION_PASSWORD
  * WORDPRESS_DEFAULT_STATUS
  * WORDPRESS_DEFAULT_CATEGORY_IDS
  * WORDPRESS_ACF_LEAD_FIELD_NAME

Example OpenAI settings:

    OPENAI_MODEL=gpt-5.5
    OPENAI_ORIGINAL_MODEL=gpt-5.4-mini
    ENABLE_OPENAI_WEB_SEARCH=true
    OPENAI_WEB_SEARCH_CONTEXT_SIZE=medium
    OPENAI_WEB_SEARCH_BLOCKED_DOMAINS=wikipedia.org,reddit.com,quora.com

Do not replace Azure-managed settings like:

  * APPLICATIONINSIGHTS_CONNECTION_STRING
  * AzureWebJobsStorage
  * DEPLOYMENT_STORAGE_CONNECTION_STRING

## Environment variables

### OPENAI_API_KEY

OpenAI API key used for text processing and optional image generation.

### OPENAI_MODEL

Model used by the rewrite flow.

Used by:

    processMailToWordPress

This flow can use web search and creates a newly written editorial article.

### OPENAI_ORIGINAL_MODEL

Model used by the original-mail flow.

Used by:

    processOriginalMailToWordPress

This can be a cheaper model because the article is not rewritten and web search is not used in this flow. If this variable is not set, the code can fall back to OPENAI_MODEL.

### ENABLE_OPENAI_WEB_SEARCH

Controls whether OpenAI web search is enabled for the rewrite flow.

Recommended value:

    true

Used by:

    processMailToWordPress

The original-mail flow does not use web search.

### OPENAI_WEB_SEARCH_CONTEXT_SIZE

Controls how much web context is used by OpenAI web search.

Supported values:

    low
    medium
    high

Recommended default:

    medium

### OPENAI_WEB_SEARCH_BLOCKED_DOMAINS

Comma-separated list of domains that should be excluded from OpenAI web search.

Example:

    wikipedia.org,reddit.com,quora.com

### OPENAI_IMAGE_MODEL

Model used for featured image generation.

Example:

    gpt-image-1.5

### OPENAI_IMAGE_SIZE

Image size used for generated featured images.

Example:

    1536x1024

### OPENAI_IMAGE_QUALITY

Image quality used for generated featured images.

Example:

    high

### OPENAI_IMAGE_OUTPUT_FORMAT

Image output format.

Example:

    jpeg

### ENABLE_FEATURED_IMAGE_GENERATION

Controls whether featured images are generated.

Example:

    true

If disabled, the WordPress post is created without a generated featured image.

### MAIL_ALLOWED_SENDERS

Comma-separated list of allowed sender email addresses.

Example:

    newsletter@anbieter.ch

If empty, all senders are accepted.

### WORDPRESS_BASE_URL

Base URL of the WordPress installation.

Example:

    https://example.com

### WORDPRESS_USERNAME

WordPress username used for the REST API.

### WORDPRESS_APPLICATION_PASSWORD

WordPress application password used for the REST API.

Spaces are removed by the application.

### WORDPRESS_DEFAULT_STATUS

Default WordPress post status.

Example:

    draft

### WORDPRESS_DEFAULT_CATEGORY_IDS

Fallback WordPress category IDs.

Example:

    12,34,56

### WORDPRESS_ACF_LEAD_FIELD_NAME

ACF field name used for the lead text.

Default:

    lead

## Azure test

  1. In Azure Portal open:

Function App -> Functions -> processMailToWordPress -> Get function URL

or:

Function App -> Functions -> processOriginalMailToWordPress -> Get function URL

  2. Use the URL with:

default (Function key)

  3. Test the deployed rewrite flow

    curl -X POST "https://mail-to-wordpress.azurewebsites.net/api/process-mail-to-wordpress?code=YOUR_FUNCTION_KEY" -H "Content-Type: application/json" --data-binary "@test-data\real-mail-01.json"

  4. Test the deployed original-mail flow

    curl -X POST "https://mail-to-wordpress.azurewebsites.net/api/process-original-mail-to-wordpress?code=YOUR_FUNCTION_KEY" -H "Content-Type: application/json" --data-binary "@test-data\original-mail-01.json"

## Notes

  * Function App name in Azure: mail-to-wordpress
  * Rewrite route: /api/process-mail-to-wordpress
  * Original-mail route: /api/process-original-mail-to-wordpress
  * test-data/ is ignored by Git for local test files
  * OPENAI_MODEL is used for the rewrite flow
  * OPENAI_ORIGINAL_MODEL is used for the original-mail flow
  * OpenAI web search is only used by the rewrite flow
  * Featured image generation can be enabled with ENABLE_FEATURED_IMAGE_GENERATION=true
