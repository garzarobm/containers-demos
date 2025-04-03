import { DurableObject } from 'cloudflare:workers';

async function wrap<T, E = Error>(fn: Promise<T>): Promise<[T, null] | [null, E]> {
	return fn.then((data) => [data, null] as [T, null]).catch((err) => [null, err as unknown as E] as [null, E]);
}

type Job = { cmd: string; id: string; output: string; completed: boolean; active: boolean };

export class Container extends DurableObject<Env> {
	container: globalThis.Container;
	monitor?: Promise<unknown>;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.container = ctx.container!;
		void this.ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT, cmd TEXT, completed BOOLEAN, active BOOLEAN, output TEXT);');

			if (this.container.running) {
				if (this.monitor === undefined) {
					this.monitor = this.container.monitor();
					this.handleMonitorPromise(this.monitor);
				}
			} else {
				this.container.start({ enableInternet: true });
				this.monitor = this.container.monitor();
				this.handleMonitorPromise(this.monitor);
			}

			// if no alarm, trigger ASAP
			await this.setAlarm(Date.now());
		});
	}

	async setAlarm(value = Date.now() + 500) {
		const alarm = await this.ctx.storage.getAlarm();
		if (alarm === null) {
			await this.ctx.storage.setAlarm(value);
			await this.ctx.storage.sync();
		}
	}

	inflightFetch?: Promise<unknown>;
	async alarm() {
		try {
			if (this.inflightFetch !== undefined) {
				return;
			}

			const currentJob = await this.getActiveJob();
			if (currentJob === null) {
				const toRun = await this.getOnePendingJobAndMarkAsActive();
				if (toRun === null) return;
				void this.run(toRun.id, toRun.cmd);
				return;
			}

			void this.run(currentJob.id, currentJob.cmd);
		} finally {
			await this.setAlarm();
		}
	}

	run(id: string, cmd: string): Promise<unknown> {
		this.inflightFetch = this.container
			.getTcpPort(8080)
			.fetch(new Request('http://container/exec', { body: cmd, method: 'POST' }))
			.then(async (res) => {
				const output = await res.text();
				this.finishJob(id, `${res.status} ${output}`);
				await this.ctx.storage.sync();
				this.inflightFetch = undefined;
				return res;
			})
			.catch((err) => {
				console.error('Error running the job, we will need to retry:', err);
				this.inflightFetch = undefined;
				return;
			})
			.finally(() => {
				this.inflightFetch = undefined;
			});

		return this.inflightFetch;
	}

	private finishJob(id: string, output: string) {
		const jobs = this.ctx.storage.sql.exec(
			'UPDATE jobs SET completed = true, active = false, output = ? WHERE id = ? RETURNING *',
			output,
			id,
		);
		try {
			const row = jobs.one() as unknown as Job;
			return row;
		} catch {
			return null;
		}
	}

	async getOnePendingJobAndMarkAsActive(): Promise<Job | null> {
		const jobs = this.ctx.storage.sql.exec(`UPDATE jobs SET active = true WHERE rowid = (
			  SELECT MIN(rowid) as rowid
			  FROM jobs
			  WHERE active = false AND completed = false
				LIMIT 1
			) RETURNING *;`);
		try {
			return jobs.one() as unknown as Job;
		} catch (err) {
			return null;
		}
	}

	async getActiveJob(): Promise<Job | null> {
		const jobs = this.ctx.storage.sql.exec('SELECT * FROM jobs WHERE active = true AND completed = false LIMIT 1;');
		try {
			const row = jobs.one() as unknown as Job;
			return row;
		} catch {
			return null;
		}
	}

	async getJobs(): Promise<Job[]> {
		const jobs = this.ctx.storage.sql.exec('SELECT * FROM jobs;');
		const row = jobs.toArray() as unknown;
		return row as Job[];
	}

	async submitJob(cmd: string[]): Promise<string> {
		const id = crypto.randomUUID();
		this.ctx.storage.sql.exec(
			'INSERT INTO jobs (id, cmd, completed, active, output) VALUES (?, ?, ?, ?, ?)',
			id,
			cmd.join(' '),
			0,
			0,
			null,
		);
		return id;
	}

	handleMonitorPromise(monitor: Promise<unknown>) {
		monitor
			.then(async () => {
				console.log('Container exited');
			})
			.catch(async (err) => {
				console.error(`Monitor exited with an error: ${err.message}`);
			})
			.finally(async () => {
				await this.setAlarm();
				this.ctx.abort();
			});
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const runner = env.CONTAINER.get(env.CONTAINER.idFromName('runner'));
		if (request.method === 'GET') {
			const jobs = await runner.getJobs();
			return Response.json(jobs);
		}

		const cmd = await request.text();
		await runner.submitJob(cmd.split(' '));
		return new Response('ok');
	},
} satisfies ExportedHandler<Env>;
