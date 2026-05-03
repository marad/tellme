export function shouldUseDaemon(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.TELLME_NO_DAEMON !== "1";
}
