# Local test

1. Start Azurite in the first terminal

    azurite

2. Start the Azure Function in the second terminal

    func start

3. Send a test request in the third terminal

    curl -X POST "http://localhost:7071/api/process-mail-to-wordpress" -H "Content-Type: application/json" -d "{\"from\":\"newsletter@anbieter.ch\",\"subject\":\"Test Mail\",\"text_body\":\"This is a test mail content.\"}"

Keep the first two terminal windows running while testing.