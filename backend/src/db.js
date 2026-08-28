// Lazy-load the AWS SDK on first use so this module can be required in tests /
// the local sim (which inject their own in-memory db) without the SDK installed.
const TABLE = process.env.TABLE;
let _doc, _cmds;
function client() {
  if (_doc) return { doc: _doc, cmds: _cmds };
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
  _doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  _cmds = { PutCommand, GetCommand, DeleteCommand, QueryCommand };
  return { doc: _doc, cmds: _cmds };
}

// Item shapes (single table):
//   SIGNAL    pk='SIGNAL'      sk=<symbol>          latest signal per market
//   POS#OPEN  pk='POS#OPEN'    sk=<symbol>          open paper position
//   TRADE     pk='TRADE'       sk=<closedAt>#<sym>  closed paper trade (history)

const put = (item) => { const { doc, cmds } = client(); return doc.send(new cmds.PutCommand({ TableName: TABLE, Item: item })); };
const get = (pk, sk) => { const { doc, cmds } = client(); return doc.send(new cmds.GetCommand({ TableName: TABLE, Key: { pk, sk } })).then((r) => r.Item || null); };
const del = (pk, sk) => { const { doc, cmds } = client(); return doc.send(new cmds.DeleteCommand({ TableName: TABLE, Key: { pk, sk } })); };

async function queryPk(pk, { limit, scanForward = false } = {}) {
  const { doc, cmds } = client();
  const out = await doc.send(new cmds.QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :p',
    ExpressionAttributeValues: { ':p': pk },
    ScanIndexForward: scanForward,
    Limit: limit,
  }));
  return out.Items || [];
}

module.exports = { put, get, del, queryPk };
