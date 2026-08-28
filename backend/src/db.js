const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.TABLE;
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Item shapes (single table):
//   SIGNAL    pk='SIGNAL'      sk=<symbol>          latest signal per market
//   POS#OPEN  pk='POS#OPEN'    sk=<symbol>          open paper position
//   TRADE     pk='TRADE'       sk=<closedAt>#<sym>  closed paper trade (history)

const put = (item) => doc.send(new PutCommand({ TableName: TABLE, Item: item }));
const get = (pk, sk) => doc.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } })).then((r) => r.Item || null);
const del = (pk, sk) => doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk } }));

async function queryPk(pk, { limit, scanForward = false } = {}) {
  const out = await doc.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :p',
    ExpressionAttributeValues: { ':p': pk },
    ScanIndexForward: scanForward,
    Limit: limit,
  }));
  return out.Items || [];
}

module.exports = { put, get, del, queryPk };
