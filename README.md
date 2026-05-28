# mail-to-wordpress

Azure Function project that receives email content from a mail automation flow and creates WordPress drafts.

The project supports two processing flows:

- `processMailToWordPress`: uses the email as source material, can perform OpenAI web search, rewrites the content into a new editorial WordPress draft, assigns categories and tags, stores an ACF lead text, adds sources, and can optionally generate a featured image.
- `processOriginalMailToWordPress`: keeps the original title, lead, and article text from the email, assigns categories and tags, stores an ACF lead text, and can optionally generate a featured image.

## Processing overview

### Rewrite flow

Route:

```text
/api/process-mail-to-wordpress
```

This flow creates a new editorial article from the incoming email.

Main steps:

1. Receive email data from Power Automate.
2. Validate sender, subject, and email body.
3. Normalize `text_body` or convert `html_body` to plain text.
4. Read optional `additional_instructions`.
5. Send source text, metadata, category options, and optional additional instructions to OpenAI.
6. OpenAI performs the editorial rewrite and, when enabled, web research.
7. The result is validated and enriched with resolved categories and tags.
8. A WordPress draft is created.
9. A featured image can optionally be generated and assigned.

### Original-mail flow

Route:

```text
/api/process-original-mail-to-wordpress
```

This flow keeps the original title, lead, and article text from the email.

OpenAI is used only to detect the original title, lead, article text, categories, tags, and featured image prompt. The article text is not rewritten.

At the moment, `additional_instructions` are used by the rewrite flow only.

## Request body

### Rewrite flow request

```json
{
  "from": "newsletter@example.com",
  "subject": "Example mail subject",
  "text_body": "Plain text email content.",
  "html_body": "",
  "additional_instructions": "Optional article-specific instructions."
}
```

### Required fields

For `processMailToWordPress`:

- `subject`
- either `text_body` or `html_body`

For `processOriginalMailToWordPress`:

- `subject`
- either `text_body` or `html_body`

### Optional fields

#### `additional_instructions`

Optional article-specific instructions for the rewrite flow.

Example:

```json
{
  "additional_instructions": "Mention why this topic is relevant for a Swiss real estate news website."
}
```

Rules:

- Used only by `processMailToWordPress`.
- Optional. Empty values are ignored.
- Normalized before being sent to OpenAI.
- Limited to 3000 characters.
- Treated as article-specific editorial guidance.
- Must not override fixed editorial rules in `openAiService.js`.
- Must not override the JSON schema, WordPress requirements, factual accuracy, or source rules.
- If the instruction requests a specific mention, angle, or explanation, the prompt tells OpenAI to integrate it naturally into `content_html` where allowed.
- Instructions are not treated as verified facts unless supported by the email input or web research.

## Power Automate mail flow

Power Automate is responsible for receiving emails from the shared mailbox and sending a JSON request to the Azure Function.

### Trigger

Use:

```text
When a new email arrives in a shared mailbox (V2)
```

Recommended trigger settings:

```json
{
  "hasAttachments": false,
  "includeAttachments": true
}
```

Why:

- `hasAttachments: false` keeps normal emails without attachments working.
- `includeAttachments: true` makes attachment content available to the flow.

### Additional instructions from TXT attachments

The Power Automate flow can read `.txt` attachments and pass their content as `additional_instructions`.

Recommended behaviour:

- Every `.txt` attachment is treated as an optional source of article-specific instructions.
- Other attachment types are ignored.
- Empty TXT files are ignored.
- Multiple TXT files are appended into one instruction string.
- TXT content is decoded in Power Automate before being sent to Azure.
- The Azure Function receives only the final plain text in `additional_instructions`.

Recommended Power Automate structure:

```text
When a new email arrives in a shared mailbox (V2)
↓
Initialize variable: AdditionalInstructions
↓
Apply to each attachment
    ↓
    Condition: file name ends with .txt
        ↓ True
        Compose Decode TXT
        ↓
        Condition: decoded TXT content is not empty
            ↓ True
            Append to string variable: AdditionalInstructions
↓
Compose RequestBody
↓
HTTP
```

### Apply to each

Use this expression as the array input:

```text
coalesce(triggerOutputs()?['body/attachments'], createArray())
```

### TXT file condition

Inside the attachment loop, check whether the current attachment is a TXT file:

```text
endsWith(toLower(coalesce(item()?['name'], item()?['Name'], '')), '.txt')
```

Compare the result with:

```text
true
```

### Decode TXT content

Use a Compose action in the true branch:

```text
trim(base64ToString(coalesce(item()?['contentBytes'], item()?['ContentBytes'], '')))
```

### Ignore empty TXT content

Use a second condition:

```text
not(empty(outputs('Compose_Decode_TXT')))
```

Compare the result with:

```text
true
```

### Append TXT content to variable

Use `Append to string variable` with this value:

```text
concat(outputs('Compose_Decode_TXT'), '\n\n')
```

Do not reference the same variable inside its own append expression. Power Automate does not allow self-references when updating a variable.

