import { emitterEventNames } from "@octokit/webhooks";
import { Value } from "@sinclair/typebox/value";
import { GitHubEventHandler } from "./github/github-event-handler";
import { bindHandlers } from "./github/handlers";
import { Env, envSchema } from "./github/types/env";
import { CloudflareKv } from "./github/utils/cloudflare-kv";
import { WebhookEventName } from "@octokit/webhooks-types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      validateEnv(env);
      const eventName = getEventName(request);
      const signatureSha256 = getSignature(request);
      const id = getId(request);
      const eventHandler = new GitHubEventHandler({
        webhookSecret: env.WEBHOOK_SECRET,
        appId: env.APP_ID,
        privateKey: env.APP_PRIVATE_KEY,
        pluginChainState: new CloudflareKv(env.PLUGIN_CHAIN_STATE),
      });
      bindHandlers(eventHandler);
      await eventHandler.webhooks.verifyAndReceive({ id, name: eventName, payload: await request.text(), signature: signatureSha256 });
      return new Response("ok\n", { status: 200, headers: { "content-type": "text/plain" } });
    } catch (error) {
      return handleUncaughtError(error);
    }
  },
};

function handleUncaughtError(error: unknown) {
  console.error(error);
  let status = 500;
  let errorMessage = "An uncaught error occurred";
  if (error instanceof AggregateError) {
    const err = error.errors[0];
    errorMessage = err.message ? `${err.name}: ${err.message}` : `Error: ${errorMessage}`;
    status = typeof err.status !== "undefined" ? err.status : 500;
  }
  return new Response(JSON.stringify({ error: errorMessage }), { status: status, headers: { "content-type": "application/json" } });
}

function validateEnv(env: Env): void {
  if (!Value.Check(envSchema, env)) {
    const errors = [...Value.Errors(envSchema, env)];
    console.error("Invalid environment variables", errors);
    throw new Error("Invalid environment variables");
  }
}

function getEventName(request: Request): WebhookEventName {
  const eventName = request.headers.get("x-github-event");
  if (!eventName || !emitterEventNames.includes(eventName as WebhookEventName)) {
    throw new Error(`Unsupported or missing "x-github-event" header value: ${eventName}`);
  }
  return eventName as WebhookEventName;
}

function getSignature(request: Request): string {
  const signatureSha256 = request.headers.get("x-hub-signature-256");
  if (!signatureSha256) {
    throw new Error(`Missing "x-hub-signature-256" header`);
  }
  return signatureSha256;
}

function getId(request: Request): string {
  const id = request.headers.get("x-github-delivery");
  if (!id) {
    throw new Error(`Missing "x-github-delivery" header`);
  }
  return id;
}
