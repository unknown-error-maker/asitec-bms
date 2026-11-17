import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const trustProxy = process.env.TRUST_PROXY === "true";

const required = ["ALLOWED_ORIGINS", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "MAIL_TO"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
	console.error(`Lipsesc variabilele de mediu: ${missing.join(", ")}`);
	process.exit(1);
}

const allowedOrigins = new Set(
	process.env.ALLOWED_ORIGINS.split(",")
		.map((o) => o.trim().replace(/\/+$/, "").toLowerCase())
		.filter(Boolean),
);

function requestOrigin(req) {
	const origin = req.headers.origin;
	if (origin && origin !== "null") {
		return origin.toLowerCase();
	}
	const referer = req.headers.referer;
	if (!referer) {
		return "";
	}
	try {
		return new URL(referer).origin.toLowerCase();
	} catch {
		return "";
	}
}

const transporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST,
	port: Number(process.env.SMTP_PORT),
	secure: process.env.SMTP_SECURE === "true",
	auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const types = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
};

const hits = new Map();
const blocked = new Map();
const windowMs = 10 * 60 * 1000;
const maxPerWindow = 10;
const blockMs = 24 * 60 * 60 * 1000;

function isBlocked(ip) {
	const until = blocked.get(ip);
	if (!until) {
		return false;
	}
	if (until > Date.now()) {
		return true;
	}
	blocked.delete(ip);
	return false;
}

function countRequest(ip) {
	const now = Date.now();
	const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
	list.push(now);
	if (list.length > maxPerWindow) {
		blocked.set(ip, now + blockMs);
		hits.delete(ip);
		console.warn(`IP blocat 24 de ore după prea multe cereri: ${ip}`);
		return false;
	}
	hits.set(ip, list);
	return true;
}

setInterval(() => {
	const now = Date.now();
	for (const [ip, list] of hits) {
		if (!list.some((t) => now - t < windowMs)) {
			hits.delete(ip);
		}
	}
	for (const [ip, until] of blocked) {
		if (until <= now) {
			blocked.delete(ip);
		}
	}
}, windowMs).unref();

function clientIp(req) {
	if (trustProxy) {
		const fwd = req.headers["x-forwarded-for"];
		if (fwd) {
			return String(fwd).split(",")[0].trim();
		}
	}
	return req.socket.remoteAddress || "";
}

function json(res, status, body) {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
	res.end(JSON.stringify(body));
}

