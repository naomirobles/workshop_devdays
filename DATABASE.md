# Database

This project uses **Amazon DynamoDB**. Tables are not defined in `template.yaml` — they are pre-created in the AWS account before the workshop runs and referenced by name through Lambda environment variables.

## Tables

| Environment variable | Table name | Purpose |
|---|---|---|
| `PRODUCTS_TABLE` | `product-catalog` | Current product catalog queried by the agent |
| `SESSIONS_TABLE` | `agent-sessions` | Conversation history per session (TTL: 24 h) |
| `FUTURE_PRODUCTS_TABLE` | `future-product-catalog` | Upcoming products not yet in the main catalog |

All three tables use a single string hash key named `id` with PAY_PER_REQUEST billing. There are no sort keys or secondary indexes.

### product-catalog and future-product-catalog item shape

```json
{
  "id":          "string (unique)",
  "name":        "string (English, used for search)",
  "description": "string",
  "price":       number,
  "stock":       number
}
```

### agent-sessions item shape

```json
{
  "sessionId": "string (hash key)",
  "messages":  "string (JSON-serialised message array)",
  "expiresAt": number (Unix timestamp, DynamoDB TTL attribute)
}
```

## How the tables are wired up

Environment variables in `template.yaml` (`Resources > AgentFunction > Properties > Environment > Variables`) map each logical name to the physical table name:

```yaml
# template.yaml
Environment:
  Variables:
    PRODUCTS_TABLE: product-catalog
    SESSIONS_TABLE: agent-sessions
    FUTURE_PRODUCTS_TABLE: future-product-catalog   # add this if not present
```

The Lambda code reads these at runtime — `process.env.PRODUCTS_TABLE`, etc. — so you can point any variable at a different table name without changing application code.

## How to add new products

Products are plain DynamoDB items. The simplest way is the AWS CLI:

```bash
aws dynamodb put-item \
  --table-name product-catalog \
  --item '{
    "id":          {"S": "unique-id"},
    "name":        {"S": "product name in English"},
    "description": {"S": "short description"},
    "price":       {"N": "9.99"},
    "stock":       {"N": "100"}
  }'
```

Replace `product-catalog` with `future-product-catalog` to add an upcoming product instead.

The agent tools scan the entire table and filter by `name` (case-insensitive substring match), so no index updates are needed after inserting an item.

## How to add a new table (new entity type)

1. **Create the table** in AWS (CLI, Console, or a new `AWS::DynamoDB::Table` resource in `template.yaml`):

   ```bash
   aws dynamodb create-table \
     --table-name my-new-table \
     --attribute-definitions AttributeName=id,AttributeType=S \
     --key-schema AttributeName=id,KeyType=HASH \
     --billing-mode PAY_PER_REQUEST
   ```

2. **Add an environment variable** in `template.yaml` so Lambda can find it:

   ```yaml
   Environment:
     Variables:
       MY_NEW_TABLE: my-new-table
   ```

3. **Add a tool** in `src/agent.mjs` that reads `process.env.MY_NEW_TABLE`. Follow the pattern of `checkStock` or `checkFutureStock` — define a `tool({...})` constant and add it to the `tools` array in `answerWith`.

4. **Deploy**: run `sam sync` (or `sam deploy`) to push the environment variable change to Lambda.

## File reference

| File | Role |
|---|---|
| `template.yaml` | SAM/CloudFormation stack — defines the Lambda function and its environment variables (table names live here) |
| `src/agent.mjs` | Agent tools — each tool that talks to DynamoDB is defined here; add new tools here |
| `samconfig.toml` | SAM deployment defaults (stack name, capabilities) — no database config here |