### Compose RequestBody

After the attachment loop, build the request body:

```json
{
  "from": "@{triggerOutputs()?['body/from']}",
  "subject": "@{triggerOutputs()?['body/subject']}",
  "text_body": "",
  "html_body": "@{triggerOutputs()?['body/body']}",
  "additional_instructions": "@{variables('AdditionalInstructions')}"
}
```

### HTTP action

Send the composed JSON body to the rewrite endpoint:

```json
{
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "@outputs('Compose_RequestBody')"
}
```

## Local start

1. Start Azurite in the first terminal.

```bash
azurite
```

2. Start the Azure Function in the second terminal.

```bash
func start
```

3. Send a local test request to the rewrite flow.

```bash
curl -X POST "http://localhost:7071/api/process-mail-to-wordpress" \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"newsletter@example.com\",\"subject\":\"Test Mail\",\"text_body\":\"This is a test mail content.\"}"
```

4. Test the rewrite flow with additional instructions.

```bash
curl -X POST "http://localhost:7071/api/process-mail-to-wordpress" \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"newsletter@example.com\",\"subject\":\"Test Mail\",\"text_body\":\"This is a test mail content.\",\"additional_instructions\":\"Explain why this topic is relevant for a Swiss real estate news website.\"}"
```

5. Or test the rewrite flow with a local JSON file.

```bash
curl -X POST "http://localhost:7071/api/process-mail-to-wordpress" \
  -H "Content-Type: application/json" \
  --data-binary "@test-data/real-mail-01.json"
```

6. Test the original-mail flow with a local JSON file.

```bash
curl -X POST "http://localhost:7071/api/process-original-mail-to-wordpress" \
  -H "Content-Type: application/json" \
  --data-binary "@test-data/original-mail-01.json"
```

Keep the Azurite terminal and the Function terminal running while testing.

## Routes

### `processMailToWordPress`

Route:

```text
/api/process-mail-to-wordpress
```

Local URL:

```text
http://localhost:7071/api/process-mail-to-wordpress
```

Azure URL:

```text
https://mail-to-wordpress.azurewebsites.net/api/process-mail-to-wordpress?code=YOUR_FUNCTION_KEY
```

This flow uses the email as a starting point, can perform OpenAI web search, creates a new editorial article, assigns categories and tags, stores the lead in ACF, and can generate a featured image.

### `processOriginalMailToWordPress`

Route:

```text
/api/process-original-mail-to-wordpress
```

Local URL:

```text
http://localhost:7071/api/process-original-mail-to-wordpress
```

Azure URL:

```text
https://mail-to-wordpress.azurewebsites.net/api/process-original-mail-to-wordpress?code=YOUR_FUNCTION_KEY
```

This flow keeps the original title, lead, and article text from the email. OpenAI is only used to detect the original title, lead, article text, categories, tags, and the featured image prompt.

## Azure deploy

1. Login to Azure.

```bash
az login
```

2. Publish the project from the project folder.

```bash
func azure functionapp publish mail-to-wordpress
```

3. In Azure Portal, open the Function App and add the required environment variables under:

```text
Settings -> Environment variables -> App settings
```

## Environment variables

Custom settings used by this project:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_ORIGINAL_MODEL`
- `ENABLE_OPENAI_WEB_SEARCH`
- `OPENAI_WEB_SEARCH_CONTEXT_SIZE`
- `OPENAI_WEB_SEARCH_BLOCKED_DOMAINS`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_IMAGE_SIZE`
- `OPENAI_IMAGE_QUALITY`
- `OPENAI_IMAGE_OUTPUT_FORMAT`
- `ENABLE_FEATURED_IMAGE_GENERATION`
- `MAIL_ALLOWED_SENDERS`
- `WORDPRESS_BASE_URL`
- `WORDPRESS_USERNAME`
- `WORDPRESS_APPLICATION_PASSWORD`
- `WORDPRESS_DEFAULT_STATUS`
- `WORDPRESS_DEFAULT_CATEGORY_IDS`
- `WORDPRESS_ACF_LEAD_FIELD_NAME`

Do not replace Azure-managed settings like:

- `APPLICATIONINSIGHTS_CONNECTION_STRING`
- `AzureWebJobsStorage`
- `DEPLOYMENT_STORAGE_CONNECTION_STRING`

### `OPENAI_API_KEY`

OpenAI API key used for text processing and optional image generation.

### `OPENAI_MODEL`

Model used by the rewrite flow.

Used by:

```text
processMailToWordPress
```

This flow can use web search and creates a newly written editorial article.

Example:

```text
OPENAI_MODEL=gpt-5.5
```

### `OPENAI_ORIGINAL_MODEL`

Model used by the original-mail flow.

Used by:

```text
processOriginalMailToWordPress
```

This can be a cheaper model because the article is not rewritten and web search is not used in this flow. If this variable is not set, the code can fall back to `OPENAI_MODEL`.

Example:

