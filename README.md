# mail-to-wordpress

Azure Function project that receives email content, rewrites it with OpenAI, and creates a WordPress draft with categories, tags, and ACF lead text.

## Local start

1. Start Azurite in the first terminal

azurite

2. Start the Azure Function in the second terminal

func start

3. Send a local test request in the third terminal

curl -X POST "http://localhost:7071/api/process-mail-to-wordpress" -H "Content-Type: application/json" -d "{\"from\":\"newsletter@anbieter.ch\",\"subject\":\"Test Mail\",\"text_body\":\"This is a test mail content.\"}"

4. Or test with a local JSON file

curl -X POST "http://localhost:7071/api/process-mail-to-wordpress" -H "Content-Type: application/json" --data-binary "@test-data\real-mail-01.json"

Keep the Azurite terminal and the Function terminal running while testing.

## Azure deploy (Terminal)

1. Login to Azure

az login

2. Publish the project from the project folder

func azure functionapp publish mail-to-wordpress

3. In Azure Portal, open the Function App and add the required Environment variables under:

Settings -> Environment variables -> App settings

Custom settings used by this project:

OPENAI_API_KEY
OPENAI_MODEL
MAIL_ALLOWED_SENDERS
WORDPRESS_BASE_URL
WORDPRESS_USERNAME
WORDPRESS_APPLICATION_PASSWORD
WORDPRESS_DEFAULT_STATUS
WORDPRESS_DEFAULT_CATEGORY_IDS
WORDPRESS_ACF_LEAD_FIELD_NAME

Do not replace Azure-managed settings like:

APPLICATIONINSIGHTS_CONNECTION_STRING
AzureWebJobsStorage
DEPLOYMENT_STORAGE_CONNECTION_STRING

## Azure test

1. In Azure Portal open:

Function App -> Functions -> processMailToWordPress -> Get function URL

2. Use the URL with:

default (Function key)

3. Test the deployed function

curl -X POST "https://mail-to-wordpress.azurewebsites.net/api/process-mail-to-wordpress?code=YOUR_FUNCTION_KEY" -H "Content-Type: application/json" --data-binary "@test-data\real-mail-01.json"

## Notes

- Function name in Azure: mail-to-wordpress
- Route: /api/process-mail-to-wordpress
- test-data/ is ignored by Git for local test files