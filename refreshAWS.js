import {
  EventBridgeClient,
  ListEventSourcesCommand,
  CreateEventBusCommand,
  PutRuleCommand,
  PutTargetsCommand,
} from "@aws-sdk/client-eventbridge";
import {
  SchemasClient,
  CreateDiscovererCommand,
} from "@aws-sdk/client-schemas";
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

import dotenv from "dotenv";
dotenv.config();

const eventBridgeClient = new EventBridgeClient({
  region: process.env.AWS_REGION.toLowerCase(),
});

const schemasClient = new SchemasClient({
  region: process.env.AWS_REGION.toLowerCase(),
});

const cloudWatchLogsClient = new CloudWatchLogsClient({
  region: process.env.AWS_REGION.toLowerCase(),
});

/**
 * List Event Sources in AWS EventBridge.
 * @param {string} eventSourceName - The name of the event source.
 * @returns {Promise<boolean>} True if the event source exists.
 */
async function listEventSources(eventSourceName) {
  const input = { NamePrefix: eventSourceName };
  const command = new ListEventSourcesCommand(input);

  try {
    const response = await eventBridgeClient.send(command);
    if (response.EventSources.length > 0) {
      return response.EventSources[0].Name === eventSourceName;
    }
    return false;
  } catch (error) {
    throw new Error(`Error listing event sources: ${error.message}`);
  }
}

/**
 * Create an Event Bus in AWS EventBridge.
 * @param {string} eventSourceName - The name of the event source.
 * @returns {Promise<string>} The ARN of the created event bus.
 */
async function createEventBus(eventSourceName) {
  const input = {
    Name: eventSourceName,
    EventSourceName: eventSourceName,
    Tags: [
      {
        Key: "salesforce-event-relay",
        Value: "salesforce event relay",
      },
    ],
  };

  const command = new CreateEventBusCommand(input);

  try {
    const response = await eventBridgeClient.send(command);
    console.log("\nCreate Event Bus:", response);
    return response.EventBusArn;
  } catch (error) {
    throw new Error(`Error creating event bus: ${error.message}`);
  }
}

/**
 * Create a Discoverer in AWS Schemas.
 * @param {string} eventBusArn - The ARN of the event bus.
 * @returns {Promise<string>} The ARN of the created discoverer.
 */
async function createDiscoverer(eventBusArn) {
  const input = {
    Description: "Salesforce Event Relay Discoverer",
    SourceArn: eventBusArn,
  };
  const command = new CreateDiscovererCommand(input);

  try {
    const response = await schemasClient.send(command);
    console.log("\nCreate Discoverer:", response);
    return eventBusArn;
  } catch (error) {
    throw new Error(`Error creating discoverer: ${error.message}`);
  }
}

/**
 * Create a Rule in AWS EventBridge.
 * @param {string} eventBusArn - The ARN of the event bus.
 * @returns {Promise<string>} The ARN of the created rule.
 */
async function createRule(eventBusArn) {
  const input = {
    Name: `${process.env.ENVIRONMENT}-EventRelay-Rule`,
    EventBusName: eventBusArn,
    EventPattern: JSON.stringify({
      source: [
        {
          prefix: "aws.partner/salesforce.com",
        },
      ],
      "detail-type": [process.env.PLATFORM_EVENT_NAME],
    }),
    State: "ENABLED",
    Description: "Salesforce Event Relay Rule",
    Tags: [
      {
        Key: "salesforce-event-relay",
        Value: "salesforce event relay",
      },
    ],
  };
  const command = new PutRuleCommand(input);

  try {
    const response = await eventBridgeClient.send(command);
    console.log("\nCreate Rule:", response);
    return eventBusArn;
  } catch (error) {
    throw new Error(`Error creating rule: ${error.message}`);
  }
}

/**
 * Create a Target(s) for a Rule in AWS EventBridge.
 * @param {string} eventBusArn - The ARN of the event bus.
 */
async function createTarget(eventBusArn) {
  const input = {
    Rule: `${process.env.ENVIRONMENT}-EventRelay-Rule`,
    EventBusName: eventBusArn,
    Targets: [
      {
        Id: process.env.TARGET_ID_1,
        Arn: process.env.TARGET_ARN_1,
      },
      {
        Id: process.env.TARGET_ID_2,
        Arn: process.env.TARGET_ARN_2,
      },
    ],
  };
  const command = new PutTargetsCommand(input);

  try {
    const response = await eventBridgeClient.send(command);
    console.log("\nCreate Rule Targets:", response);
  } catch (error) {
    throw new Error(`Error creating targets: ${error.message}`);
  }
}

/**
 * Describe log streams in AWS CloudWatch Logs.
 * @param {string} logGroupName - The name of the log group.
 * @returns {Promise<string>} The name of the log stream.
 */
async function describeLogStreams(logGroupName) {

  const input = {
    logGroupName: logGroupName,
    orderBy: "LastEventTime",
    descending: true,
  };
  const command = new DescribeLogStreamsCommand(input);

  try {
    const response = await cloudWatchLogsClient.send(command);
    console.log("\ndescribeLogStreams:", response);
    console.log("\nmost recent log stream:", response.logStreams[0]);
    return response.logStreams[0].logStreamName;
  } catch (error) {
    throw new Error(`Error describing log streams: ${error.message}`);
  }
}

/**
 * Get log events from AWS CloudWatch Logs.
 * @param {string} logStreamName - The name of the log stream.
 * @param {string} logGroupName - The name of the log group.
 * @returns {Promise<string>} The log event message.
 */
async function getLogEvents(logStreamName, logGroupName) {

  const input = {
    logStreamName: logStreamName,
    logGroupName: logGroupName,
  };
  const command = new GetLogEventsCommand(input);

  try {
    const response = await cloudWatchLogsClient.send(command);
    console.log("\nmost recent log event:", response.events[0]);
    return response.events[0].message;
  } catch (error) {
    throw new Error(`Error getting log events: ${error.message}`);
  }
}

export {
  listEventSources,
  createEventBus,
  createDiscoverer,
  createRule,
  createTarget,
  describeLogStreams,
  getLogEvents,
};
