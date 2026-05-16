import { inngest } from "../client";

export const TEST_ECHO_EVENT = "acropolisos/test.echo" as const;

export const testEcho = inngest.createFunction(
  {
    id: "acropolisos-test-echo",
    name: "acropolisos test echo",
    triggers: [{ event: TEST_ECHO_EVENT }],
  },
  async ({ event }) => {
    return { echoed: event.data };
  },
);