```text
OPENAI_ORIGINAL_MODEL=gpt-5.4-mini
```

### `ENABLE_OPENAI_WEB_SEARCH`

Controls whether OpenAI web search is enabled for the rewrite flow.

Recommended value:

```text
true
```

Used by:

```text
processMailToWordPress
```

The original-mail flow does not use web search.

### `OPENAI_WEB_SEARCH_CONTEXT_SIZE`

Controls how much web context is used by OpenAI web search.

Supported values:

```text
low
medium
high
```

Recommended default:

```text
medium
```

### `OPENAI_WEB_SEARCH_BLOCKED_DOMAINS`

Comma-separated list of domains that should be excluded from OpenAI web search.

Example:

```text
wikipedia.org,reddit.com,quora.com
```

### `OPENAI_IMAGE_MODEL`

Model used for featured image generation.

Example:

```text
gpt-image-1.5
```

### `OPENAI_IMAGE_SIZE`

Image size used for generated featured images.

Example:

```text
1536x1024
```

### `OPENAI_IMAGE_QUALITY`

Image quality used for generated featured images.

Example:

```text
high
```

### `OPENAI_IMAGE_OUTPUT_FORMAT`

Image output format.

Example:

```text
jpeg
```

### `ENABLE_FEATURED_IMAGE_GENERATION`

Controls whether featured images are generated.

Example:

```text
true
```

If disabled, the WordPress post is created without a generated featured image.

### `MAIL_ALLOWED_SENDERS`

Comma-separated list of allowed sender email addresses.

Example:

```text
newsletter@example.com
```

If empty, all senders are accepted.

### `WORDPRESS_BASE_URL`

Base URL of the WordPress installation.

Example:

```text
https://example.com
```

### `WORDPRESS_USERNAME`

WordPress username used for the REST API.

### `WORDPRESS_APPLICATION_PASSWORD`

WordPress application password used for the REST API.

Spaces are removed by the application.

### `WORDPRESS_DEFAULT_STATUS`

Default WordPress post status.

Example:

```text
draft
```

### `WORDPRESS_DEFAULT_CATEGORY_IDS`

Fallback WordPress category IDs.

Example:

```text
12,34,56
```

### `WORDPRESS_ACF_LEAD_FIELD_NAME`

ACF field name used for the lead text.

Default:

```text
lead
```

## Azure test

1. In Azure Portal, open the Function App URL:

```text
Function App -> Functions -> processMailToWordPress -> Get function URL
```

or:

```text
Function App -> Functions -> processOriginalMailToWordPress -> Get function URL
```

2. Use the URL with the default function key.

3. Test the deployed rewrite flow.

```bash
curl -X POST "https://mail-to-wordpress.azurewebsites.net/api/process-mail-to-wordpress?code=YOUR_FUNCTION_KEY" \
  -H "Content-Type: application/json" \
  --data-binary "@test-data/real-mail-01.json"
```

4. Test the deployed rewrite flow with additional instructions.

```bash
curl -X POST "https://mail-to-wordpress.azurewebsites.net/api/process-mail-to-wordpress?code=YOUR_FUNCTION_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"newsletter@example.com\",\"subject\":\"Test Mail\",\"text_body\":\"This is a test mail content.\",\"additional_instructions\":\"Mention the relevance for xxx in the article.\"}"
```

5. Test the deployed original-mail flow.

```bash
curl -X POST "https://mail-to-wordpress.azurewebsites.net/api/process-original-mail-to-wordpress?code=YOUR_FUNCTION_KEY" \
  -H "Content-Type: application/json" \
  --data-binary "@test-data/original-mail-01.json"
```

## Testing checklist

### Without TXT attachment

Expected result:

- Power Automate sends an empty `additional_instructions` value.
- Azure Function processes the mail normally.
- WordPress draft is created as before.

### With TXT attachment

Expected result:

- Power Automate decodes the TXT file.
- Request body contains readable text in `additional_instructions`.
- The rewrite flow passes the instructions to OpenAI.
- The article reflects the allowed instructions in `content_html`.
- Fixed editorial rules still take priority.

### Edge cases

Check:

- Empty TXT file.
- Multiple TXT files.
- Non-TXT attachments.
- Very long TXT content.
- Conflicting or promotional instructions.
- Mail without attachments.
- Mail with attachments but without TXT file.

## Notes

- Function App name in Azure: `mail-to-wordpress`
- Rewrite route: `/api/process-mail-to-wordpress`
- Original-mail route: `/api/process-original-mail-to-wordpress`
- `test-data/` is ignored by Git for local test files
- `OPENAI_MODEL` is used for the rewrite flow
- `OPENAI_ORIGINAL_MODEL` is used for the original-mail flow
- OpenAI web search is only used by the rewrite flow
- Featured image generation can be enabled with `ENABLE_FEATURED_IMAGE_GENERATION=true`
- Additional instructions are optional and currently only used by the rewrite flow
- TXT attachment parsing happens in Power Automate, not inside the Azure Function
