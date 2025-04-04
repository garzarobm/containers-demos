import { DurableObject } from 'cloudflare:workers';

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

	async compressString(value: string): Promise<Response> {
		const conn = this.container.getTcpPort(8001).connect('10.0.0.1:8001');
		await conn.opened;

		const connReader = this.container.getTcpPort(8003).connect('10.0.0.1:8003');
		await connReader.opened;

		const encoder = new TextEncoder();
		const view = encoder.encode(value);
		const read = connReader.readable;

		const writer = conn.writable.getWriter();
		await writer.write(view).then(async () => {
			await writer.close();
			await conn.close();
		});

		return new Response(read);
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const stub = env.COMPRESSOR.get(env.COMPRESSOR.idFromName('compressor'));
		if (request.method === 'POST') {
			try {
				const value = await request.text();
				const bytes = await stub.compressString(value);
				return bytes;
			} catch (err) {
				return new Response(err.message, { method: 500 });
			}
		}

		if (request.url.includes('do_logs')) {
			try {
				return Response.json(await stub.doLogs());
			} catch (err) {
				return new Response(err.message);
			}
		}

		if (request.url.includes('logs')) {
			try {
				return await stub.logs();
			} catch (err) {
				return new Response(err.message);
			}
		}

		await stub.init();
		return new Response('hit with POST to compress anything');
	},
} satisfies ExportedHandler<Env>;
