import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "acropolisos",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
