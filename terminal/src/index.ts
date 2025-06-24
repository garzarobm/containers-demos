import { Container, getContainer } from "@cloudflare/containers";
import html from "./terminal.html";

export class TerminalContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "1h";
  enableInternet = true;

  async fetch(request: Request): Promise<Response> {
    return await this.containerFetch(request, this.defaultPort);
  }
}

export default {
  async fetch(
    request: Request,
    env: { TERMINAL: DurableObjectNamespace<TerminalContainer> },
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/terminal") {
	return await getContainer(env.TERMINAL).fetch(request);
    } else if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(html, {
        headers: {
          "content-type": "text/html;charset=UTF-8",
        },
      });
    }
  },
};
