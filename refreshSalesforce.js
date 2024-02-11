import {
  listEventSources,
  createEventBus,
  createDiscoverer,
  createRule,
  createTarget,
  describeLogStreams,
  getLogEvents,
} from "./refreshAWS.js";

export async function refreshSalesforce(access_token, refresh_token) {
  console.log("\nrefresh Salesforce...");

  try {
    const namedCredId = await fetchNamedCredential(access_token);
    await patchNamedCredential(namedCredId, access_token);
    const eventRelayId = await createEventRelay(access_token);
    await patchEventRelayToRun(eventRelayId, access_token);
    const { accessToken } = await fetchRemoteResource(
      eventRelayId,
      access_token,
      0,
      refresh_token
    );

    // Validate functionality by sending a test event
    await validateFunctionality(accessToken);
  } catch (error) {
    console.error("\nError encountered:", error);
    console.log("\nExiting...");
    process.exit(1);
  }
}

async function fetchNamedCredential(access_token) {
  try {
    const url = `${process.env.BASE_URL}/services/data/${process.env.API_VERSION}/tooling/query/?q=SELECT Id,DeveloperName FROM NamedCredential WHERE MasterLabel = '${process.env.NAMED_CRED_LABEL}'`;
    const response = await fetch(
      url,
      createRequestOptions("GET", createHeaders(access_token))
    );
    const result = await response.json();
    const namedCredId = result.records[0]?.Id;
    if (!namedCredId) {
      throw new Error("Named Credential ID not found");
    }
    console.log(
      "\nretrieved namedCredId:",
      namedCredId,
      "for named credential:",
      result.records[0]?.DeveloperName
    );
    return namedCredId;
  } catch (error) {
    throw new Error(`fetchNamedCredential: ${error.message}`);
  }
}

async function patchNamedCredential(namedCredId, access_token) {
  try {
    const url = `${process.env.BASE_URL}/services/data/${process.env.API_VERSION}/tooling/sobjects/NamedCredential/${namedCredId}`;
    const body = {
      FullName: process.env.NAMED_CRED_NAME,
      Metadata: {
        label: process.env.NAMED_CRED_LABEL,
        endpoint: `arn:aws:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}`,
        principalType: "Anonymous",
        protocol: "NoAuthentication",
      },
    };
    await fetch(
      url,
      createRequestOptions("PATCH", createHeaders(access_token), body)
    );
    console.log("Named credential patched successfully");
  } catch (error) {
    throw new Error(`patchNamedCredential: ${error.message}`);
  }
}

async function createEventRelay(access_token) {
  try {
    const url = `${process.env.BASE_URL}/services/data/${process.env.API_VERSION}/tooling/sobjects/EventRelayConfig/`;
    const body = {
      FullName: process.env.EVENT_RELAY_NAME,
      Metadata: {
        eventChannel: process.env.EVENT_CHANNEL_NAME,
        destinationResourceName: `callout:${process.env.NAMED_CRED_NAME}`,
        label: process.env.EVENT_RELAY_LABEL,
        relayOption: '{"ReplayRecovery":"LATEST"}',
      },
    };
    const response = await fetch(
      url,
      createRequestOptions("POST", createHeaders(access_token), body)
    );
    const result = await response.json();
    const eventRelayId = result.id;
    if (!eventRelayId) {
      throw new Error("Event Relay ID not found");
    }
    console.log(
      "created eventRelayId:",
      eventRelayId,
      "for event relay:",
      process.env.EVENT_RELAY_NAME
    );
    return eventRelayId;
  } catch (error) {
    throw new Error(`createEventRelay: ${error.message}`);
  }
}

async function patchEventRelayToRun(eventRelayId, access_token) {
  try {
    const url = `${process.env.BASE_URL}/services/data/${process.env.API_VERSION}/tooling/sobjects/EventRelayConfig/${eventRelayId}`;
    const body = { Metadata: { state: "RUN" } };
    await fetch(
      url,
      createRequestOptions("PATCH", createHeaders(access_token), body)
    );
    console.log("Event relay state patched to RUN");
  } catch (error) {
    throw new Error(`patchEventRelayToRun: ${error.message}`);
  }
}