function readBody(req, limit = 20000) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (c) => {
			size += c.length;
			if (size > limit) {
				reject(new Error("too_large"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function clean(v) {
	return String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

function escapeHtml(s) {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const rules = {
	nume: { required: true, max: 120, missing: "Completează numele, ca să știm cu cine vorbim" },
	firma: { required: (client) => client === "pj", max: 160, missing: "Completează numele firmei" },
	telefon: {
		required: true,
		max: 40,
		missing: "Completează telefonul, ca să te putem suna",
		check: (v) => {
			const digits = v.replace(/\D/g, "").length;
			return /^[+()\d\s./-]+$/.test(v) && digits >= 9 && digits <= 15;
		},
		invalid: "Numărul de telefon nu pare corect, de exemplu 0723 123 456",
	},
	email: {
		required: false,
		max: 160,
		check: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
		invalid: "Adresa de e-mail nu pare corectă, de exemplu nume@firma.ro",
	},
	mesaj: { required: true, max: 5000, missing: "Spune-ne pe scurt ce vrei să asigurăm" },
};

function validate(data) {
	const client = data.client === "pf" ? "pf" : "pj";
	const values = { client };
	const errors = {};
	for (const [name, rule] of Object.entries(rules)) {
		const required = typeof rule.required === "function" ? rule.required(client) : rule.required;
		if (name === "firma" && client !== "pj") {
			values[name] = "";
			continue;
		}
		const v = clean(data[name]);
		values[name] = v;
		if (!v) {
			if (required) {
				errors[name] = rule.missing;
			}
			continue;
		}
		if (v.length > rule.max) {
			errors[name] = `Câmpul poate avea cel mult ${rule.max} de caractere`;
		} else if (rule.check && !rule.check(v)) {
			errors[name] = rule.invalid;
		}
	}
	return { values, errors };
}

async function handleContact(req, res) {
	if (!allowedOrigins.has(requestOrigin(req))) {
		return json(res, 403, { error: "Cererea trebuie trimisă din formularul de pe site." });
	}
	if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
		return json(res, 415, { error: "Cererea trebuie trimisă din formularul de pe site." });
	}
	const ip = clientIp(req);
	if (isBlocked(ip)) {
		return json(res, 429, { error: "Ai trimis prea multe cereri și formularul este blocat pentru 24 de ore. Te rugăm să ne suni." });
	}
	let data;
	try {
		data = JSON.parse(await readBody(req));
	} catch {
		return json(res, 400, { error: "Cererea nu a putut fi citită. Reîncarcă pagina și încearcă din nou." });
	}

	const { values, errors } = validate(data);
	if (Object.keys(errors).length) {
		return json(res, 400, { error: "Verifică câmpurile marcate cu roșu", fields: errors });
	}
	const { client, nume, firma, telefon, email, mesaj } = values;
	if (!countRequest(ip)) {
		return json(res, 429, { error: "Ai trimis prea multe cereri și formularul este blocat pentru 24 de ore. Te rugăm să ne suni." });
	}

	const tip = client === "pj" ? "Firmă" : "Persoană fizică";
	const rows = [
		["Cerere pentru", tip],
		["Nume", nume],
		...(firma ? [["Firmă", firma]] : []),
		["Telefon", telefon],
		["E-mail", email || "nu a fost completat"],
	];
	const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\nCe vrea să asigure:\n${mesaj}\n`;
	const html =
		`<table cellpadding="6" style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">` +
		rows.map(([k, v]) => `<tr><td style="color:#5A6760">${escapeHtml(k)}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`).join("") +
		`</table><p style="font-family:Arial,sans-serif;font-size:14px;color:#5A6760;margin:18px 0 6px">Ce vrea să asigure:</p>` +
		`<p style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap;margin:0">${escapeHtml(mesaj)}</p>`;

	try {
		await transporter.sendMail({
			from: process.env.MAIL_FROM,
			to: process.env.MAIL_TO,
			replyTo: email || undefined,
			subject: `Cerere de ofertă: ${firma || nume} (${tip})`,
			text,
			html,
		});
	} catch (err) {
		console.error("Trimiterea e-mailului a eșuat:", err.message);
		return json(res, 502, { error: "Cererea nu a putut fi trimisă acum. Te rugăm să ne suni sau să încerci din nou mai târziu." });
	}
	return json(res, 200, { ok: true });
}

const vendor = {
	"/vendor/just-validate.min.js": path.join(root, "node_modules/just-validate/dist/just-validate.production.min.js"),
};

async function serveStatic(req, res) {
	let urlPath;
	try {
		urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
	} catch {
		res.writeHead(400).end();
		return;
	}
	if (vendor[urlPath]) {
		try {
			const body = await readFile(vendor[urlPath]);
			res.writeHead(200, {
				"Content-Type": "text/javascript; charset=utf-8",
				"Cache-Control": "public, max-age=86400",
				"X-Content-Type-Options": "nosniff",
			});
			res.end(req.method === "HEAD" ? undefined : body);
		} catch {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Pagina nu există.");
		}
		return;
	}
	if (urlPath === "/") {
		urlPath = "/index.html";
	}
	const allowed = urlPath === "/index.html" || urlPath.startsWith("/assets/");
	const file = path.join(root, urlPath);
	if (!allowed || !file.startsWith(root + path.sep)) {
		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Pagina nu există.");
		return;
	}
	try {
		const info = await stat(file);
		if (!info.isFile()) {
			throw new Error("not_file");
		}
		const body = await readFile(file);
		const ext = path.extname(file).toLowerCase();
		res.writeHead(200, {
			"Content-Type": types[ext] || "application/octet-stream",
			"Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400",
			"X-Content-Type-Options": "nosniff",
		});
		res.end(req.method === "HEAD" ? undefined : body);
	} catch {
		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Pagina nu există.");
	}
}

const server = http.createServer(async (req, res) => {
	try {
		if (req.url === "/api/contact") {
			if (req.method !== "POST") {
				res.writeHead(405, { Allow: "POST" }).end();
				return;
			}
			await handleContact(req, res);
			return;
		}
		if (req.url === "/healthz") {
			res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
			return;
		}
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { Allow: "GET, HEAD" }).end();
			return;
		}
		await serveStatic(req, res);
	} catch (err) {
		console.error(err);
		if (!res.headersSent) {
			json(res, 500, { error: "A apărut o eroare. Încearcă din nou." });
		}
	}
});

server.listen(port, () => console.log(`asitec.ro pornit pe portul ${port}`));

for (const sig of ["SIGTERM", "SIGINT"]) {
	process.on(sig, () => server.close(() => process.exit(0)));
}
