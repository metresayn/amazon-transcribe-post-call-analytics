const AWS = require("aws-sdk");
const ddb = new AWS.DynamoDB();
const {
  withQueryStringValidation,
  searchSchema,
  response,
} = require("./validation");

const tableName = process.env.TableName;

function makeQuery(key, filter, filter_values) {
  let expression = "SK = :sk";
  let values = {
    ":sk": {
      S: key,
    },
  };

  if (filter != null) {
    expression += ` AND ${filter}`;

    if (filter_values != null) {
      values = { ...values, ...filter_values };
    }
  }

  return {
    TableName: tableName,
    IndexName: "GSI1",
    ScanIndexForward: false,
    KeyConditionExpression: expression,
    ExpressionAttributeValues: values,
  };
}

async function* getAllResults(
  db,
  query
) {
  console.info(`Querying Dynamo`, query.ExpressionAttributeValues);

  let queryResult;
  do {
    queryResult = await db.query(query).promise();
    console.info(`Query Result`, queryResult);
    query.ExclusiveStartKey = queryResult?.LastEvaluatedKey;

    if (queryResult.Items) {
      yield* queryResult.Items;
    }
  } while (query.ExclusiveStartKey);
}

const handler = async function (event, context) {
  console.log(
    JSON.stringify(
      {
        event: event,
        context: context,
      },
      null,
      4
    )
  );

  let queries = [];

  let params = event.queryStringParameters || {};

  if ("timestampFrom" in params) {
    if ("timestampTo" in params) {
      queries.push(
        makeQuery("call", "TK BETWEEN :start AND :end", {
          ":start": {
            N: params.timestampFrom,
          },
          ":end": {
            N: params.timestampTo,
          },
        })
      );
    } else {
      queries.push(
        makeQuery("call", "TK >= :start", {
          ":start": {
            N: params.timestampFrom,
          },
        })
      );
    }
  } else if ("timestampTo" in params) {
    queries.push(
      makeQuery("call", "TK <= :end", {
        ":end": {
          N: params.timestampTo,
        },
      })
    );
  }

  if (
    "sentimentWho" in params &&
    "sentimentWhat" in params &&
    "sentimentDirection" in params
  ) {
    const who = params.sentimentWho == "caller" ? "caller" : "agent";
    const what = params.sentimentWhat == "average" ? "average" : "trend";
    const query =
      params.sentimentDirection == "positive" ? "TK >= :zero" : "TK < :zero";

    queries.push(
      makeQuery(`sentiment#${who}#${what}`, query, {
        ":zero": {
          N: "0",
        },
      })
    );
  }

  if ("entity" in params) {
    params.entity.split(",").forEach((entity) => {
      queries.push(makeQuery(`entity#${entity}`));
    });
  }

  if ("language" in params) {
    queries.push(makeQuery(`language#${params.language}`));
  }

  if("jobName" in params) {
    const query = makeQuery("call");
    query.FilterExpression = "contains(#col_name, :col_value)";

    let values = {
      ":col_value": {
        S: params.jobName,
      },
    };

    query.ExpressionAttributeValues = { ...query.ExpressionAttributeValues, ...values };

    query.ExpressionAttributeNames = {
      "#col_name": "Data"
    };

    queries.push(
        query
    );
  }

  if (queries.length == 0) {
    return response(200, [], { "access-control-allow-methods": "OPTIONS,GET" });
  }

  console.log("Queries:", JSON.stringify(queries, null, 4));

  let results = [];
  try {
    for (const query of queries) {
      const items = [];
      for await (const item of getAllResults(ddb, query)) {
        items.push(item);
      }
      results.push(items);
    }
  } catch (error) {
    throw error;
    // Handle the error as needed
  }
  console.log("Results:", results);

  let output = results[0];

  results = results.map((items) => {
    return items.reduce((a, item) => {
      a[item.PK.S] = true;
      return a;
    }, {});
  });
  console.log("Result Keys:", results);

  output = output.filter((item) => {
    return results.every((result) => {
      return item.PK.S in result;
    });
  });
  console.log("Filtered:", output);

  const body = output.map((item) => {
    return JSON.parse(item.Data.S);
  });

  return response(200, body, {
    "access-control-allow-methods": "OPTIONS,GET",
  });
};

exports.handler = withQueryStringValidation(handler, searchSchema);