async function fetchRemoteResource(
  eventRelayId,
  access_token,
  iterationCount,
  refresh_token
) {
  try {
    const maxIterations = 20;
    // time between iterations to query for event partner/remote resource to show in Salesforce
    // 3 minutes worked for at most 2 iterations in development
    const timeoutMilliseconds = 180000;

    if (iterationCount > maxIterations) {
      throw new Error("Max iterations reached");
    }

    const url = `${process.env.BASE_URL}/services/data/${process.env.API_VERSION}/query/?q=SELECT Id, EventRelayConfigId, RemoteResource FROM EventRelayFeedback WHERE EventRelayConfigId='${eventRelayId}'`;
    const response = await fetch(
      url,
      createRequestOptions("GET", createHeaders(access_token))
    );

    // If the access token has expired, refresh it and retry
    if (response.status === 401) {
      const newAccessToken = await refreshAccessToken(refresh_token);
      if (!newAccessToken) {
        throw new Error("Unable to refresh access token");
      }

      return await fetchRemoteResource(
        eventRelayId,
        newAccessToken,
        iterationCount + 1,
        refresh_token
      );
    }

    const result = await response.json();

    if (
      result.records &&
      result.records.length > 0 &&
      result.records[0].RemoteResource
    ) {
      const eventSourceName = result.records[0].RemoteResource;
      console.log(
        "Remote Resource is populated in Salesforce:",
        eventSourceName
      );

      // create AWS resources
      console.log("\nChecking if event source exists in AWS...");
      let eventSourceRetrievedFromAws = await listEventSources(eventSourceName);
      let retryCount = 0;
      const maxRetries = 10;
      // brief delay after remote resource is populated in Salesforce
      // for partner event source to be created & queried in AWS
      const delayBeforeAdditionalAwsEventSourceFetches = 5000;

      while (!eventSourceRetrievedFromAws && retryCount < maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayBeforeAdditionalAwsEventSourceFetches)
        );
        eventSourceRetrievedFromAws = await listEventSources(eventSourceName);
        retryCount++;
      }

      if (retryCount === maxRetries) {
        throw new Error(
          "Failed to retrieve event source from AWS after maximum retries."
        );
      }

      console.log(
        "Event source retrieved from AWS - creating AWS resources now..."
      );
      const eventBusArn = await createEventBus(eventSourceName);
      await createDiscoverer(eventBusArn);
      await createRule(eventBusArn);
      await createTarget(eventBusArn);

      console.log("\nAWS resources created successfully.");
      return { success: true, accessToken: access_token };

    } else {
      console.log(
        "Remote Resource not populated yet - retrying",
        iterationCount + 1
      );

      await new Promise((resolve) => setTimeout(resolve, timeoutMilliseconds));
      return await fetchRemoteResource(
        eventRelayId,
        access_token,
        iterationCount + 1,
        refresh_token
      );
    }
  } catch (error) {
    throw new Error(`fetchRemoteResource: ${error.message}`);
  }
}

async function validateFunctionality(accessToken) {
  console.log("\nValidating functionality by sending a test event...");
  try {
    const body = {
      Type__c: "AssetRefreshRequest",
      Payload__c: "{'EID': 'TESTEID01'}",
      Source__c: `salesforce.${process.env.ENVIRONMENT}.ecrmd.event-relay`,
      Version__c: "1.0",
    };
    await sendTestEvent(accessToken, body);

    console.log("\nWaiting for logs to populate...");
    await new Promise((resolve) => setTimeout(resolve, 30000));

    // retrieve the last event in the CloudWatch Logs stream & compare with the event sent
    const logStreamName = await describeLogStreams(process.env.LOG_GROUP_NAME);
    const logStreamEvent = await getLogEvents(
      logStreamName,
      process.env.LOG_GROUP_NAME
    );
    const logStreamEventData = JSON.parse(logStreamEvent);
    const payload = logStreamEventData.detail.payload;

    if (!payload) {
      throw new Error("Payload not found in log stream event");
    }

    const { Type__c, Payload__c, Source__c, Version__c } = payload;

    if (
      Type__c === body.Type__c &&
      Payload__c === body.Payload__c &&
      Source__c === body.Source__c &&
      Version__c === body.Version__c
    ) {
      console.log(
        "\nMessage sent matches message received - test event sent successfully.\nexiting..."
      );
      process.exit(0);
    } else {
      console.log(
        "\nMessages do not match - AWS payload:",
        payload,
        "SF event body:",
        body
      );
      process.exit(1);
    }
  } catch (error) {
    throw new Error(`validateFunctionality: ${error.message}`);
  }
}

async function sendTestEvent(access_token, body = null) {
  try {
    console.log("\nSending test event to Salesforce...");

    const url = `${process.env.BASE_URL}/services/data/${process.env.API_VERSION}/sobjects/${process.env.PLATFORM_EVENT_NAME}`;

    const response = await fetch(
      url,
      createRequestOptions("POST", createHeaders(access_token), body)
    );

    if (!response.ok) {
      throw new Error(
        `HTTP error! Status: ${response.status} ${response.statusText}`
      );
    }

    const responseData = await response.json();

    if (responseData.id) {
      console.log("Successfully created Event with ID:", responseData.id);
    }
  } catch (error) {
    throw new Error(`sendTestEvent: ${error.message}`);
  }
}

function createHeaders(access_token) {
  const myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");
  myHeaders.append("Authorization", `Bearer ${access_token}`);
  return myHeaders;
}

function createRequestOptions(method, headers, body = null) {
  return {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : null,
    redirect: "follow",
  };
}

async function refreshAccessToken(refresh_token) {
  const url = `${process.env.ACCESS_TOKEN_ENDPOINT}`; // Use test.salesforce.com for sandbox
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=refresh_token&refresh_token=${refresh_token}&client_id=${process.env.CLIENT_ID}&client_secret=${process.env.CLIENT_SECRET}`,
  });
  const data = await response.json();
  return data.access_token;
}
