This app automates the setup of a Salesforce Event Relay and associated AWS Event Bus after an environment refresh.

**Steps completed:**

   1. Updates Salesforce Named Credential endpoint
   2. Creates Salesforce Event Relay
   3. Ensures the 'Partner Event Source Name' is populated
   4. Changes the Event Relay State to 'RUN'
   5. Ensures the 'Partner Event Source' is present in AWS
   6. Creates the Event Bus in AWS associated with the Partner Event Source
   7. Creates a Discoverer on the Event Bus for AWS Schemas
   8. Creates a Rule in AWS EventBridge
   9. Creates Targets for the Rule in AWS EventBridge
  10. Verifies everything is working correctly by sending a test platform event and comparing sent/received message payloads

<hr>

**Auth:** OAuth 2.0 Authorization Code Flow used for Salesforce connected app (scope: "refresh_token api id"); AWS handled with local credentials/config file(s)

**Uses ES modules (Node v.14 and later):** recommend latest Node.js LTS version

**run:** node start.js