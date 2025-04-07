import { DurableObject, WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

type Params = {
	r2Path: string;
};

export function sleep(ms: number) {
	return new Promise((res) => setTimeout(res, ms));
}

export class CompressorWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		const container = this.env.COMPRESSOR.get(this.env.COMPRESSOR.idFromName(event.instanceId));

		await step.do('wait for container to be healthy and pass r2 object, and put on another object', async () => {
			const tries = 10;
			await container.init();

			const waitUntilContainerIsOk = async () => {
				let lastErr: unknown;
				for (let i = 0; i < tries; i++) {
					try {
						await container.logs();
						return;
					} catch (err) {
						console.error('transient error:', err instanceof Error ? err.message : JSON.stringify(err));
						await sleep(500);
						lastErr = err;
					}
				}

				throw lastErr;
			};

			await waitUntilContainerIsOk();

			const object = await this.env.COMPRESSOR_BUCKET.get(event.payload.r2Path);
			if (object === null) {
				console.error('Object not found: ' + event.payload.r2Path);
				return;
			}

			try {
				const result = await container.fetch(new Request('http://compressor', { method: 'POST', body: object.body }));
				await this.env.COMPRESSOR_BUCKET.put(`results${event.payload.r2Path}`, result.body);
			} catch (err) {
				console.error('There was an error compressing the object', err instanceof Error ? err.message : JSON.stringify(err));
				throw err;
			}
		});

		await step.do('destroy', async () => {
			await container.destroy();
		});
	}
}

export class Compressor extends DurableObject<Env> {
	container: Container;
	monitor?: Promise<unknown>;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		if (ctx.container === undefined) throw new Error('no container');
		this.container = ctx.container;
		ctx.blockConcurrencyWhile(async () => {
			if (!this.container.running) this.container.start({ entrypoint: ['/server'], enableInternet: false });
			this.monitor = this.container.monitor().then(() => console.log('Container exited?'));
		});
	}

	async init() {
		console.log('Starting container');
	}

	async logs() {
		return await this.container.getTcpPort(8002).fetch('http://container');
	}

	async destroy() {
		await this.ctx.container?.destroy();
		await this.ctx.storage.deleteAll();
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.sync();
		this.ctx.abort();
	}

	async fetch(req: Request): Promise<Response> {
		void this.container.getTcpPort(8002).fetch('http://container/compressions', { method: 'PUT', body: req.body });
		return await this.container.getTcpPort(8002).fetch('http://container/compressions');
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const stub = env.COMPRESSOR.get(env.COMPRESSOR.idFromName('compressor'));
		await stub.init();

		if (request.method === 'POST') {
			try {
				return await stub.fetch(request);
			} catch (err) {
				return new Response(err instanceof Error ? err.message : JSON.stringify(err), { status: 500 });
			}
		}

		if (request.method === 'PUT') {
			const url = new URL(request.url).pathname;
			await env.COMPRESSOR_BUCKET.put(url, request.body);
			await env.COMPRESSOR_WORKFLOW.create({ params: { r2Path: url, id: url } });
			return new Response('ok');
		}

		return new Response('hit with POST to compress anything, PUT to upload it to R2 and do the compression async');
	},
} satisfies ExportedHandler<Env>;
