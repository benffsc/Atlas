import { NextRequest } from "next/server";
import { apiSuccess, apiError, apiBadRequest } from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryOne, execute } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session?.staff_id) {
      return apiError("Unauthorized", 401);
    }

    const body = await request.json();
    const { anomaly_id } = body;

    if (!anomaly_id) {
      return apiBadRequest("anomaly_id is required");
    }

    // Check if Linear API key is configured
    const linearApiKey = process.env.LINEAR_API_KEY;
    if (!linearApiKey) {
      console.warn("LINEAR_API_KEY not set — skipping Linear issue creation");
      return apiSuccess({
        created: false,
        reason: "Linear integration not configured (LINEAR_API_KEY not set)",
      });
    }

    // Load anomaly details
    const anomaly = await queryOne<{
      anomaly_id: string;
      anomaly_type: string;
      description: string;
      entity_type: string | null;
      entity_id: string | null;
      severity: string;
      evidence: Record<string, unknown>;
      linear_issue_id: string | null;
      created_at: string;
    }>(
      `SELECT anomaly_id, anomaly_type, description, entity_type, entity_id,
              severity, evidence, linear_issue_id, created_at::text
       FROM ops.tippy_anomaly_log WHERE anomaly_id = $1`,
      [anomaly_id]
    );

    if (!anomaly) {
      return apiBadRequest("Anomaly not found");
    }

    // Skip if already has a Linear issue
    if (anomaly.linear_issue_id) {
      return apiSuccess({
        created: false,
        reason: "Linear issue already exists",
        linear_issue_id: anomaly.linear_issue_id,
      });
    }

    // Skip low severity
    if (anomaly.severity === "low") {
      return apiSuccess({
        created: false,
        reason: "Severity too low for automatic issue creation (requires medium+)",
      });
    }

    // Create Linear issue
    const severityEmoji = {
      critical: "\uD83D\uDD34",
      high: "\uD83D\uDFE0",
      medium: "\uD83D\uDFE1",
    }[anomaly.severity] || "\u26AA";

    const title = `${severityEmoji} Tippy Anomaly: ${anomaly.anomaly_type.replace(/_/g, " ")}`;
    const description = [
      `## Data Anomaly Detected by Tippy`,
      ``,
      `**Type:** ${anomaly.anomaly_type}`,
      `**Severity:** ${anomaly.severity}`,
      `**Entity:** ${anomaly.entity_type || "N/A"} ${anomaly.entity_id || ""}`,
      `**Detected:** ${anomaly.created_at}`,
      ``,
      `### Description`,
      anomaly.description,
      ``,
      anomaly.evidence && Object.keys(anomaly.evidence).length > 0
        ? `### Evidence\n\`\`\`json\n${JSON.stringify(anomaly.evidence, null, 2)}\n\`\`\``
        : "",
      ``,
      `---`,
      `*Auto-created from Tippy anomaly ${anomaly.anomaly_id}*`,
    ].filter(Boolean).join("\n");

    // Map severity to Linear priority (1=urgent, 2=high, 3=medium, 4=low)
    const priorityMap: Record<string, number> = {
      critical: 1,
      high: 2,
      medium: 3,
    };

    const graphqlResponse = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: linearApiKey,
      },
      body: JSON.stringify({
        query: `mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              url
            }
          }
        }`,
        variables: {
          input: {
            title,
            description,
            priority: priorityMap[anomaly.severity] || 3,
            labelIds: [], // Will use default labels
          },
        },
      }),
    });

    const graphqlResult = await graphqlResponse.json();

    if (!graphqlResult.data?.issueCreate?.success) {
      console.error("Linear issue creation failed:", graphqlResult);
      return apiError("Failed to create Linear issue", 500);
    }

    const issue = graphqlResult.data.issueCreate.issue;

    // Update anomaly with Linear issue ID
    await execute(
      `UPDATE ops.tippy_anomaly_log SET linear_issue_id = $1 WHERE anomaly_id = $2`,
      [issue.identifier, anomaly_id]
    );

    return apiSuccess({
      created: true,
      linear_issue_id: issue.identifier,
      linear_url: issue.url,
    });
  } catch (error) {
    console.error("Anomaly→Linear error:", error);
    return apiError(
      error instanceof Error ? error.message : "Failed to create Linear issue",
      500
    );
  }
}
