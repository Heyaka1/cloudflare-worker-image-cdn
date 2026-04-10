/**
 * Util to snap values to allowed steps
 * Parses step arrays from env vars and rounds values up to the nearest allowed step
 */

export function parseSteps(raw: string | undefined): number[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed) || parsed.length === 0) return [];
		return parsed.map(Number).filter((n) => !isNaN(n) && n > 0).sort((a, b) => a - b);
	} catch {
		return [];
	}
}

export function snapToStep(value: number, steps: number[]): number {
	if (steps.length === 0) return value;
	for (const step of steps) {
		if (value <= step) return step;
	}
	// Value exceeds all steps — clamp to the largest
	return steps[steps.length - 1];
}
