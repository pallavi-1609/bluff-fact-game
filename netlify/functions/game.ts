// Standard Netlify Function for BLUFF FACT!
import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
const gameJs = require("./game.js");

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  return await gameJs.handler(event, context);
};
