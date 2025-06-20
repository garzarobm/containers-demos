import { DurableObject } from 'cloudflare:workers';

export class Container extends DurableObject<Env> {
	container: globalThis.Container;

	async blockConcurrencyRetry(cb: () => Promise<unknown>) {
		await this.ctx.blockConcurrencyWhile(async () => {
			let lastErr;
			for (let i = 0; i < 10; i++) {
				try {
					return await cb();
				} catch (err) {
					lastErr = err;
					continue;
				}
			}

			throw lastErr;
		});
	}

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.container = ctx.container!;
		this.blockConcurrencyRetry(async () => {
			await this.init();
		});
	}

	async init() {
		if (!this.container.running) this.container.start();
	}

	async fetch(req: Request) {
		const url = req.url.replace('https:', 'http:');
		return this.container.getTcpPort(8080).fetch(url, req);
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const id: DurableObjectId = env.CONTAINER.idFromName('foo');
		const stub = env.CONTAINER.get(id);
		return await stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;
