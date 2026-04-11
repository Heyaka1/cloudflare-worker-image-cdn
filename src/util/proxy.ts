/**
 * Util to proxy requests to the origin server
 */
import { optimizeImage } from "wasm-image-optimization/workerd";
import { getBestFormat, getContentType } from "./convert";
import { computeDimensions } from "./resize";
import { getImageDimensions } from "./dimensions";
import { getCachedImage, putCachedImage } from "./cache";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PIXELS = 16_000_000; // 16 megapixels

function passthrough(response: Response): Response {
	return new Response(response.body, {
		status: response.status,
		headers: response.headers,
	});
}

export async function proxyRequest(
	request: Request,
	originBaseUrl: string,
	bucket: R2Bucket,
	ctx: ExecutionContext,
): Promise<Response> {
	const url = new URL(request.url);
	const originUrl = `${originBaseUrl}${url.pathname}${url.search}`;

	const accept = request.headers.get("accept") || "";
	const format = getBestFormat(accept);

	const width = url.searchParams.get("w") ? Number(url.searchParams.get("w")) : undefined;
	const height = url.searchParams.get("h") ? Number(url.searchParams.get("h")) : undefined;
	const quality = url.searchParams.get("quality")
		? Math.min(100, Math.max(1, Number(url.searchParams.get("quality"))))
		: 100;

	// Check R2 cache before fetching from origin
	if (format) {
		const cached = await getCachedImage(bucket, url, format);
		if (cached) {
			return new Response(cached.data, {
				status: 200,
				headers: {
					"Content-Type": cached.contentType,
					"Cache-Control": "public, max-age=86400",
					"X-Cache": "HIT",
				},
			});
		}
	}

	// Cache miss — fetch from origin
	const originHost = new URL(originUrl).host;
	const originResponse = await fetch(originUrl, {
		method: request.method,
		headers: {
			...Object.fromEntries(request.headers),
			Host: originHost,
		},
	});

	if (!originResponse.ok) {
		return passthrough(originResponse);
	}

	const contentType = originResponse.headers.get("content-type") || "";
	if (!contentType.startsWith("image/") || contentType.includes("svg")) {
		return passthrough(originResponse);
	}

	if (!format) {
		return passthrough(originResponse);
	}

	// Pre-flight size check (before buffering)
	const contentLength = Number(originResponse.headers.get("content-length") || "0");
	if (contentLength > MAX_IMAGE_SIZE) {
		return passthrough(originResponse);
	}

	// Skip WASM if origin already serves the target format and no resize needed
	const originFormat = contentType.split("/")[1]; // "jpeg", "png", "webp", "avif"
	if (originFormat === format && !width && !height) {
		return passthrough(originResponse);
	}

	// Get image data as ArrayBuffer
	const imageData = await originResponse.arrayBuffer();

	// Post-buffer size check (Content-Length may be missing/wrong)
	if (imageData.byteLength > MAX_IMAGE_SIZE) {
		return new Response("Image too large to process", { status: 413 });
	}

	// Megapixel guard: serve unoptimized if decoding would exceed memory
	const dims = getImageDimensions(imageData);
	if (dims && dims.width * dims.height > MAX_PIXELS) {
		return new Response(imageData, {
			status: 200,
			headers: {
				"Content-Type": contentType,
				"Cache-Control": "public, max-age=86400",
			},
		});
	}

	// Build single optimizeImage call with all options (resize + format convert)
	const options: Record<string, unknown> = {
		image: imageData,
		format,
		quality,
	};

	// Add resize dimensions if requested (only downscale, never upscale)
	if ((width || height) && dims) {
		const { width: targetW, height: targetH } = computeDimensions(
			dims.width,
			dims.height,
			width,
			height,
		);
		if (targetW < dims.width || targetH < dims.height) {
			options.width = targetW;
			options.height = targetH;
		}
	}

	// Single WASM call: resize + format conversion in one pass
	const result = await optimizeImage(options as Parameters<typeof optimizeImage>[0]);
	const converted = result.data;

	// Store in R2 cache (non-blocking)
	ctx.waitUntil(putCachedImage(bucket, url, format, converted));

	return new Response(converted, {
		status: 200,
		headers: {
			"Content-Type": getContentType(format),
			"Cache-Control": "public, max-age=86400",
			"X-Cache": "MISS",
		},
	});
}
