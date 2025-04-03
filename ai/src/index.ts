import { DurableObject } from 'cloudflare:workers';

export class CodeExecutor extends DurableObject<Env> {
	container: globalThis.Container;
	monitor?: Promise<unknown>;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.container = ctx.container!;
		void this.ctx.blockConcurrencyWhile(async () => {
			if (!this.container.running) this.container.start();
		});
	}

	async fetch(req: Request) {
		const prompt = await req.text();
		const res = await this.env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
			messages: [
				{
					role: 'system',
					content:
						'You will receive a second message with some python3 code, just generate python3 code that does not require any pip dependencies if possible. The python3 code should be clean so it can be piped through stdin to python3 and executed. Also do not use ```',
				},
				{
					content: prompt,
					role: 'user',
				},
			],
		});
		const { response } = res;
		return await this.container.getTcpPort(8080).fetch('http://container.com/execute', { method: 'POST', body: response });
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		try {
			return await env.CODE_EXECUTOR.get(env.CODE_EXECUTOR.idFromName('executor')).fetch(request);
		} catch (err) {
			console.error('Error fetch:', err.message);
			return new Response(err.message, { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
